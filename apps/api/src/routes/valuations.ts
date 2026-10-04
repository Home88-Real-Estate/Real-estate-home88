/**
 * Valuations (Εκτιμήσεις): comparative market analysis.
 *
 *  - The subject is a snapshot of a property, a seller lead or details typed
 *    in, so later edits to those records do not rewrite a valuation.
 *  - Comparables come from HOME88's own data (closed transactions, listings)
 *    or are entered by the agent from an external source. Internal values are
 *    read from the database, never taken from the client.
 *  - The estimate is the median adjusted €/m² of the included comparables,
 *    with a range (see @home88/domain valuate). Each adjustment is the agent's
 *    and needs a reason. No discounts or premiums are assumed.
 *  - Finalising records the agent's recommended price and reasoning; a FINAL
 *    valuation is frozen by the database. To revise it, duplicate it.
 *
 * Visibility: managers and above see every valuation; others see the ones
 * they are the agent of or created.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import { comparableSimilarity, valuate, VALUATION_CONFIDENCE_LABELS } from "@home88/domain";

import { writeAudit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
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
  .transform((v) => (v ? new Date(`${v}T12:00:00Z`) : null));

const PROPERTY_TYPES = [
  "APARTMENT", "MAISONETTE", "HOUSE", "VILLA", "STUDIO", "OFFICE", "SHOP", "WAREHOUSE",
  "BUILDING", "HOTEL", "LAND", "PLOT", "PARKING", "INDUSTRIAL", "OTHER",
] as const;
const CONDITIONS = ["NEW_BUILD", "RENOVATED", "GOOD", "NEEDS_RENOVATION", "UNDER_CONSTRUCTION"] as const;
const condition = z.enum(CONDITIONS).optional().or(z.literal("")).transform((v) => (v ? v : null));

const subjectShape = {
  propertyType: z.enum(PROPERTY_TYPES),
  city: optionalText(120),
  areaName: optionalText(120),
  area: optionalNumber(100_000),
  bedrooms: optionalInt(0, 50),
  floor: optionalInt(-5, 100),
  yearBuilt: optionalInt(1800, 2100),
  condition,
};

const createSchema = z
  .object({
    listingType: z.enum(["SALE", "RENT"]).optional(),
    propertyReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
    sellerLeadId: z.string().max(40).optional().or(z.literal("")),
    propertyType: z.enum(PROPERTY_TYPES).optional().or(z.literal("")),
    city: optionalText(120),
    areaName: optionalText(120),
    area: optionalNumber(100_000),
    bedrooms: optionalInt(0, 50),
    floor: optionalInt(-5, 100),
    yearBuilt: optionalInt(1800, 2100),
    condition,
  });

const updateSchema = z.object(subjectShape).partial();

const listSchema = z.object({
  status: z.enum(["DRAFT", "FINAL"]).optional(),
  scope: z.enum(["mine", "all"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const searchSchema = z.object({
  /** Search filters chosen by the agent; they only narrow the candidate list. */
  sameArea: z.enum(["1", "0"]).default("0"),
  sizeTolerancePct: z.coerce.number().int().min(5).max(200).default(30),
  months: z.coerce.number().int().min(1).max(120).default(24),
});

const adjustment = {
  adjustmentPct: z.coerce.number().min(-50, "Έως −50%.").max(50, "Έως +50%.").default(0),
  adjustmentReason: optionalText(300),
};

const addSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("INTERNAL"),
    kind: z.enum(["SOLD", "RENTED", "ASKING"]),
    propertyId: z.string().min(1).max(40),
    ...adjustment,
  }),
  z.object({
    source: z.literal("EXTERNAL"),
    label: z.string().trim().min(1, "Συμπληρώστε περιγραφή.").max(160),
    origin: z.string().trim().min(1, "Συμπληρώστε την πηγή.").max(200),
    price: z.coerce.number().positive("Δώστε τιμή.").max(1_000_000_000),
    area: z.coerce.number().positive("Δώστε εμβαδόν.").max(100_000),
    city: optionalText(120),
    areaName: optionalText(120),
    bedrooms: optionalInt(0, 50),
    floor: optionalInt(-5, 100),
    yearBuilt: optionalInt(1800, 2100),
    condition,
    observedAt: optionalDate,
    ...adjustment,
  }),
]);

