/**
 * Showings (Υποδείξεις Ακινήτου): the legal document for introducing one or
 * more properties to a client.
 *
 *  - A showing is drafted, validated with the shared validators, issued
 *    through the document pipeline (template, snapshot, PDF, private storage,
 *    audit), then sent for signature or signed on paper.
 *  - Every action checks its own permission on the server. Agents prepare
 *    drafts; managers issue, send, cancel and replace; full identity data is
 *    shown only to those who hold showings.view_sensitive_data.
 *  - Issued showings are immutable. A correction is a replacement: a new
 *    draft, a new number, linked to the original, which is cancelled when the
 *    replacement is issued.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import { FEE_BASES, FEE_METHODS, FEE_PAYERS, PAYMENT_TRIGGERS, SHOWING_STATUSES, VAT_TREATMENTS, validateCommission, type FeeTerms } from "@home88/domain";

import { loadIssuedPdf, issueDocument } from "../lib/brokerage/documents/issue";
import { recordDocumentAudit } from "../lib/brokerage/documents/audit";
import { buildShowingParties, clearParty, maskedParty, showingPartySchema } from "../lib/brokerage/documents/party-input";
import { recordPaperSignedCopy, sendDocumentForSignature } from "../lib/brokerage/documents/signing";
import { addPropertyToShowing, evaluateShowing, refreshShowingCompleteness } from "../lib/brokerage/showings";
import { documentStore } from "../lib/document-store";
import { requireDocPermission, mayViewSensitive } from "../lib/doc-permissions";
import { actorOf, auditContext, guarded, nameOf } from "../lib/doc-http";
import { badRequest, conflict, notFound, validationFailed } from "../lib/errors";
import { parseInput } from "../lib/http";
import { db } from "../lib/prisma";
import { requireRole, roleAtLeast } from "../plugins/auth";
import { confirmUpload, SIGNED_COPY_MIME_TYPES } from "./documents";

const text = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : null));
const num = z.union([z.number(), z.string().trim().min(1)]).transform((v) => Number(v)).refine((v) => Number.isFinite(v), "Μη έγκυρος αριθμός.");
const dateOnly = z.union([z.literal(""), z.null(), z.undefined(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ημερομηνία ΕΕΕΕ-ΜΜ-ΗΗ.")]).transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null));

const milestoneSchema = z.object({
  sequence: z.number().int().min(1).max(20),
  percentage: num.nullable().optional(),
  fixedAmount: num.nullable().optional(),
  trigger: z.enum(PAYMENT_TRIGGERS),
  description: text(200),
  dueDateRule: text(200),
});

const feeShape = {
  feePayer: z.enum(FEE_PAYERS).nullable().optional(),
  feeMethod: z.enum(FEE_METHODS).nullable().optional(),
  feeBasis: z.enum(FEE_BASES).nullable().optional(),
  feePercentage: num.nullable().optional(),
  feeFixedAmount: num.nullable().optional(),
  feeCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable().optional(),
  vatTreatment: z.enum(VAT_TREATMENTS).nullable().optional(),
  vatRate: num.nullable().optional(),
  paymentTrigger: z.enum(PAYMENT_TRIGGERS).nullable().optional(),
};

const draftShape = {
  language: z.enum(["el", "en"]).default("el"),
  contactReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
  leadId: z.string().max(40).optional().or(z.literal("")),
  sourceViewingId: z.string().max(40).optional().or(z.literal("")),
  propertyReferences: z.array(z.string().trim().toUpperCase().max(20)).max(20).default([]),
  parties: z.array(showingPartySchema).max(8).default([]),
  ...feeShape,
  milestones: z.array(milestoneSchema).max(12).optional(),
  dualRepresentationConsent: z.boolean().nullable().optional(),
  comments: text(4000),
  documentDate: dateOnly,
};

const createSchema = z.object(draftShape);
const updateSchema = z.object(draftShape).partial();
const listSchema = z.object({
  status: z.enum(SHOWING_STATUSES).optional(),
  scope: z.enum(["mine", "all"]).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
const issueSchema = z.object({ acknowledgeFeeAnomaly: z.string().trim().min(3).max(500).optional() }).default({});
const cancelSchema = z.object({ reason: z.string().trim().min(1, "Συμπληρώστε τον λόγο.").max(1000) });
const signedCopySchema = z.object({ token: z.string().min(10).max(600), signedAt: dateOnly, note: text(300) });

function feeTermsOf(input: Partial<z.infer<typeof createSchema>>): FeeTerms {
  return {
    payer: input.feePayer ?? null, method: input.feeMethod ?? null, basis: input.feeBasis ?? null,
    percentage: input.feePercentage ?? null, fixedAmount: input.feeFixedAmount ?? null, currency: input.feeCurrency ?? null,
    vatTreatment: input.vatTreatment ?? null, vatRate: input.vatRate ?? null, paymentTrigger: input.paymentTrigger ?? null,
    milestones: (input.milestones ?? []).map((m) => ({ sequence: m.sequence, percentage: m.percentage ?? null, fixedAmount: m.fixedAmount ?? null, trigger: m.trigger })),
  };
}

/** Impossible values (a fee of 120 %, a negative amount) are refused even for a draft. */
function assertSaveable(input: Partial<z.infer<typeof createSchema>>) {
  const r = validateCommission(feeTermsOf(input), {}, { requireComplete: false });
  if (!r.draftSaveable) {
    const fields: Record<string, string[]> = {};
    for (const i of r.blockingIssues.filter((x) => x.integrity)) (fields[i.field ?? "fee"] ??= []).push(i.message);
    throw validationFailed("Ελέγξτε τα πεδία της αμοιβής.", fields);
  }
}

