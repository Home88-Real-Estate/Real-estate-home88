/**
 * Transactions (Συναλλαγές): the commercial record from first offer to closing.
 *
 *  - Negotiation is a chain of offer rounds. A counter-offer is a new round;
 *    an earlier round is never edited (the database enforces this too).
 *  - Accepting a round moves the transaction to AGREEMENT with that amount.
 *  - The commission is calculated from Settings → Προμήθειες and stored as a
 *    snapshot. With no configured rules nothing is calculated: the response
 *    lists what has to be set. Overrides and payment status are manager-only.
 *  - Every step is written to the append-only timeline and the audit log.
 *
 * Visibility: managers and above see every transaction; others see the ones
 * they are the agent of or created.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import {
  calculateCommission,
  canMoveTransaction,
  CHECKLIST_STATUSES,
  COMMISSION_STATUSES,
  commissionDisplayStatus,
  OFFER_STATUS_LABELS,
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_STATUSES,
} from "@home88/domain";

import { writeAudit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { allocateReference } from "../lib/references";
import { requireRole, roleAtLeast } from "../plugins/auth";
import { commissionRules } from "../settings";

type Actor = { id: string; role: string; firstName: string; lastName: string; email: string };

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : null));
const money = z.coerce.number({ invalid_type_error: "Δώστε ποσό." }).positive("Το ποσό πρέπει να είναι θετικό.").max(1_000_000_000);
const optionalMoney = z
  .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().nonnegative().max(1_000_000_000)])
  .transform((v) => (v === "" || v === null || v === undefined ? null : v));
const optionalDate = z
  .union([z.literal(""), z.null(), z.undefined(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ημερομηνία ΕΕΕΕ-ΜΜ-ΗΗ.")])
  .transform((v) => (v ? new Date(`${v}T12:00:00Z`) : null));

const listSchema = z.object({
  status: z.enum([...TRANSACTION_STATUSES, "OPEN"]).optional(),
  scope: z.enum(["mine", "all"]).optional(),
  propertyId: z.string().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const createSchema = z.object({
  propertyReference: z.string().trim().toUpperCase().min(1, "Συμπληρώστε: Κωδικός ακινήτου.").max(20),
  buyerName: z.string().trim().min(1, "Συμπληρώστε: Αγοραστής / μισθωτής.").max(160),
  buyerPhone: optionalText(40),
  buyerEmail: z.string().trim().toLowerCase().email("Δώστε έγκυρο email.").max(254).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  leadReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
  expectedCloseAt: optionalDate,
  notes: optionalText(4000),
});

const offerSchema = z.object({
  party: z.enum(["BUYER", "SELLER"]),
  amount: money,
  conditions: optionalText(4000),
  financing: z.enum(["CASH", "MORTGAGE", "MIXED", "UNKNOWN"]).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  deposit: optionalMoney,
  expiresAt: optionalDate,
  notes: optionalText(2000),
});

const respondSchema = z.object({ action: z.enum(["ACCEPT", "REJECT", "WITHDRAW"]), note: optionalText(1000) });

const statusSchema = z.object({
  status: z.enum(TRANSACTION_STATUSES),
  date: optionalDate,
  reason: optionalText(1000),
});

const calculateSchema = z.object({
  overrideRate: optionalMoney,
  overrideReason: optionalText(500),
});

const commissionUpdateSchema = z.object({
  status: z.enum(COMMISSION_STATUSES),
  invoiceNumber: optionalText(60),
  dueDate: optionalDate,
  paidAmount: optionalMoney,
});

const checklistCreateSchema = z.object({ label: z.string().trim().min(1, "Συμπληρώστε περιγραφή.").max(200) });
const checklistUpdateSchema = z.object({ status: z.enum(CHECKLIST_STATUSES), note: optionalText(1000) });
const noteSchema = z.object({ text: z.string().trim().min(1, "Γράψτε σημείωση.").max(4000) });

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));
const euro = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });
const fmt = (v: number) => `${euro.format(v)} €`;
const nameOf = (a: Actor) => `${a.firstName} ${a.lastName}`.trim() || a.email;

function visibleTo(actor: Actor): Prisma.TransactionWhereInput {
  if (roleAtLeast(actor.role, "MANAGER")) return {};
  return { OR: [{ agentId: actor.id }, { createdById: actor.id }] };
}

async function loadOwned(actor: Actor, id: string) {
  const trx = await db().transaction.findFirst({ where: { AND: [{ id }, visibleTo(actor)] } });
  if (!trx) throw notFound("Η συναλλαγή δεν βρέθηκε.");
  return trx;
}

function assertOpen(trx: { status: string }) {
  if (trx.status === "CLOSED" || trx.status === "CANCELLED") throw conflict("Η συναλλαγή έχει κλείσει.");
}

async function event(
  tx: Prisma.TransactionClient,
  transactionId: string,
  actor: Actor,
  type: string,
  summary: string,
  data?: Record<string, unknown>,
) {
  await tx.transactionEvent.create({
    data: { transactionId, type, summary, data: data as Prisma.InputJsonValue | undefined, actorId: actor.id, actorName: nameOf(actor) },
  });
}

function meta(request: FastifyRequest) {
  return { ipAddress: clientIp(request), userAgent: userAgent(request) };
}

const DETAIL_INCLUDE = {
  property: { select: { id: true, reference: true, titleEl: true, listingType: true, price: true, monthlyRent: true, areaName: true, city: true, ownerId: true } },
  agent: { select: { id: true, firstName: true, lastName: true } },
  lead: { select: { id: true, reference: true } },
  offers: { orderBy: { round: "asc" as const } },
  events: { orderBy: { createdAt: "desc" as const }, take: 200 },
  commission: true,
  checklist: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }], include: { document: { select: { id: true, title: true } } } },
  documents: { orderBy: { createdAt: "desc" as const }, select: { id: true, title: true, category: true, createdAt: true } },
} satisfies Prisma.TransactionInclude;

type Detail = Prisma.TransactionGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function serialize(t: Detail, now = new Date()) {
  const latest = t.offers[t.offers.length - 1] ?? null;
  return {
    id: t.id,
    reference: t.reference,
    type: t.type,
    status: t.status,
    statusLabel: TRANSACTION_STATUS_LABELS[t.status as keyof typeof TRANSACTION_STATUS_LABELS] ?? t.status,
    property: { ...t.property, price: n(t.property.price), monthlyRent: n(t.property.monthlyRent) },
    agent: t.agent,
    lead: t.lead,
    buyerName: t.buyerName,
    buyerPhone: t.buyerPhone,
    buyerEmail: t.buyerEmail,
    agreedAmount: n(t.agreedAmount),
    acceptedOfferId: t.acceptedOfferId,
    agreementAt: t.agreementAt,
    contractAt: t.contractAt,
    expectedCloseAt: t.expectedCloseAt,
    closedAt: t.closedAt,
    cancelledAt: t.cancelledAt,
    cancelReason: t.cancelReason,
    notes: t.notes,
    createdAt: t.createdAt,
    offers: t.offers.map((o) => {
      const expired = o.status === "SUBMITTED" && o.expiresAt !== null && o.expiresAt < now;
      return {
        id: o.id,
        reference: o.reference,
        round: o.round,
        party: o.party,
        amount: n(o.amount),
        conditions: o.conditions,
        financing: o.financing,
        deposit: n(o.deposit),
        expiresAt: o.expiresAt,
        status: expired ? "EXPIRED" : o.status,
        notes: o.notes,
        createdAt: o.createdAt,
        respondedAt: o.respondedAt,
        open: o.status === "SUBMITTED" && !expired,
      };
    }),
    openOfferId: latest && latest.status === "SUBMITTED" && !(latest.expiresAt && latest.expiresAt < now) ? latest.id : null,
    events: t.events.map((e) => ({ id: e.id, type: e.type, summary: e.summary, actorName: e.actorName, createdAt: e.createdAt })),
    commission: t.commission
      ? {
          basis: t.commission.basis,
          rate: n(t.commission.rate),
          baseAmount: n(t.commission.baseAmount),
          buyerSide: n(t.commission.buyerSide),
          sellerSide: n(t.commission.sellerSide),
          net: n(t.commission.net),
          vat: n(t.commission.vat),
          gross: n(t.commission.gross),
          agentShare: n(t.commission.agentShare),
          agencyShare: n(t.commission.agencyShare),
          minimumApplied: t.commission.minimumApplied,
          overridden: t.commission.overridden,
          overrideReason: t.commission.overrideReason,
          status: commissionDisplayStatus(t.commission.status, t.commission.dueDate, now),
          storedStatus: t.commission.status,
          invoiceNumber: t.commission.invoiceNumber,
          dueDate: t.commission.dueDate ? t.commission.dueDate.toISOString().slice(0, 10) : null,
          paidAmount: n(t.commission.paidAmount),
          paidAt: t.commission.paidAt,
          calculatedAt: t.commission.calculatedAt,
        }
      : null,
    checklist: t.checklist.map((c) => ({ id: c.id, label: c.label, status: c.status, note: c.note, updatedAt: c.updatedAt, document: c.document })),
    documents: t.documents,
  };
}

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  app.get("/transactions", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const q = parseInput(listSchema, request.query);
    const manager = roleAtLeast(actor.role, "MANAGER");
    const mine = !manager || q.scope === "mine";
    const where: Prisma.TransactionWhereInput = {
      AND: [
        mine ? { OR: [{ agentId: actor.id }, { createdById: actor.id }] } : {},
        q.status === "OPEN" ? { status: { in: ["NEGOTIATION", "AGREEMENT", "CONTRACT"] } } : q.status ? { status: q.status } : {},
        q.propertyId ? { propertyId: q.propertyId } : {},
      ],
    };
    const take = 25;
    const [rows, total, counts] = await Promise.all([
      db().transaction.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take,
        skip: (q.page - 1) * take,
        include: {
          property: { select: { id: true, reference: true, titleEl: true } },
          agent: { select: { id: true, firstName: true, lastName: true } },
          commission: { select: { gross: true, status: true, dueDate: true } },
          offers: { orderBy: { round: "desc" }, take: 1, select: { amount: true, party: true, status: true } },
        },
      }),
      db().transaction.count({ where }),
      db().transaction.groupBy({ by: ["status"], where: mine ? { OR: [{ agentId: actor.id }, { createdById: actor.id }] } : {}, _count: { _all: true } }),
    ]);
    return {
      data: rows.map((t) => ({
        id: t.id,
        reference: t.reference,
        type: t.type,
        status: t.status,
        property: t.property,
        agent: t.agent,
        buyerName: t.buyerName,
        agreedAmount: n(t.agreedAmount),
        lastOffer: t.offers[0] ? { amount: n(t.offers[0].amount), party: t.offers[0].party, status: t.offers[0].status } : null,
        commission: t.commission ? { gross: n(t.commission.gross), status: commissionDisplayStatus(t.commission.status, t.commission.dueDate) } : null,
        updatedAt: t.updatedAt,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      scope: mine ? "mine" : "all",
      pagination: { page: q.page, limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
    };
  });

  app.post("/transactions", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const input = parseInput(createSchema, request.body);
    const property = await db().property.findUnique({ where: { reference: input.propertyReference } });
    if (!property) throw badRequest("Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό.", { propertyReference: ["Άγνωστος κωδικός ακινήτου."] });
    if (property.status === "ARCHIVED") throw badRequest("Το ακίνητο είναι αρχειοθετημένο.", { propertyReference: ["Το ακίνητο είναι αρχειοθετημένο."] });
    const lead = input.leadReference ? await db().lead.findUnique({ where: { reference: input.leadReference } }) : null;
    if (input.leadReference && !lead) throw badRequest("Δεν βρέθηκε lead με αυτόν τον κωδικό.", { leadReference: ["Άγνωστος κωδικός lead."] });

    const created = await db().$transaction(async (tx) => {
      const reference = await allocateReference(tx, "transaction", "TRX");
      const trx = await tx.transaction.create({
        data: {
          reference,
          type: property.listingType === "RENT" ? "RENT" : "SALE",
          propertyId: property.id,
          sellerContactId: property.ownerId,
          buyerContactId: lead?.contactId ?? null,
          leadId: lead?.id ?? null,
          buyerName: input.buyerName,
          buyerPhone: input.buyerPhone,
          buyerEmail: input.buyerEmail,
          agentId: property.agentId ?? actor.id,
          expectedCloseAt: input.expectedCloseAt,
          notes: input.notes,
          createdById: actor.id,
        },
      });
      await event(tx, trx.id, actor, "CREATED", `Νέα συναλλαγή για ${property.reference} με ${input.buyerName}`);
      return trx;
    });
    await writeAudit({ entity: "TRANSACTION", entityId: created.id, action: "create", actorId: actor.id, ...meta(request) });
    return { transaction: { id: created.id, reference: created.reference } };
  });

  app.get("/transactions/:id", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadOwned(actor, id);
    const t = await db().transaction.findUniqueOrThrow({ where: { id }, include: DETAIL_INCLUDE });
    const rules = await commissionRules();
    const preview =
      t.commission || t.agreedAmount == null
        ? null
        : calculateCommission({ type: t.type === "RENT" ? "RENT" : "SALE", amount: Number(t.agreedAmount), rules });
    return {
      transaction: serialize(t),
      commissionPreview: preview,
      canManageFinancials: roleAtLeast(actor.role, "MANAGER"),
    };
  });

  // --- Offers ------------------------------------------------------------------

  app.post("/transactions/:id/offers", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const input = parseInput(offerSchema, request.body);
    const trx = await loadOwned(actor, id);
    if (trx.status !== "NEGOTIATION") throw conflict("Νέες προσφορές καταχωρίζονται μόνο σε διαπραγμάτευση.");

    const result = await db().$transaction(async (tx) => {
      const rounds = await tx.offer.findMany({ where: { transactionId: id }, orderBy: { round: "desc" }, take: 1 });
      const last = rounds[0] ?? null;
      const now = new Date();
      if (last && last.status === "SUBMITTED") {
        if (last.party === input.party && !(last.expiresAt && last.expiresAt < now)) {
          throw conflict("Η τελευταία προσφορά είναι από την ίδια πλευρά και περιμένει απάντηση.");
        }
        // Answering an open round with new terms: it becomes a counter-offer.
        await tx.offer.update({
          where: { id: last.id },
          data: { status: last.expiresAt && last.expiresAt < now ? "EXPIRED" : "COUNTERED", respondedAt: now, respondedById: actor.id },
        });
      }
      const reference = await allocateReference(tx, "offer", "OFR");
      const offer = await tx.offer.create({
        data: {
          reference,
          propertyId: trx.propertyId,
          leadId: trx.leadId,
          contactId: input.party === "BUYER" ? trx.buyerContactId : trx.sellerContactId,
          amount: input.amount,
          conditions: input.conditions,
          financing: input.financing,
          deposit: input.deposit,
          expiresAt: input.expiresAt,
          notes: input.notes,
          agentId: trx.agentId,
          transactionId: id,
          parentOfferId: last?.id ?? null,
          party: input.party,
          round: (last?.round ?? 0) + 1,
          createdById: actor.id,
        },
      });
      const who = input.party === "BUYER" ? "Προσφορά αγοραστή" : "Αντιπρόταση ιδιοκτήτη";
      await event(tx, id, actor, last ? "COUNTER_OFFER" : "OFFER", `${who}: ${fmt(input.amount)} (γύρος ${offer.round})`, {
        offerId: offer.id,
        amount: input.amount,
        party: input.party,
      });
      await tx.transaction.update({ where: { id }, data: { updatedAt: now } });
      return offer;
    });
    await writeAudit({ entity: "OFFER", entityId: result.id, action: "create", changes: { amount: input.amount, party: input.party, round: result.round }, actorId: actor.id, ...meta(request) });
    return { offer: { id: result.id, reference: result.reference, round: result.round } };
  });

  app.post("/transactions/:id/offers/:offerId/respond", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id, offerId } = request.params as { id: string; offerId: string };
    const input = parseInput(respondSchema, request.body);
    const trx = await loadOwned(actor, id);
    if (trx.status !== "NEGOTIATION") throw conflict("Η διαπραγμάτευση έχει ολοκληρωθεί.");
    const offer = await db().offer.findFirst({ where: { id: offerId, transactionId: id } });
    if (!offer) throw notFound("Η προσφορά δεν βρέθηκε.");
    if (offer.status !== "SUBMITTED") throw conflict("Η προσφορά έχει ήδη απαντηθεί.");
    const now = new Date();
    if (offer.expiresAt && offer.expiresAt < now && input.action === "ACCEPT") throw conflict("Η προσφορά έχει λήξει.");
    const amount = Number(offer.amount);
    const status = input.action === "ACCEPT" ? "ACCEPTED" : input.action === "REJECT" ? "REJECTED" : "WITHDRAWN";

    await db().$transaction(async (tx) => {
      await tx.offer.update({ where: { id: offerId }, data: { status, respondedAt: now, respondedById: actor.id } });
      const label = `${OFFER_STATUS_LABELS[status]}: ${fmt(amount)} (γύρος ${offer.round})${input.note ? ` — ${input.note}` : ""}`;
      await event(tx, id, actor, `OFFER_${status}`, label, { offerId, amount });
      if (status === "ACCEPTED") {
        await tx.transaction.update({
          where: { id },
          data: { status: "AGREEMENT", agreedAmount: offer.amount, acceptedOfferId: offerId, agreementAt: now },
        });
        await event(tx, id, actor, "STATUS", `Συμφωνία στα ${fmt(amount)}`, { from: "NEGOTIATION", to: "AGREEMENT" });
      } else {
        await tx.transaction.update({ where: { id }, data: { updatedAt: now } });
      }
    });
    await writeAudit({ entity: "OFFER", entityId: offerId, action: status.toLowerCase(), changes: { status }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  // --- Status ----------------------------------------------------------------

  app.post("/transactions/:id/status", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const input = parseInput(statusSchema, request.body);
    const trx = await loadOwned(actor, id);
    if (!canMoveTransaction(trx.status, input.status)) {
      throw conflict(`Δεν επιτρέπεται η μετάβαση από «${TRANSACTION_STATUS_LABELS[trx.status as keyof typeof TRANSACTION_STATUS_LABELS]}» σε «${TRANSACTION_STATUS_LABELS[input.status]}».`);
    }
    if (input.status === "CANCELLED" && !input.reason) throw badRequest("Γράψτε τον λόγο ακύρωσης.", { reason: ["Υποχρεωτικό για ακύρωση."] });
    if (input.status === "AGREEMENT" && trx.agreedAmount == null) throw conflict("Η συμφωνία καταγράφεται με αποδοχή προσφοράς.");
    if (input.status === "NEGOTIATION" && !roleAtLeast(actor.role, "MANAGER")) throw forbidden("Μόνο υπεύθυνος επαναφέρει συναλλαγή σε διαπραγμάτευση.");

    const at = input.date ?? new Date();
    const data: Prisma.TransactionUpdateInput = { status: input.status };
    if (input.status === "CONTRACT") data.contractAt = at;
    if (input.status === "CLOSED") data.closedAt = at;
    if (input.status === "CANCELLED") Object.assign(data, { cancelledAt: at, cancelReason: input.reason });
    if (input.status === "NEGOTIATION") Object.assign(data, { agreedAmount: null, acceptedOfferId: null, agreementAt: null });

    await db().$transaction(async (tx) => {
      await tx.transaction.update({ where: { id }, data });
      const label = TRANSACTION_STATUS_LABELS[input.status];
      await event(tx, id, actor, "STATUS", `${label}${input.reason ? ` — ${input.reason}` : ""}`, { from: trx.status, to: input.status });
      if (input.status === "CANCELLED") {
        await tx.transactionCommission.updateMany({ where: { transactionId: id, status: "EXPECTED" }, data: { status: "CANCELLED" } });
      }
    });
    await writeAudit({ entity: "TRANSACTION", entityId: id, action: "status", changes: { from: trx.status, to: input.status }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  // --- Commission ------------------------------------------------------------

  app.post("/transactions/:id/commission", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const input = parseInput(calculateSchema, request.body);
    const trx = await loadOwned(actor, id);
    if (trx.agreedAmount == null) throw conflict("Η προμήθεια υπολογίζεται αφού συμφωνηθεί ποσό.");
    const manager = roleAtLeast(actor.role, "MANAGER");
    const existing = await db().transactionCommission.findUnique({ where: { transactionId: id } });
    if (existing && !manager) throw forbidden("Μόνο υπεύθυνος επανυπολογίζει προμήθεια.");
    if (existing && existing.status !== "EXPECTED") throw conflict("Η προμήθεια έχει τιμολογηθεί· δεν επανυπολογίζεται.");
    if (input.overrideRate !== null) {
      if (!manager) throw forbidden("Μόνο υπεύθυνος ορίζει ειδικό ποσοστό.");
      if (!input.overrideReason) throw badRequest("Γράψτε τον λόγο του ειδικού ποσοστού.", { overrideReason: ["Υποχρεωτικό."] });
    }

    const rules = await commissionRules();
    const type = trx.type === "RENT" ? "RENT" : "SALE";
    const result = calculateCommission({ type, amount: Number(trx.agreedAmount), rules, overrideRate: input.overrideRate });
    if (!result.ok) {
      throw conflict(`Ορίστε πρώτα στις Ρυθμίσεις → Προμήθειες: ${result.missing.join(", ")}.`);
    }
    const b = result.breakdown;
    const data = {
      basis: b.basis,
      rate: b.rate,
      baseAmount: Number(trx.agreedAmount),
      buyerSide: b.buyerSide,
      sellerSide: b.sellerSide,
      net: b.net,
      vat: b.vat,
      gross: b.gross,
      agentShare: b.agentShare,
      agencyShare: b.agencyShare,
      minimumApplied: b.minimumApplied,
      rulesSnapshot: rules as unknown as Prisma.InputJsonValue,
      overridden: input.overrideRate !== null,
      overrideReason: input.overrideRate !== null ? input.overrideReason : null,
      calculatedById: actor.id,
      calculatedAt: new Date(),
    };
    await db().$transaction(async (tx) => {
      await tx.transactionCommission.upsert({ where: { transactionId: id }, create: { transactionId: id, ...data }, update: data });
      await event(
        tx,
        id,
        actor,
        "COMMISSION",
        `Προμήθεια ${existing ? "επανυπολογίστηκε" : "υπολογίστηκε"}: ${fmt(b.gross)} με ΦΠΑ${data.overridden ? ` (ειδικό ποσοστό: ${input.overrideReason})` : ""}`,
        { gross: b.gross, net: b.net, rate: b.rate, overridden: data.overridden },
      );
    });
    await writeAudit({
      entity: "TRANSACTION",
      entityId: id,
      action: "commission_calculated",
      changes: { from: existing ? { gross: Number(existing.gross), rate: Number(existing.rate) } : null, to: { gross: b.gross, rate: b.rate }, overridden: data.overridden },
      actorId: actor.id,
      ...meta(request),
    });
    return { ok: true };
  });

  app.patch("/transactions/:id/commission", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    if (!roleAtLeast(actor.role, "MANAGER")) throw forbidden("Μόνο υπεύθυνος αλλάζει την κατάσταση πληρωμής.");
    const { id } = request.params as { id: string };
    const input = parseInput(commissionUpdateSchema, request.body);
    await loadOwned(actor, id);
    const c = await db().transactionCommission.findUnique({ where: { transactionId: id } });
    if (!c) throw notFound("Δεν έχει υπολογιστεί προμήθεια.");
    const paid = input.paidAmount ?? Number(c.paidAmount);
    if (paid > Number(c.gross) + 0.005) throw badRequest("Το εξοφλημένο ποσό ξεπερνά την προμήθεια.", { paidAmount: ["Μεγαλύτερο από το σύνολο."] });
    if (input.status === "PAID" && Math.abs(paid - Number(c.gross)) > 0.005) {
      throw badRequest("Για «Εξοφλήθηκε» το εξοφλημένο ποσό πρέπει να ισούται με το σύνολο.", { paidAmount: ["Ισούται με το σύνολο."] });
    }
    await db().$transaction(async (tx) => {
      await tx.transactionCommission.update({
        where: { transactionId: id },
        data: {
          status: input.status,
          invoiceNumber: input.invoiceNumber ?? c.invoiceNumber,
          dueDate: input.dueDate ?? c.dueDate,
          paidAmount: paid,
          paidAt: input.status === "PAID" ? new Date() : c.paidAt,
        },
      });
      await event(tx, id, actor, "COMMISSION_STATUS", `Προμήθεια: ${input.status === "PAID" ? "εξοφλήθηκε" : input.status === "INVOICED" ? "τιμολογήθηκε" : input.status === "PARTIALLY_PAID" ? `μερική εξόφληση ${fmt(paid)}` : input.status === "CANCELLED" ? "ακυρώθηκε" : "αναμένεται"}`, { status: input.status, paid });
    });
    await writeAudit({ entity: "TRANSACTION", entityId: id, action: "commission_status", changes: { from: c.status, to: input.status, paidAmount: paid }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  // --- Documents checklist and notes -------------------------------------------

  app.post("/transactions/:id/checklist", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const input = parseInput(checklistCreateSchema, request.body);
    const trx = await loadOwned(actor, id);
    assertOpen(trx);
    const count = await db().transactionChecklistItem.count({ where: { transactionId: id } });
    if (count >= 60) throw conflict("Έως 60 έγγραφα ανά συναλλαγή.");
    await db().$transaction(async (tx) => {
      await tx.transactionChecklistItem.create({ data: { transactionId: id, label: input.label, sortOrder: count, updatedById: actor.id } });
      await event(tx, id, actor, "DOCUMENT_REQUESTED", `Έγγραφο: ${input.label}`);
    });
    return { ok: true };
  });

  app.patch("/transactions/:id/checklist/:itemId", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id, itemId } = request.params as { id: string; itemId: string };
    const input = parseInput(checklistUpdateSchema, request.body);
    await loadOwned(actor, id);
    const item = await db().transactionChecklistItem.findFirst({ where: { id: itemId, transactionId: id } });
    if (!item) throw notFound("Το έγγραφο δεν βρέθηκε.");
    if (item.status === input.status && (input.note ?? null) === item.note) return { ok: true };
    await db().$transaction(async (tx) => {
      await tx.transactionChecklistItem.update({ where: { id: itemId }, data: { status: input.status, note: input.note, updatedById: actor.id } });
      if (item.status !== input.status) {
        const labels: Record<string, string> = { REQUESTED: "ζητήθηκε", RECEIVED: "παραλήφθηκε", VERIFIED: "ελέγχθηκε", REJECTED: "απορρίφθηκε", EXPIRED: "έληξε", NOT_REQUIRED: "δεν απαιτείται" };
        await event(tx, id, actor, "DOCUMENT_STATUS", `${item.label}: ${labels[input.status]}`, { from: item.status, to: input.status });
      }
    });
    return { ok: true };
  });

  app.post("/transactions/:id/notes", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const input = parseInput(noteSchema, request.body);
    await loadOwned(actor, id);
    await db().$transaction((tx) => event(tx, id, actor, "NOTE", input.text));
    return { ok: true };
  });
}