const comparableUpdateSchema = z.object({
  adjustmentPct: z.coerce.number().min(-50, "Έως −50%.").max(50, "Έως +50%.").optional(),
  adjustmentReason: optionalText(300),
  included: z.boolean().optional(),
});

const finalizeSchema = z.object({
  recommendedPrice: z.coerce.number({ invalid_type_error: "Δώστε τιμή." }).positive("Δώστε τιμή.").max(1_000_000_000),
  rationale: z.string().trim().min(1, "Γράψτε το σκεπτικό της πρότασης.").max(4000),
});

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));
const nameOf = (a: Actor) => `${a.firstName} ${a.lastName}`.trim() || a.email;
const euro = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });

function visibleTo(actor: Actor): Prisma.ValuationWhereInput {
  if (roleAtLeast(actor.role, "MANAGER")) return {};
  return { OR: [{ agentId: actor.id }, { createdById: actor.id }] };
}

async function loadOwned(actor: Actor, id: string) {
  const v = await db().valuation.findFirst({ where: { AND: [{ id }, visibleTo(actor)] } });
  if (!v) throw notFound("Η εκτίμηση δεν βρέθηκε.");
  return v;
}

function assertDraft(v: { status: string }) {
  if (v.status !== "DRAFT") throw conflict("Η εκτίμηση είναι οριστική. Δημιουργήστε αντίγραφο για αναθεώρηση.");
}

function meta(request: FastifyRequest) {
  return { ipAddress: clientIp(request), userAgent: userAgent(request) };
}

/** Recompute and store the result over the included comparables. */
async function refresh(tx: Prisma.TransactionClient, id: string) {
  const v = await tx.valuation.findUniqueOrThrow({ where: { id }, include: { comparables: true } });
  const r = valuate(n(v.area), v.comparables.map((c) => ({ price: Number(c.price), area: Number(c.area), adjustmentPct: Number(c.adjustmentPct), included: c.included })));
  const data = r.ok
    ? { compCount: r.count, medianPerSqm: r.medianPerSqm, lowPerSqm: r.lowPerSqm, highPerSqm: r.highPerSqm, estimate: r.estimate, low: r.low, high: r.high, confidence: r.confidence }
    : { compCount: 0, medianPerSqm: null, lowPerSqm: null, highPerSqm: null, estimate: null, low: null, high: null, confidence: null };
  await tx.valuation.update({ where: { id }, data });
  return r;
}

/** Price that is comparable for the listing type: the monthly rent for RENT. */
const listingPrice = (listingType: string, p: { price: Prisma.Decimal | null; monthlyRent: Prisma.Decimal | null }) =>
  n(listingType === "RENT" ? (p.monthlyRent ?? p.price) : p.price);