const decimal = (v: number | null | undefined) => (v == null ? null : v);

function visibleTo(actor: { id: string; role: string }): Prisma.ShowingWhereInput {
  if (roleAtLeast(actor.role, "MANAGER")) return {};
  return { OR: [{ responsibleUserId: actor.id }, { createdById: actor.id }] };
}

async function loadVisible(actor: { id: string; role: string }, id: string) {
  const s = await db().showing.findFirst({ where: { AND: [{ id }, visibleTo(actor)] } });
  if (!s) throw notFound("Η υπόδειξη δεν βρέθηκε.");
  return s;
}

const FULL = {
  properties: { orderBy: { sortOrder: "asc" as const } },
  parties: { orderBy: { sortOrder: "asc" as const } },
  milestones: { orderBy: { sequence: "asc" as const } },
  templateVersion: { select: { id: true, version: true, checksum: true } },
  contact: { select: { id: true, reference: true, firstName: true, lastName: true } },
  responsibleUser: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ShowingInclude;

export async function showingRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  async function resolveProperties(refs: string[]) {
    const ids: string[] = [];
    for (const ref of refs) {
      const p = await db().property.findUnique({ where: { reference: ref }, select: { id: true } });
      if (!p) throw badRequest(`Δεν βρέθηκε ακίνητο ${ref}.`, { propertyReferences: [`Άγνωστος κωδικός ${ref}.`] });
      if (!ids.includes(p.id)) ids.push(p.id);
    }
    return ids;
  }

  async function writeMilestones(tx: Prisma.TransactionClient, showingId: string, list: z.infer<typeof milestoneSchema>[]) {
    await tx.paymentMilestone.deleteMany({ where: { showingId } });
    for (const m of list) {
      await tx.paymentMilestone.create({ data: { showingId, sequence: m.sequence, percentage: decimal(m.percentage), fixedAmount: decimal(m.fixedAmount), trigger: m.trigger, description: m.description, dueDateRule: m.dueDateRule } });
    }
  }

  app.post("/showings", agent, async (request) => {
    await requireDocPermission(request, "showings.create");
    const actor = actorOf(request);
    const input = parseInput(createSchema, request.body);
    assertSaveable(input);
    const ctx = auditContext(request);

    const contact = input.contactReference ? await db().contact.findUnique({ where: { reference: input.contactReference }, select: { id: true } }) : null;
    if (input.contactReference && !contact) throw badRequest("Δεν βρέθηκε η επαφή.", { contactReference: ["Άγνωστη επαφή."] });
    const propertyIds = await resolveProperties(input.propertyReferences);
    const parties = await buildShowingParties(input.parties, actor.id);

    const created = await guarded(() =>
      db().$transaction(async (tx) => {
        const s = await tx.showing.create({
          data: {
            language: input.language, contactId: contact?.id ?? null, leadId: input.leadId || null, sourceViewingId: input.sourceViewingId || null,
            responsibleUserId: actor.id, createdById: actor.id, documentDate: input.documentDate,
            feePayer: input.feePayer ?? null, feeMethod: input.feeMethod ?? null, feeBasis: input.feeBasis ?? null, feePercentage: decimal(input.feePercentage), feeFixedAmount: decimal(input.feeFixedAmount),
            feeCurrency: input.feeCurrency ?? null, vatTreatment: input.vatTreatment ?? null, vatRate: decimal(input.vatRate), paymentTrigger: input.paymentTrigger ?? null,
            dualRepresentationConsent: input.dualRepresentationConsent ?? null, comments: input.comments,
          },
        });
        for (const p of parties) await tx.showingParty.create({ data: { ...p, showingId: s.id } });
        for (const pid of propertyIds) await addPropertyToShowing(tx, s.id, pid);
        if (input.milestones) await writeMilestones(tx, s.id, input.milestones);
        await tx.showingEvent.create({ data: { showingId: s.id, type: "CREATED", summary: "Νέα υπόδειξη (πρόχειρη)", actorId: actor.id, actorName: nameOf(actor) } });
        await recordDocumentAudit(tx, { ...ctx, type: "SHOWING_CREATED", entityType: "SHOWING", entityId: s.id, after: { status: "DRAFT", properties: propertyIds.length, parties: parties.length } });
        return s;
      }),
    );
    const result = await refreshShowingCompleteness(db(), created.id);
    return { showing: { id: created.id, status: created.status }, completeness: result };
  });

  app.get("/showings", agent, async (request) => {
    await requireDocPermission(request, "showings.read");
    const actor = actorOf(request);
    const q = parseInput(listSchema, request.query);
    const mine = q.scope === "mine" || !roleAtLeast(actor.role, "MANAGER");
    const where: Prisma.ShowingWhereInput = {
      AND: [
        mine ? { OR: [{ responsibleUserId: actor.id }, { createdById: actor.id }] } : {},
        q.status ? { status: q.status } : {},
        q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" } }, { properties: { some: { propertyCodeSnapshot: { contains: q.q.toUpperCase() } } } }, { parties: { some: { fullName: { contains: q.q, mode: "insensitive" } } } }] } : {},
      ],
    };
    const take = 25;
    const [rows, total] = await Promise.all([
      db().showing.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * take, take, include: { properties: { select: { propertyCodeSnapshot: true }, orderBy: { sortOrder: "asc" } }, parties: { select: { fullName: true }, orderBy: { sortOrder: "asc" } } } }),
      db().showing.count({ where }),
    ]);
    return {
      data: rows.map((s) => ({ id: s.id, number: s.number, status: s.status, language: s.language, clients: s.parties.map((p) => p.fullName), properties: s.properties.map((p) => p.propertyCodeSnapshot), issuedAt: s.issuedAt, signedAt: s.signedAt, storageState: s.storageState, createdAt: s.createdAt })),
      pagination: { page: q.page, limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
    };
  });

  app.get("/showings/:id", agent, async (request) => {
    await requireDocPermission(request, "showings.read");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    await loadVisible(actor, id);
    const s = await db().showing.findUniqueOrThrow({ where: { id }, include: FULL });
    const sensitive = await mayViewSensitive(actor.role, "showings");
    return {
      showing: {
        id: s.id, number: s.number, status: s.status, language: s.language, documentDate: s.documentDate,
        contact: s.contact, responsibleUser: s.responsibleUser,
        fee: { payer: s.feePayer, method: s.feeMethod, basis: s.feeBasis, percentage: s.feePercentage, fixedAmount: s.feeFixedAmount, currency: s.feeCurrency, vatTreatment: s.vatTreatment, vatRate: s.vatRate, paymentTrigger: s.paymentTrigger, anomalyAcknowledged: Boolean(s.feeAnomalyOverrideReason) },
        milestones: s.milestones.map((m) => ({ sequence: m.sequence, percentage: m.percentage, fixedAmount: m.fixedAmount, trigger: m.trigger, description: m.description })),
        dualRepresentationConsent: s.dualRepresentationConsent, comments: s.comments,
        properties: s.properties.map((p) => ({ id: p.id, propertyId: p.propertyId, code: p.propertyCodeSnapshot, address: p.addressSnapshot, description: p.descriptionSnapshot, transactionType: p.transactionTypeSnapshot, price: p.priceSnapshot, commission: p.commissionSnapshot })),
        parties: s.parties.map((p) => (sensitive ? clearParty(p) : maskedParty(p))),
        template: s.templateVersion ? { version: s.templateVersion.version, checksum: s.templateChecksum } : null,
        renderedTextChecksum: s.renderedTextChecksum, pdfChecksum: s.pdfChecksum, storageState: s.storageState, verificationCode: s.verificationCode,
        signature: { method: s.signatureMethod, provider: s.signatureProvider, level: s.signatureLevel, signedAt: s.signedAt, signedPdfChecksum: s.signedPdfChecksum, sentAt: s.sentAt, viewedAt: s.viewedAt },
        replacesShowingId: s.replacesShowingId, completeness: s.completenessResult, issuedAt: s.issuedAt, cancelledAt: s.cancelledAt, cancelReason: s.cancelReason, createdAt: s.createdAt,
      },
    };
  });

  app.patch("/showings/:id", agent, async (request) => {
    await requireDocPermission(request, "showings.update_draft");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const s = await loadVisible(actor, id);
    if (s.status !== "DRAFT" && s.status !== "READY_FOR_ISSUANCE") throw conflict("Μόνο πρόχειρη υπόδειξη αλλάζει. Για διόρθωση χρησιμοποιήστε την αντικατάσταση.");
    const input = parseInput(updateSchema, request.body);
    assertSaveable({ ...input });
    const ctx = auditContext(request);
    const propertyIds = input.propertyReferences ? await resolveProperties(input.propertyReferences) : null;
    const parties = input.parties ? await buildShowingParties(input.parties, actor.id) : null;
    const contact = input.contactReference ? await db().contact.findUnique({ where: { reference: input.contactReference }, select: { id: true } }) : null;
    if (input.contactReference && !contact) throw badRequest("Δεν βρέθηκε η επαφή.", { contactReference: ["Άγνωστη επαφή."] });

    await guarded(() =>
      db().$transaction(async (tx) => {
        // Edited data must be validated again: a ready showing goes back to draft.
        await tx.showing.update({
          where: { id },
          data: {
            status: "DRAFT",
            ...(input.language !== undefined ? { language: input.language } : {}),
            ...(input.contactReference !== undefined ? { contactId: contact?.id ?? null } : {}),
            ...(input.documentDate !== undefined ? { documentDate: input.documentDate } : {}),
            ...(input.feePayer !== undefined ? { feePayer: input.feePayer } : {}),
            ...(input.feeMethod !== undefined ? { feeMethod: input.feeMethod } : {}),
            ...(input.feeBasis !== undefined ? { feeBasis: input.feeBasis } : {}),
            ...(input.feePercentage !== undefined ? { feePercentage: decimal(input.feePercentage) } : {}),
            ...(input.feeFixedAmount !== undefined ? { feeFixedAmount: decimal(input.feeFixedAmount) } : {}),
            ...(input.feeCurrency !== undefined ? { feeCurrency: input.feeCurrency } : {}),
            ...(input.vatTreatment !== undefined ? { vatTreatment: input.vatTreatment } : {}),
            ...(input.vatRate !== undefined ? { vatRate: decimal(input.vatRate) } : {}),
            ...(input.paymentTrigger !== undefined ? { paymentTrigger: input.paymentTrigger } : {}),
            ...(input.dualRepresentationConsent !== undefined ? { dualRepresentationConsent: input.dualRepresentationConsent } : {}),
            ...(input.comments !== undefined ? { comments: input.comments } : {}),
            // A changed fee invalidates an earlier acknowledgement of its anomaly.
            ...(["feeMethod", "feePercentage", "feeFixedAmount", "feeBasis"].some((k) => k in input) ? { feeAnomalyOverrideReason: null, feeAnomalyOverriddenById: null } : {}),
          },
        });
        if (parties) {
          await tx.showingParty.deleteMany({ where: { showingId: id } });
          for (const p of parties) await tx.showingParty.create({ data: { ...p, showingId: id } });
        }
        if (propertyIds) {
          await tx.showingProperty.deleteMany({ where: { showingId: id } });
          for (const pid of propertyIds) await addPropertyToShowing(tx, id, pid);
        }
        if (input.milestones) await writeMilestones(tx, id, input.milestones);
        await tx.showingEvent.create({ data: { showingId: id, type: "UPDATED", summary: "Ενημέρωση πρόχειρης υπόδειξης", data: { fields: Object.keys(input) }, actorId: actor.id, actorName: nameOf(actor) } });
        await recordDocumentAudit(tx, { ...ctx, type: "SHOWING_UPDATED", entityType: "SHOWING", entityId: id, before: { status: s.status }, after: { status: "DRAFT" }, metadata: { fields: Object.keys(input) } });
      }),
    );
    return { ok: true, completeness: await refreshShowingCompleteness(db(), id) };
  });

  app.post("/showings/:id/validate", agent, async (request) => {
    await requireDocPermission(request, "showings.read");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const s = await loadVisible(actor, id);
    const [result, forIssue] = await Promise.all([evaluateShowing(db(), id), evaluateShowing(db(), id, { blockAnomalies: true })]);
    if (s.status === "DRAFT" || s.status === "READY_FOR_ISSUANCE") await refreshShowingCompleteness(db(), id);
    await recordDocumentAudit(db(), { ...auditContext(request), type: "SHOWING_VALIDATED", entityType: "SHOWING", entityId: id, documentNumber: s.number, metadata: { status: result.status, blocking: result.blockingIssues.map((i) => i.code), warnings: result.warnings.map((i) => i.code) } });
    return { result, issuable: forIssue.status !== "BLOCKED", issuanceBlockingIssues: forIssue.blockingIssues };
  });

  app.post("/showings/:id/issue", agent, async (request) => {
    await requireDocPermission(request, "showings.issue");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    await loadVisible(actor, id);
    const input = parseInput(issueSchema, request.body ?? {});
    const ctx = auditContext(request);
    const outcome = await guarded(() => issueDocument(db(), "SHOWING", id, { ...ctx, acknowledgeFeeAnomaly: input.acknowledgeFeeAnomaly }));
    return { ok: true, ...outcome };
  });

  app.get("/showings/:id/pdf", agent, async (request) => {
    await requireDocPermission(request, "showings.download_pdf");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const s = await loadVisible(actor, id);
    const pdf = await guarded(() => loadIssuedPdf(db(), "SHOWING", id));
    // Never a raw bucket URL: a short-lived signed link, minted after the permission check and audited.
    const url = await documentStore().signedGet(pdf.key, pdf.filename, 120);
    await recordDocumentAudit(db(), { ...auditContext(request), type: "SHOWING_PDF_DOWNLOADED", entityType: "SHOWING", entityId: id, documentNumber: s.number, metadata: { checksum: pdf.checksum, expiresInSeconds: 120 } });
    return { url, filename: pdf.filename, checksum: pdf.checksum, number: pdf.number, expiresInSeconds: 120 };
  });

  app.get("/showings/:id/events", agent, async (request) => {
    await requireDocPermission(request, "showings.read");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    await loadVisible(actor, id);
    const [events, audit] = await Promise.all([
      db().showingEvent.findMany({ where: { showingId: id }, orderBy: { createdAt: "desc" }, take: 200 }),
      db().documentAuditEvent.findMany({ where: { entityType: "SHOWING", entityId: id }, orderBy: { occurredAt: "desc" }, take: 200 }),
    ]);
    return {
      events: events.map((e) => ({ id: e.id, type: e.type, summary: e.summary, actorName: e.actorName, createdAt: e.createdAt })),
      audit: audit.map((a) => ({ id: a.id, type: a.type, actorUserId: a.actorUserId, actorRole: a.actorRole, occurredAt: a.occurredAt, documentNumber: a.documentNumber, reason: a.reason, before: a.before, after: a.after, metadata: a.metadata })),
    };
  });

  app.post("/showings/:id/send", agent, async (request) => {
    await requireDocPermission(request, "showings.send");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    await loadVisible(actor, id);
    const r = await guarded(() => sendDocumentForSignature(db(), "SHOWING", id, auditContext(request)));
    return { ok: true, signingUrls: r.signingUrls, documentChecksum: r.documentChecksum, level: r.level };
  });

  app.post("/showings/:id/signed-copy", agent, async (request) => {
    await requireDocPermission(request, "showings.send");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const s = await loadVisible(actor, id);
    const input = parseInput(signedCopySchema, request.body);
    const first = await db().showingProperty.findFirst({ where: { showingId: id }, orderBy: { sortOrder: "asc" } });
    const doc = await confirmUpload(actor, input.token, { title: `Υπόδειξη ${s.number} (υπογεγραμμένη)`, category: "MANDATE", propertyId: first?.propertyId ?? null, contactId: s.contactId, containsPersonalData: true }, undefined, { allowedMimeTypes: SIGNED_COPY_MIME_TYPES });
    try {
      const r = await guarded(() => recordPaperSignedCopy(db(), "SHOWING", id, { storageKey: doc.storageKey, checksum: doc.checksum!, byteSize: doc.byteSize }, { signedAt: input.signedAt ?? new Date(), signerNote: input.note }, auditContext(request)));
      return { ok: true, ...r };
    } catch (error) {
      await db().document.delete({ where: { id: doc.id } }).catch(() => undefined);
      throw error;
    }
  });

  app.post("/showings/:id/cancel", agent, async (request) => {
    await requireDocPermission(request, "showings.cancel");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const s = await loadVisible(actor, id);
    const input = parseInput(cancelSchema, request.body);
    const ctx = auditContext(request);
    await guarded(() =>
      db().$transaction(async (tx) => {
        await tx.showing.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason } }).catch((e) => {
          throw conflict(/cannot move|cannot be changed/.test(String(e?.message)) ? "Η υπόδειξη δεν μπορεί να ακυρωθεί σε αυτή την κατάσταση." : "Η ακύρωση απέτυχε.");
        });
        await tx.showingEvent.create({ data: { showingId: id, type: "CANCELLED", summary: `Ακυρώθηκε: ${input.reason}`, actorId: actor.id, actorName: nameOf(actor) } });
        await recordDocumentAudit(tx, { ...ctx, type: "SHOWING_CANCELLED", entityType: "SHOWING", entityId: id, documentNumber: s.number, reason: input.reason, before: { status: s.status }, after: { status: "CANCELLED" } });
      }),
    );
    return { ok: true };
  });

  app.post("/showings/:id/replace", agent, async (request) => {
    await requireDocPermission(request, "showings.replace");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const original = await loadVisible(actor, id);
    const input = parseInput(cancelSchema, request.body);
    if (!original.number) throw conflict("Αντικαθίσταται μόνο υπόδειξη που έχει εκδοθεί. Μια πρόχειρη επεξεργάζεται.");
    if (original.status === "CANCELLED") throw conflict("Η υπόδειξη είναι ήδη ακυρωμένη.");
    if (await db().showing.findFirst({ where: { replacesShowingId: id }, select: { id: true } })) throw conflict("Υπάρχει ήδη αντικαταστάτρια υπόδειξη.");
    const ctx = auditContext(request);

    const created = await guarded(() =>
      db().$transaction(async (tx) => {
        const src = await tx.showing.findUniqueOrThrow({ where: { id }, include: { parties: true, properties: { orderBy: { sortOrder: "asc" } }, milestones: true } });
        const s = await tx.showing.create({
          data: {
            language: src.language, contactId: src.contactId, leadId: src.leadId, responsibleUserId: actor.id, createdById: actor.id, replacesShowingId: id,
            feePayer: src.feePayer, feeMethod: src.feeMethod, feeBasis: src.feeBasis, feePercentage: src.feePercentage, feeFixedAmount: src.feeFixedAmount, feeCurrency: src.feeCurrency,
            vatTreatment: src.vatTreatment, vatRate: src.vatRate, paymentTrigger: src.paymentTrigger, dualRepresentationConsent: src.dualRepresentationConsent, comments: src.comments,
          },
        });
        for (const p of src.parties) {
          await tx.showingParty.create({ data: { showingId: s.id, role: p.role, contactId: p.contactId, fullName: p.fullName, taxIdEncrypted: p.taxIdEncrypted, taxOfficeEncrypted: p.taxOfficeEncrypted, idNumberEncrypted: p.idNumberEncrypted, addressEncrypted: p.addressEncrypted, emailEncrypted: p.emailEncrypted, phoneEncrypted: p.phoneEncrypted, identityVerifiedAt: p.identityVerifiedAt, identityVerifiedById: p.identityVerifiedById, representativeCapacity: p.representativeCapacity, authorityReference: p.authorityReference, isSignatory: p.isSignatory, sortOrder: p.sortOrder } });
        }
        for (const sp of src.properties) {
          if (sp.propertyId && (await tx.property.findUnique({ where: { id: sp.propertyId }, select: { id: true } }))) await addPropertyToShowing(tx, s.id, sp.propertyId);
        }
        for (const m of src.milestones) await tx.paymentMilestone.create({ data: { showingId: s.id, sequence: m.sequence, percentage: m.percentage, fixedAmount: m.fixedAmount, currency: m.currency, trigger: m.trigger, description: m.description, dueDateRule: m.dueDateRule } });
        await tx.showingEvent.create({ data: { showingId: s.id, type: "CREATED", summary: `Αντικαταστάτρια της ${original.number} (πρόχειρη): ${input.reason}`, data: { replaces: id }, actorId: actor.id, actorName: nameOf(actor) } });
        await recordDocumentAudit(tx, { ...ctx, type: "SHOWING_CREATED", entityType: "SHOWING", entityId: s.id, reason: input.reason, after: { status: "DRAFT", replacesNumber: original.number } });
        return s;
      }),
    );
    return { showing: { id: created.id, status: created.status, replaces: id }, completeness: await refreshShowingCompleteness(db(), created.id) };
  });
}

