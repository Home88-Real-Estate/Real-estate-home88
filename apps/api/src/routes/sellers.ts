/**
 * Owners (Ιδιοκτήτες): the seller / landlord pipeline and the owner report.
 *
 *  - A seller lead follows an owner from first contact to a listed property:
 *    NEW → CONTACTED → VALUATION → PROPOSAL → MANDATE → LISTED, or LOST.
 *  - The owner is a Contact with the SELLER or LANDLORD role. Contact details
 *    are stored encrypted; without a configured encryption key they are
 *    refused rather than stored in clear.
 *  - A follow-up date creates a task, so it shows in Υπενθυμίσεις.
 *  - Every step is written to the append-only timeline and the audit log.
 *  - The owner report summarises activity on the owner's properties without
 *    exposing who the interested buyers are.
 *
 * Visibility: managers and above see every seller lead; others see the ones
 * they are the agent of or created.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import {
  canMoveSeller,
  daysBetween,
  nextSellerStages,
  SELLER_MOTIVATIONS,
  SELLER_OPEN_STAGES,
  SELLER_STAGE_LABELS,
  SELLER_STAGES,
  SELLER_TIMEFRAMES,
} from "@home88/domain";

import { writeAudit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { decryptField, encryptField, hasEncryptionKey, hashEmail, hashPhone } from "../lib/pii";
import { db } from "../lib/prisma";
import { allocateReference } from "../lib/references";
import { requireRole, roleAtLeast } from "../plugins/auth";

type Actor = { id: string; role: string; firstName: string; lastName: string; email: string };

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : null));
const optionalInt = (min: number, max: number) =>
  z.union([z.literal(""), z.null(), z.undefined(), z.coerce.number().int().min(min).max(max)]).transform((v) => (v === "" || v == null ? null : v));
const optionalNumber = (max: number) =>
  z.union([z.literal(""), z.null(), z.undefined(), z.coerce.number().positive().max(max)]).transform((v) => (v === "" || v == null ? null : v));
const optionalDate = z
  .union([z.literal(""), z.null(), z.undefined(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ημερομηνία ΕΕΕΕ-ΜΜ-ΗΗ.")])
  .transform((v) => (v ? new Date(`${v}T09:00:00Z`) : null));
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().or(z.literal("")).transform((v) => (v ? v : null));

const MOTIVATIONS = SELLER_MOTIVATIONS.map((m) => m.value) as [string, ...string[]];
const TIMEFRAMES = SELLER_TIMEFRAMES.map((m) => m.value) as [string, ...string[]];
const PROPERTY_TYPES = [
  "APARTMENT", "MAISONETTE", "HOUSE", "VILLA", "STUDIO", "OFFICE", "SHOP", "WAREHOUSE",
  "BUILDING", "HOTEL", "LAND", "PLOT", "PARKING", "INDUSTRIAL", "OTHER",
] as const;
const CONDITIONS = ["NEW_BUILD", "RENOVATED", "GOOD", "NEEDS_RENOVATION", "UNDER_CONSTRUCTION"] as const;

/** Fields an agent can edit on a seller lead (the stage has its own route). */
const detailsShape = {
  listingType: z.enum(["SALE", "RENT"]),
  propertyType: optionalEnum(PROPERTY_TYPES),
  city: optionalText(120),
  areaName: optionalText(120),
  address: optionalText(200),
  area: optionalNumber(100_000),
  bedrooms: optionalInt(0, 50),
  floor: optionalInt(-5, 100),
  yearBuilt: optionalInt(1800, 2100),
  condition: optionalEnum(CONDITIONS),
  askingPrice: optionalNumber(1_000_000_000),
  motivation: optionalEnum(MOTIVATIONS),
  timeframe: optionalEnum(TIMEFRAMES),
  source: optionalText(120),
  nextFollowUpAt: optionalDate,
  notes: optionalText(4000),
};

const createSchema = z
  .object({
    ...detailsShape,
    contactReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
    firstName: optionalText(80),
    lastName: optionalText(80),
    phone: optionalText(40),
    email: z.string().trim().toLowerCase().email("Δώστε έγκυρο email.").max(254).optional().or(z.literal("")).transform((v) => (v ? v : null)),
    propertyReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (!v.contactReference && !v.firstName) {
      ctx.addIssue({ code: "custom", path: ["firstName"], message: "Συμπληρώστε όνομα ιδιοκτήτη ή κωδικό επαφής." });
    }
  });