export async function valuationRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  app.get("/valuations", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const q = parseInput(listSchema, request.query);
    const manager = roleAtLeast(actor.role, "MANAGER");
    const mine = !manager || q.scope === "mine";
    const where: Prisma.ValuationWhereInput = {
      AND: [mine ? { OR: [{ agentId: actor.id }, { createdById: actor.id }] } : {}, q.status ? { status: q.status } : {}],
    };
    const take = 25;
    const [rows, total] = await Promise.all([
      db().valuation.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take,
        skip: (q.page - 1) * take,
        include: {
          property: { select: { id: true, reference: true } },
          sellerLead: { select: { id: true, reference: true, ownerName: true } },
          agent: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      db().valuation.count({ where }),
    ]);
    return {
      data: rows.map((v) => ({
        id: v.id,
        reference: v.reference,
        status: v.status,
        listingType: v.listingType,
        propertyType: v.propertyType,
        areaName: v.areaName,
        city: v.city,
        area: n(v.area),
        compCount: v.compCount,
        estimate: n(v.estimate),
        low: n(v.low),
        high: n(v.high),
        recommendedPrice: n(v.recommendedPrice),
        property: v.property,
        sellerLead: v.sellerLead,
        agent: v.agent,
        updatedAt: v.updatedAt,
      })),
      scope: mine ? "mine" : "all",
      pagination: { page: q.page, limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
    };
  });

  app.post("/valuations", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const input = parseInput(createSchema, request.body);

    const property = input.propertyReference ? await db().property.findUnique({ where: { reference: input.propertyReference } }) : null;
    if (input.propertyReference && !property) throw badRequest("Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό.", { propertyReference: ["Άγνωστος κωδικός ακινήτου."] });
    const seller = input.sellerLeadId
      ? await db().sellerLead.findFirst({
          where: {
            AND: [
              { id: input.sellerLeadId },
              roleAtLeast(actor.role, "MANAGER") ? {} : { OR: [{ agentId: actor.id }, { createdById: actor.id }] },
            ],
          },
        })
      : null;
    if (input.sellerLeadId && !seller) throw badRequest("Ο ιδιοκτήτης δεν βρέθηκε.");
    const linkedProperty = property ?? (seller?.propertyId ? await db().property.findUnique({ where: { id: seller.propertyId } }) : null);

    // Precedence: what was typed, then the property record, then the seller lead.
    const pick = <T>(typed: T | null | undefined, ...rest: Array<T | null | undefined>): T | null => {
      for (const v of [typed, ...rest]) if (v !== null && v !== undefined && v !== ("" as unknown)) return v;
      return null;
    };
    const propertyType = pick(input.propertyType || null, linkedProperty?.propertyType, seller?.propertyType);
    const listingType = pick(input.listingType, linkedProperty?.listingType === "RENT" ? "RENT" : linkedProperty ? "SALE" : null, seller?.listingType);
    if (!propertyType) throw badRequest("Συμπληρώστε τύπο ακινήτου.", { propertyType: ["Απαιτείται."] });
    if (!listingType) throw badRequest("Επιλέξτε πώληση ή ενοικίαση.", { listingType: ["Απαιτείται."] });

    const created = await db().$transaction(async (tx) => {
      const reference = await allocateReference(tx, "valuation", "VAL");
      const v = await tx.valuation.create({
        data: {
          reference,
          listingType,
          propertyType,
          propertyId: linkedProperty?.id ?? null,
          sellerLeadId: seller?.id ?? null,
          city: pick(input.city, linkedProperty?.city, seller?.city),
          areaName: pick(input.areaName, linkedProperty?.areaName, seller?.areaName),
          area: pick(input.area, n(linkedProperty?.area), n(seller?.area)),
          bedrooms: pick(input.bedrooms, linkedProperty?.bedrooms, seller?.bedrooms),
          floor: pick(input.floor, linkedProperty?.floor, seller?.floor),
          yearBuilt: pick(input.yearBuilt, linkedProperty?.yearBuilt, seller?.yearBuilt),
          condition: pick(input.condition, linkedProperty?.condition, seller?.condition),
          agentId: actor.id,
          createdById: actor.id,
        },
      });
      if (seller) {
        await tx.sellerLeadEvent.create({
          data: { sellerLeadId: seller.id, type: "VALUATION", summary: `Νέα εκτίμηση ${reference}`, actorId: actor.id, actorName: nameOf(actor) },
        });
      }
      return v;
    });
    await writeAudit({ entity: "VALUATION", entityId: created.id, action: "create", actorId: actor.id, ...meta(request) });
    return { valuation: { id: created.id, reference: created.reference } };
  });

  app.get("/valuations/:id", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadOwned(actor, id);
    const v = await db().valuation.findUniqueOrThrow({
      where: { id },
      include: {
        property: { select: { id: true, reference: true, titleEl: true, price: true, monthlyRent: true } },
        sellerLead: { select: { id: true, reference: true, ownerName: true, askingPrice: true } },
        agent: { select: { id: true, firstName: true, lastName: true } },
        comparables: { orderBy: [{ included: "desc" }, { similarity: "desc" }, { createdAt: "asc" }], include: { property: { select: { reference: true } } } },
      },
    });
    const live = valuate(n(v.area), v.comparables.map((c) => ({ price: Number(c.price), area: Number(c.area), adjustmentPct: Number(c.adjustmentPct), included: c.included })));
    return {
      valuation: {
        id: v.id,
        reference: v.reference,
        status: v.status,
        listingType: v.listingType,
        subject: {
          propertyType: v.propertyType,
          city: v.city,
          areaName: v.areaName,
          area: n(v.area),
          bedrooms: v.bedrooms,
          floor: v.floor,
          yearBuilt: v.yearBuilt,
          condition: v.condition,
        },
        property: v.property ? { ...v.property, price: n(v.property.price), monthlyRent: n(v.property.monthlyRent) } : null,
        sellerLead: v.sellerLead ? { ...v.sellerLead, askingPrice: n(v.sellerLead.askingPrice) } : null,
        agent: v.agent,
        comparables: v.comparables.map((c) => ({
          id: c.id,
          kind: c.kind,
          label: c.label,
          source: c.source,
          propertyReference: c.property?.reference ?? null,
          city: c.city,
          areaName: c.areaName,
          price: Number(c.price),
          area: Number(c.area),
          perSqm: Math.round((Number(c.price) / Number(c.area)) * 100) / 100,
          bedrooms: c.bedrooms,
          floor: c.floor,
          yearBuilt: c.yearBuilt,
          condition: c.condition,
          observedAt: c.observedAt,
          similarity: c.similarity,
          adjustmentPct: Number(c.adjustmentPct),
          adjustmentReason: c.adjustmentReason,
          included: c.included,
        })),
        result: live,
        confidenceLabel: live.ok ? VALUATION_CONFIDENCE_LABELS[live.confidence] : null,
        recommendedPrice: n(v.recommendedPrice),
        rationale: v.rationale,
        finalizedAt: v.finalizedAt,
        createdAt: v.createdAt,
      },
    };
  });

  app.patch("/valuations/:id", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    assertDraft(await loadOwned(actor, id));
    const input = parseInput(updateSchema, request.body);
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Prisma.ValuationUpdateInput;
    await db().$transaction(async (tx) => {
      await tx.valuation.update({ where: { id }, data });
      await refresh(tx, id);
    });
    await writeAudit({ entity: "VALUATION", entityId: id, action: "update", changes: { fields: Object.keys(data) }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  // --- Comparables -------------------------------------------------------------

  /**
   * Candidates from HOME88's own records, ranked by similarity: closed
   * transactions (the agreed price) and listings (the asking price) of the
   * same type and listing type in the same city.
   */
  app.get("/valuations/:id/comparables/search", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const v = await loadOwned(actor, id);
    const q = parseInput(searchSchema, request.query);
    const existing = await db().valuationComparable.findMany({ where: { valuationId: id, propertyId: { not: null } }, select: { propertyId: true, kind: true } });
    // One comparable per property: a property already used is not offered again.
    const taken = new Set(existing.map((e) => e.propertyId));
    const since = new Date(Date.now() - q.months * 30 * 86_400_000);
    const area = n(v.area);
    const tol = q.sizeTolerancePct / 100;

    const propertyWhere: Prisma.PropertyWhereInput = {
      propertyType: v.propertyType as never,
      listingType: v.listingType === "RENT" ? "RENT" : { not: "RENT" },
      ...(v.propertyId ? { id: { not: v.propertyId } } : {}),
      ...(v.city ? { city: { equals: v.city, mode: "insensitive" } } : {}),
      ...(q.sameArea === "1" && v.areaName ? { areaName: { equals: v.areaName, mode: "insensitive" } } : {}),
      ...(area ? { area: { gte: area * (1 - tol), lte: area * (1 + tol) } } : { area: { not: null } }),
    };
    const SELECT = {
      id: true, reference: true, titleEl: true, status: true, price: true, monthlyRent: true, area: true, city: true, areaName: true,
      bedrooms: true, floor: true, yearBuilt: true, condition: true, publishedAt: true, createdAt: true,
    } satisfies Prisma.PropertySelect;

    const [closed, listed] = await Promise.all([
      db().transaction.findMany({
        where: { status: "CLOSED", agreedAmount: { not: null }, closedAt: { gte: since }, property: propertyWhere },
        orderBy: { closedAt: "desc" },
        take: 200,
        select: { reference: true, agreedAmount: true, closedAt: true, type: true, property: { select: SELECT } },
      }),
      db().property.findMany({
        where: { ...propertyWhere, status: { in: ["ACTIVE", "UNDER_OFFER", "RESERVED", "SOLD", "RENTED", "INACTIVE"] }, updatedAt: { gte: since } },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: SELECT,
      }),
    ]);

    const subject = { area, city: v.city, areaName: v.areaName, bedrooms: v.bedrooms, floor: v.floor, yearBuilt: v.yearBuilt, condition: v.condition };
    // A property with a closed transaction is offered at its agreed price only,
    // never also at its old asking price (that would count it twice).
    const transacted = new Set(closed.map((t) => t.property.id));
    const candidates = [
      ...closed.map((t) => ({
        kind: t.type === "RENT" ? "RENTED" : "SOLD",
        p: t.property,
        price: Number(t.agreedAmount),
        observedAt: t.closedAt,
        note: `Συναλλαγή ${t.reference}`,
      })),
      ...listed.filter((p) => !transacted.has(p.id)).map((p) => ({ kind: "ASKING", p, price: listingPrice(v.listingType, p), observedAt: p.publishedAt ?? p.createdAt, note: null as string | null })),
    ]
      .filter((c) => c.price && c.price > 0 && c.p.area && !taken.has(c.p.id))
      .map((c) => {
        const cArea = Number(c.p.area);
        const cand = { area: cArea, city: c.p.city, areaName: c.p.areaName, bedrooms: c.p.bedrooms, floor: c.p.floor, yearBuilt: c.p.yearBuilt, condition: c.p.condition, price: c.price };
        return {
          kind: c.kind,
          propertyId: c.p.id,
          reference: c.p.reference,
          title: c.p.titleEl,
          city: c.p.city,
          areaName: c.p.areaName,
          price: c.price!,
          area: cArea,
          perSqm: Math.round((c.price! / cArea) * 100) / 100,
          bedrooms: c.p.bedrooms,
          floor: c.p.floor,
          yearBuilt: c.p.yearBuilt,
          condition: c.p.condition,
          observedAt: c.observedAt,
          note: c.note,
          similarity: comparableSimilarity(subject, cand),
        };
      })
      .sort((a, b) => b.similarity - a.similarity || (a.kind === "ASKING" ? 1 : 0) - (b.kind === "ASKING" ? 1 : 0))
      .slice(0, 30);

    return { candidates, filters: q };
  });

  app.post("/valuations/:id/comparables", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const v = await loadOwned(actor, id);
    assertDraft(v);
    const input = parseInput(addSchema, request.body);
    if (input.adjustmentPct !== 0 && !input.adjustmentReason) {
      throw badRequest("Γράψτε τον λόγο της προσαρμογής.", { adjustmentReason: ["Απαιτείται όταν υπάρχει προσαρμογή."] });
    }
    const subject = { area: n(v.area), city: v.city, areaName: v.areaName, bedrooms: v.bedrooms, floor: v.floor, yearBuilt: v.yearBuilt, condition: v.condition };

    let data: Prisma.ValuationComparableUncheckedCreateInput;
    if (input.source === "INTERNAL") {
      const p = await db().property.findUnique({ where: { id: input.propertyId } });
      if (!p || !p.area) throw badRequest("Το ακίνητο δεν έχει εμβαδόν και δεν μπορεί να χρησιμοποιηθεί.");
      let price: number | null;
      let observedAt: Date | null;
      if (input.kind === "ASKING") {
        price = listingPrice(v.listingType, p);
        observedAt = p.publishedAt ?? p.createdAt;
      } else {
        const t = await db().transaction.findFirst({
          where: { propertyId: p.id, status: "CLOSED", agreedAmount: { not: null }, type: input.kind === "RENTED" ? "RENT" : "SALE" },
          orderBy: { closedAt: "desc" },
        });
        if (!t) throw badRequest("Δεν υπάρχει ολοκληρωμένη συναλλαγή για αυτό το ακίνητο.");
        price = Number(t.agreedAmount);
        observedAt = t.closedAt;
      }
      if (!price || price <= 0) throw badRequest("Το ακίνητο δεν έχει τιμή.");
      const dup = await db().valuationComparable.findFirst({ where: { valuationId: id, propertyId: p.id } });
      if (dup) throw conflict("Το ακίνητο έχει ήδη προστεθεί ως συγκριτικό.");
      data = {
        valuationId: id,
        kind: input.kind,
        propertyId: p.id,
        label: p.reference,
        source: "HOME88",
        city: p.city,
        areaName: p.areaName,
        price,
        area: Number(p.area),
        bedrooms: p.bedrooms,
        floor: p.floor,
        yearBuilt: p.yearBuilt,
        condition: p.condition,
        observedAt,
        similarity: comparableSimilarity(subject, { area: Number(p.area), city: p.city, areaName: p.areaName, bedrooms: p.bedrooms, floor: p.floor, yearBuilt: p.yearBuilt, condition: p.condition, price }),
        adjustmentPct: input.adjustmentPct,
        adjustmentReason: input.adjustmentReason,
      };
    } else {
      data = {
        valuationId: id,
        kind: "EXTERNAL",
        label: input.label,
        source: input.origin,
        city: input.city,
        areaName: input.areaName,
        price: input.price,
        area: input.area,
        bedrooms: input.bedrooms,
        floor: input.floor,
        yearBuilt: input.yearBuilt,
        condition: input.condition,
        observedAt: input.observedAt,
        similarity: comparableSimilarity(subject, { ...input, price: input.price }),
        adjustmentPct: input.adjustmentPct,
        adjustmentReason: input.adjustmentReason,
      };
    }

    const created = await db().$transaction(async (tx) => {
      const c = await tx.valuationComparable.create({ data });
      await refresh(tx, id);
      return c;
    });
    await writeAudit({ entity: "VALUATION", entityId: id, action: "add_comparable", changes: { comparableId: created.id, kind: created.kind, label: created.label }, actorId: actor.id, ...meta(request) });
    return { comparable: { id: created.id } };
  });

  app.patch("/valuations/:id/comparables/:cid", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id, cid } = request.params as { id: string; cid: string };
    assertDraft(await loadOwned(actor, id));
    const c = await db().valuationComparable.findFirst({ where: { id: cid, valuationId: id } });
    if (!c) throw notFound("Το συγκριτικό δεν βρέθηκε.");
    const input = parseInput(comparableUpdateSchema, request.body);
    const pct = input.adjustmentPct ?? Number(c.adjustmentPct);
    const reason = input.adjustmentReason !== undefined ? input.adjustmentReason : c.adjustmentReason;
    if (pct !== 0 && !reason) throw badRequest("Γράψτε τον λόγο της προσαρμογής.", { adjustmentReason: ["Απαιτείται όταν υπάρχει προσαρμογή."] });
    await db().$transaction(async (tx) => {
      await tx.valuationComparable.update({
        where: { id: cid },
        data: { adjustmentPct: pct, adjustmentReason: pct === 0 ? reason || null : reason, included: input.included ?? c.included },
      });
      await refresh(tx, id);
    });
    await writeAudit({
      entity: "VALUATION",
      entityId: id,
      action: "update_comparable",
      changes: { comparableId: cid, adjustmentPct: { from: Number(c.adjustmentPct), to: pct }, included: input.included ?? c.included },
      actorId: actor.id,
      ...meta(request),
    });
    return { ok: true };
  });

  app.delete("/valuations/:id/comparables/:cid", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id, cid } = request.params as { id: string; cid: string };
    assertDraft(await loadOwned(actor, id));
    const c = await db().valuationComparable.findFirst({ where: { id: cid, valuationId: id } });
    if (!c) throw notFound("Το συγκριτικό δεν βρέθηκε.");
    await db().$transaction(async (tx) => {
      await tx.valuationComparable.delete({ where: { id: cid } });
      await refresh(tx, id);
    });
    await writeAudit({ entity: "VALUATION", entityId: id, action: "remove_comparable", changes: { comparableId: cid, label: c.label }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  // --- Finalise / duplicate -------------------------------------------------------

  app.post("/valuations/:id/finalize", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const v = await loadOwned(actor, id);
    assertDraft(v);
    const input = parseInput(finalizeSchema, request.body);
    await db().$transaction(async (tx) => {
      const r = await refresh(tx, id);
      if (!r.ok) throw badRequest(`Η εκτίμηση δεν μπορεί να οριστικοποιηθεί. Λείπουν: ${r.missing.join(", ")}.`);
      await tx.valuation.update({
        where: { id },
        data: { status: "FINAL", recommendedPrice: input.recommendedPrice, rationale: input.rationale, finalizedAt: new Date(), finalizedById: actor.id },
      });
      if (v.sellerLeadId) {
        await tx.sellerLeadEvent.create({
          data: {
            sellerLeadId: v.sellerLeadId,
            type: "VALUATION_FINAL",
            summary: `Οριστική εκτίμηση ${v.reference}: πρόταση ${euro.format(input.recommendedPrice)} € (εύρος ${euro.format(r.low)}–${euro.format(r.high)} €)`,
            actorId: actor.id,
            actorName: nameOf(actor),
          },
        });
      }
    });
    await writeAudit({ entity: "VALUATION", entityId: id, action: "finalize", changes: { recommendedPrice: input.recommendedPrice }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  app.post("/valuations/:id/duplicate", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadOwned(actor, id);
    const v = await db().valuation.findUniqueOrThrow({ where: { id }, include: { comparables: true } });
    const copy = await db().$transaction(async (tx) => {
      const reference = await allocateReference(tx, "valuation", "VAL");
      const c = await tx.valuation.create({
        data: {
          reference,
          listingType: v.listingType,
          propertyType: v.propertyType,
          propertyId: v.propertyId,
          sellerLeadId: v.sellerLeadId,
          city: v.city,
          areaName: v.areaName,
          area: v.area,
          bedrooms: v.bedrooms,
          floor: v.floor,
          yearBuilt: v.yearBuilt,
          condition: v.condition,
          agentId: actor.id,
          createdById: actor.id,
        },
      });
      if (v.comparables.length) {
        await tx.valuationComparable.createMany({
          data: v.comparables.map(({ id: _id, valuationId: _v, createdAt: _c, ...rest }) => ({ ...rest, valuationId: c.id })),
        });
      }
      await refresh(tx, c.id);
      return c;
    });
    await writeAudit({ entity: "VALUATION", entityId: copy.id, action: "duplicate", changes: { from: v.reference }, actorId: actor.id, ...meta(request) });
    return { valuation: { id: copy.id, reference: copy.reference } };
  });
}