const updateSchema = z.object(detailsShape).partial();

const listSchema = z.object({
  stage: z.enum([...SELLER_STAGES, "OPEN"]).optional(),
  scope: z.enum(["mine", "all"]).optional(),
  followUp: z.enum(["due"]).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const stageSchema = z.object({
  stage: z.enum(SELLER_STAGES),
  reason: optionalText(1000),
  propertyReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
});

const linkSchema = z.object({ propertyReference: z.string().trim().toUpperCase().min(1, "Συμπληρώστε κωδικό ακινήτου.").max(20) });
const noteSchema = z.object({ text: z.string().trim().min(1, "Γράψτε σημείωση.").max(4000) });

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));
const nameOf = (a: Actor) => `${a.firstName} ${a.lastName}`.trim() || a.email;
const stageLabel = (s: string) => SELLER_STAGE_LABELS[s as keyof typeof SELLER_STAGE_LABELS] ?? s;

function visibleTo(actor: Actor): Prisma.SellerLeadWhereInput {
  if (roleAtLeast(actor.role, "MANAGER")) return {};
  return { OR: [{ agentId: actor.id }, { createdById: actor.id }] };
}

async function loadOwned(actor: Actor, id: string) {
  const lead = await db().sellerLead.findFirst({ where: { AND: [{ id }, visibleTo(actor)] } });
  if (!lead) throw notFound("Ο ιδιοκτήτης δεν βρέθηκε.");
  return lead;
}

async function event(tx: Prisma.TransactionClient, sellerLeadId: string, actor: Actor, type: string, summary: string, data?: Record<string, unknown>) {
  await tx.sellerLeadEvent.create({
    data: { sellerLeadId, type, summary, data: data as Prisma.InputJsonValue | undefined, actorId: actor.id, actorName: nameOf(actor) },
  });
}

/** The follow-up becomes a task so it appears in Υπενθυμίσεις. */
async function followUpTask(
  tx: Prisma.TransactionClient,
  lead: { reference: string; ownerName: string; propertyId: string | null; agentId: string | null },
  dueAt: Date,
  actor: Actor,
) {
  await tx.task.create({
    data: {
      title: `Επικοινωνία με ιδιοκτήτη ${lead.ownerName} (${lead.reference})`,
      description: `Ιδιοκτήτες → ${lead.reference}`,
      dueAt,
      assignedToId: lead.agentId ?? actor.id,
      propertyId: lead.propertyId,
      createdById: actor.id,
    },
  });
}

function meta(request: FastifyRequest) {
  return { ipAddress: clientIp(request), userAgent: userAgent(request) };
}

const ownerRole = (listingType: string) => (listingType === "RENT" ? "LANDLORD" : "SELLER");

export async function sellerRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  app.get("/sellers", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const q = parseInput(listSchema, request.query);
    const manager = roleAtLeast(actor.role, "MANAGER");
    const mine = !manager || q.scope === "mine";
    const scopeWhere: Prisma.SellerLeadWhereInput = mine ? { OR: [{ agentId: actor.id }, { createdById: actor.id }] } : {};
    const now = new Date();
    const where: Prisma.SellerLeadWhereInput = {
      AND: [
        scopeWhere,
        q.stage === "OPEN" ? { stage: { in: SELLER_OPEN_STAGES } } : q.stage ? { stage: q.stage } : {},
        q.followUp === "due" ? { stage: { in: SELLER_OPEN_STAGES }, nextFollowUpAt: { lte: now } } : {},
        q.q
          ? {
              OR: [
                { ownerName: { contains: q.q, mode: "insensitive" } },
                { reference: { contains: q.q.toUpperCase() } },
                { areaName: { contains: q.q, mode: "insensitive" } },
                { city: { contains: q.q, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    };
    const take = 25;
    const [rows, total, counts, due] = await Promise.all([
      db().sellerLead.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        take,
        skip: (q.page - 1) * take,
        include: {
          agent: { select: { id: true, firstName: true, lastName: true } },
          property: { select: { id: true, reference: true } },
          valuations: { where: { status: "FINAL" }, orderBy: { finalizedAt: "desc" }, take: 1, select: { recommendedPrice: true, estimate: true } },
        },
      }),
      db().sellerLead.count({ where }),
      db().sellerLead.groupBy({ by: ["stage"], where: scopeWhere, _count: { _all: true } }),
      db().sellerLead.count({ where: { AND: [scopeWhere, { stage: { in: SELLER_OPEN_STAGES }, nextFollowUpAt: { lte: now } }] } }),
    ]);
    return {
      data: rows.map((s) => ({
        id: s.id,
        reference: s.reference,
        stage: s.stage,
        listingType: s.listingType,
        ownerName: s.ownerName,
        propertyType: s.propertyType,
        areaName: s.areaName,
        city: s.city,
        area: n(s.area),
        askingPrice: n(s.askingPrice),
        valuation: s.valuations[0] ? n(s.valuations[0].recommendedPrice ?? s.valuations[0].estimate) : null,
        property: s.property,
        agent: s.agent,
        nextFollowUpAt: s.nextFollowUpAt,
        followUpDue: SELLER_OPEN_STAGES.includes(s.stage as never) && !!s.nextFollowUpAt && s.nextFollowUpAt <= now,
        updatedAt: s.updatedAt,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.stage, c._count._all])),
      followUpsDue: due,
      scope: mine ? "mine" : "all",
      pagination: { page: q.page, limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
    };
  });

  app.post("/sellers", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const input = parseInput(createSchema, request.body);

    if ((input.phone || input.email) && !hasEncryptionKey()) {
      throw conflict("Τα στοιχεία επικοινωνίας αποθηκεύονται μόνο κρυπτογραφημένα και η κρυπτογράφηση δεν έχει ρυθμιστεί (PII_ENCRYPTION_KEY).");
    }

    let contact: { id: string; firstName: string; lastName: string; roles: string[] } | null = null;
    if (input.contactReference) {
      contact = await db().contact.findUnique({ where: { reference: input.contactReference }, select: { id: true, firstName: true, lastName: true, roles: true } });
      if (!contact) throw badRequest("Δεν βρέθηκε επαφή με αυτόν τον κωδικό.", { contactReference: ["Άγνωστος κωδικός επαφής."] });
    }
    const property = input.propertyReference ? await db().property.findUnique({ where: { reference: input.propertyReference } }) : null;
    if (input.propertyReference && !property) throw badRequest("Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό.", { propertyReference: ["Άγνωστος κωδικός ακινήτου."] });

    const role = ownerRole(input.listingType);
    const created = await db().$transaction(async (tx) => {
      let contactId = contact?.id ?? null;
      let ownerName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim();

      if (!contact) {
        // Same person by email → the existing contact, never a duplicate.
        const emailHash = hashEmail(input.email);
        const existing = emailHash ? await tx.contact.findFirst({ where: { emailHash }, select: { id: true, roles: true, firstName: true, lastName: true } }) : null;
        if (existing) {
          contactId = existing.id;
          ownerName = `${existing.firstName} ${existing.lastName}`.trim() || ownerName;
          if (!existing.roles.includes(role)) await tx.contact.update({ where: { id: existing.id }, data: { roles: { push: role } } });
        } else {
          const c = await tx.contact.create({
            data: {
              reference: await allocateReference(tx, "contact", "C"),
              firstName: input.firstName ?? "",
              lastName: input.lastName ?? "",
              roles: [role],
              emailHash,
              emailEncrypted: encryptField(input.email),
              phoneEncrypted: encryptField(input.phone),
              phoneHash: hashPhone(input.phone),
            },
            select: { id: true },
          });
          contactId = c.id;
        }
      } else if (!contact.roles.includes(role)) {
        await tx.contact.update({ where: { id: contact.id }, data: { roles: { push: role } } });
      }

      const reference = await allocateReference(tx, "seller", "SEL");
      const lead = await tx.sellerLead.create({
        data: {
          reference,
          listingType: input.listingType,
          contactId,
          ownerName,
          propertyId: property?.id ?? null,
          propertyType: input.propertyType ?? property?.propertyType ?? null,
          city: input.city ?? property?.city ?? null,
          areaName: input.areaName ?? property?.areaName ?? null,
          address: input.address,
          area: input.area ?? n(property?.area),
          bedrooms: input.bedrooms ?? property?.bedrooms ?? null,
          floor: input.floor ?? property?.floor ?? null,
          yearBuilt: input.yearBuilt ?? property?.yearBuilt ?? null,
          condition: input.condition ?? property?.condition ?? null,
          askingPrice: input.askingPrice,
          motivation: input.motivation,
          timeframe: input.timeframe,
          source: input.source,
          nextFollowUpAt: input.nextFollowUpAt,
          notes: input.notes,
          agentId: actor.id,
          createdById: actor.id,
        },
      });
      await event(tx, lead.id, actor, "CREATED", `Νέος ιδιοκτήτης ${ownerName}${property ? ` για ${property.reference}` : ""}`);
      if (input.nextFollowUpAt) await followUpTask(tx, lead, input.nextFollowUpAt, actor);
      return lead;
    });
    await writeAudit({ entity: "SELLER_LEAD", entityId: created.id, action: "create", actorId: actor.id, ...meta(request) });
    return { seller: { id: created.id, reference: created.reference } };
  });

  app.get("/sellers/:id", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadOwned(actor, id);
    const s = await db().sellerLead.findUniqueOrThrow({
      where: { id },
      include: {
        contact: { select: { id: true, reference: true, firstName: true, lastName: true, emailEncrypted: true, phoneEncrypted: true, mobileEncrypted: true } },
        property: { select: { id: true, reference: true, titleEl: true, status: true, price: true, monthlyRent: true } },
        agent: { select: { id: true, firstName: true, lastName: true } },
        events: { orderBy: { createdAt: "desc" }, take: 200 },
        valuations: { orderBy: { createdAt: "desc" }, select: { id: true, reference: true, status: true, estimate: true, low: true, high: true, recommendedPrice: true, createdAt: true } },
      },
    });
    const now = new Date();
    const { contact } = s;
    return {
      seller: {
        id: s.id,
        reference: s.reference,
        stage: s.stage,
        stageLabel: stageLabel(s.stage),
        nextStages: nextSellerStages(s.stage),
        listingType: s.listingType,
        ownerName: s.ownerName,
        contact: contact
          ? {
              id: contact.id,
              reference: contact.reference,
              name: `${contact.firstName} ${contact.lastName}`.trim(),
              email: decryptField(contact.emailEncrypted),
              phone: decryptField(contact.phoneEncrypted) ?? decryptField(contact.mobileEncrypted),
            }
          : null,
        property: s.property ? { ...s.property, price: n(s.property.price), monthlyRent: n(s.property.monthlyRent) } : null,
        propertyType: s.propertyType,
        city: s.city,
        areaName: s.areaName,
        address: s.address,
        area: n(s.area),
        bedrooms: s.bedrooms,
        floor: s.floor,
        yearBuilt: s.yearBuilt,
        condition: s.condition,
        askingPrice: n(s.askingPrice),
        motivation: s.motivation,
        timeframe: s.timeframe,
        source: s.source,
        agent: s.agent,
        nextFollowUpAt: s.nextFollowUpAt,
        followUpDue: SELLER_OPEN_STAGES.includes(s.stage as never) && !!s.nextFollowUpAt && s.nextFollowUpAt <= now,
        listedAt: s.listedAt,
        lostAt: s.lostAt,
        lostReason: s.lostReason,
        notes: s.notes,
        daysInPipeline: daysBetween(s.createdAt, s.listedAt ?? s.lostAt ?? now),
        createdAt: s.createdAt,
        events: s.events.map((e) => ({ id: e.id, type: e.type, summary: e.summary, actorName: e.actorName, createdAt: e.createdAt })),
        valuations: s.valuations.map((v) => ({
          ...v,
          estimate: n(v.estimate),
          low: n(v.low),
          high: n(v.high),
          recommendedPrice: n(v.recommendedPrice),
        })),
      },
    };
  });

  app.patch("/sellers/:id", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const lead = await loadOwned(actor, id);
    if (lead.stage === "LISTED" || lead.stage === "LOST") throw conflict("Ο ιδιοκτήτης δεν είναι πλέον ανοιχτός στη ροή.");
    const input = parseInput(updateSchema, request.body);
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Prisma.SellerLeadUpdateInput;
    const changed = Object.keys(data);
    if (changed.length === 0) return { ok: true };
    const followUpChanged =
      input.nextFollowUpAt !== undefined && (input.nextFollowUpAt?.getTime() ?? null) !== (lead.nextFollowUpAt?.getTime() ?? null);

    await db().$transaction(async (tx) => {
      await tx.sellerLead.update({ where: { id }, data });
      await event(tx, id, actor, "UPDATED", "Ενημέρωση στοιχείων", { fields: changed });
      if (followUpChanged && input.nextFollowUpAt) {
        await followUpTask(tx, lead, input.nextFollowUpAt, actor);
        await event(tx, id, actor, "FOLLOW_UP", `Επόμενη επικοινωνία ${input.nextFollowUpAt.toISOString().slice(0, 10)}`);
      }
    });
    await writeAudit({ entity: "SELLER_LEAD", entityId: id, action: "update", changes: { fields: changed }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  app.post("/sellers/:id/stage", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const lead = await loadOwned(actor, id);
    const input = parseInput(stageSchema, request.body);
    if (!canMoveSeller(lead.stage, input.stage)) {
      throw conflict(`Δεν επιτρέπεται η μετάβαση ${stageLabel(lead.stage)} → ${stageLabel(input.stage)}.`);
    }
    if (input.stage === "LOST" && !input.reason) throw badRequest("Συμπληρώστε τον λόγο.", { reason: ["Απαιτείται λόγος."] });

    let propertyId = lead.propertyId;
    if (input.stage === "LISTED") {
      if (input.propertyReference) {
        const p = await db().property.findUnique({ where: { reference: input.propertyReference }, select: { id: true } });
        if (!p) throw badRequest("Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό.", { propertyReference: ["Άγνωστος κωδικός ακινήτου."] });
        propertyId = p.id;
      }
      if (!propertyId) {
        throw badRequest("Για «Καταχωρήθηκε» συνδέστε πρώτα το ακίνητο.", { propertyReference: ["Δώστε τον κωδικό του ακινήτου."] });
      }
    }

    const now = new Date();
    await db().$transaction(async (tx) => {
      await tx.sellerLead.update({
        where: { id },
        data: {
          stage: input.stage,
          propertyId,
          listedAt: input.stage === "LISTED" ? now : lead.listedAt,
          lostAt: input.stage === "LOST" ? now : input.stage === "NEW" ? null : lead.lostAt,
          lostReason: input.stage === "LOST" ? input.reason : input.stage === "NEW" ? null : lead.lostReason,
        },
      });
      // Listing an owner's property records them as its owner, unless the
      // property already has one (never silently replaced).
      if (input.stage === "LISTED" && propertyId && lead.contactId) {
        await tx.property.updateMany({ where: { id: propertyId, ownerId: null }, data: { ownerId: lead.contactId } });
      }
      await event(
        tx,
        id,
        actor,
        "STAGE",
        `${stageLabel(lead.stage)} → ${stageLabel(input.stage)}${input.reason ? `: ${input.reason}` : ""}`,
        { from: lead.stage, to: input.stage },
      );
    });
    await writeAudit({
      entity: "SELLER_LEAD",
      entityId: id,
      action: "stage",
      changes: { from: lead.stage, to: input.stage },
      actorId: actor.id,
      ...meta(request),
    });
    return { ok: true };
  });

  app.post("/sellers/:id/property", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const lead = await loadOwned(actor, id);
    const input = parseInput(linkSchema, request.body);
    const property = await db().property.findUnique({ where: { reference: input.propertyReference }, select: { id: true, reference: true } });
    if (!property) throw badRequest("Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό.", { propertyReference: ["Άγνωστος κωδικός ακινήτου."] });
    if (lead.propertyId === property.id) return { ok: true };
    await db().$transaction(async (tx) => {
      await tx.sellerLead.update({ where: { id }, data: { propertyId: property.id } });
      await event(tx, id, actor, "PROPERTY", `Σύνδεση με ακίνητο ${property.reference}`);
    });
    await writeAudit({ entity: "SELLER_LEAD", entityId: id, action: "link_property", changes: { propertyId: property.id }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  app.post("/sellers/:id/notes", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadOwned(actor, id);
    const input = parseInput(noteSchema, request.body);
    await db().$transaction((tx) => event(tx, id, actor, "NOTE", input.text));
    return { ok: true };
  });

  // --- Owner report ------------------------------------------------------------

  /**
   * Activity on an owner's properties, for the owner conversation: days on
   * market, price changes, enquiries, viewings with their feedback, offers.
   * Buyers are counted, never named.
   */
  app.get("/contacts/:id/owner-report", agent, async (request) => {
    const { id } = request.params as { id: string };
    const contact = await db().contact.findUnique({ where: { id }, select: { id: true, reference: true, firstName: true, lastName: true } });
    if (!contact) throw notFound("Η επαφή δεν βρέθηκε.");
    const now = new Date();
    const properties = await db().property.findMany({
      where: { ownerId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reference: true,
        titleEl: true,
        status: true,
        listingType: true,
        price: true,
        monthlyRent: true,
        publishedAt: true,
        createdAt: true,
        priceHistory: { orderBy: { createdAt: "asc" }, select: { fromPrice: true, toPrice: true, fromMonthlyRent: true, toMonthlyRent: true, createdAt: true } },
        statusHistory: { where: { toStatus: { in: ["SOLD", "RENTED", "ARCHIVED", "INACTIVE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        _count: { select: { leads: true } },
        viewings: { select: { status: true, startsAt: true, feedback: true, outcome: true }, orderBy: { startsAt: "desc" } },
        offers: { select: { amount: true, status: true, party: true, createdAt: true } },
        transactions: { select: { reference: true, status: true, agreedAmount: true } },
        valuations: { where: { status: "FINAL" }, orderBy: { finalizedAt: "desc" }, take: 1, select: { reference: true, recommendedPrice: true, estimate: true, low: true, high: true, finalizedAt: true } },
      },
    });

    const offMarket = (status: string) => ["SOLD", "RENTED", "ARCHIVED", "INACTIVE"].includes(status);
    return {
      owner: { id: contact.id, reference: contact.reference, name: `${contact.firstName} ${contact.lastName}`.trim() },
      generatedAt: now,
      properties: properties.map((p) => {
        const since = p.publishedAt ?? p.createdAt;
        const until = offMarket(p.status) ? (p.statusHistory[0]?.createdAt ?? now) : now;
        const buyerOffers = p.offers.filter((o) => o.party === "BUYER");
        const v = p.valuations[0];
        return {
          id: p.id,
          reference: p.reference,
          title: p.titleEl,
          status: p.status,
          listingType: p.listingType,
          price: n(p.listingType === "RENT" ? (p.monthlyRent ?? p.price) : p.price),
          daysOnMarket: daysBetween(since, until),
          priceChanges: p.priceHistory.map((h) => ({
            from: n(p.listingType === "RENT" ? (h.fromMonthlyRent ?? h.fromPrice) : h.fromPrice),
            to: n(p.listingType === "RENT" ? (h.toMonthlyRent ?? h.toPrice) : h.toPrice),
            at: h.createdAt,
          })),
          enquiries: p._count.leads,
          viewings: {
            total: p.viewings.length,
            completed: p.viewings.filter((x) => x.status === "COMPLETED").length,
            upcoming: p.viewings.filter((x) => x.status === "SCHEDULED" && x.startsAt > now).length,
            feedback: p.viewings
              .filter((x) => x.status === "COMPLETED" && (x.feedback || x.outcome))
              .slice(0, 10)
              .map((x) => ({ at: x.startsAt, feedback: x.feedback, outcome: x.outcome })),
          },
          offers: {
            total: buyerOffers.length,
            highest: buyerOffers.length ? Math.max(...buyerOffers.map((o) => Number(o.amount))) : null,
            open: buyerOffers.filter((o) => o.status === "SUBMITTED").length,
          },
          transactions: p.transactions.map((t) => ({ reference: t.reference, status: t.status, agreedAmount: n(t.agreedAmount) })),
          valuation: v
            ? { reference: v.reference, recommendedPrice: n(v.recommendedPrice), estimate: n(v.estimate), low: n(v.low), high: n(v.high), finalizedAt: v.finalizedAt }
            : null,
        };
      }),
    };
  });
}
