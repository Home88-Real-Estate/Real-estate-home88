/**
 * Mandate document lifecycle beyond create/issue: validation, PDF access,
 * audit trail, replacement, extensions (prolongations) and the manager's
 * recorded override of an exclusive-mandate conflict.
 *
 * Every action checks its own permission on the server. Extensions are
 * documents of their own: own number, own PDF, own audit trail, and the same
 * send / signed-copy / cancel path as a showing.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";

import { recordDocumentAudit } from "../lib/brokerage/documents/audit";
import { issueDocument, loadIssuedPdf } from "../lib/brokerage/documents/issue";
import { recordPaperSignedCopy, sendDocumentForSignature } from "../lib/brokerage/documents/signing";
import { BrokerageError } from "../lib/brokerage/errors";
import { createMandateExtension, evaluateMandate, checkExclusiveConflict, recordConflictOverride, resolveMandateExtension } from "../lib/brokerage/mandates";
import { documentStore } from "../lib/document-store";
import { actorOf, auditContext, guarded, nameOf } from "../lib/doc-http";
import { requireDocPermission } from "../lib/doc-permissions";
import { conflict, notFound } from "../lib/errors";
import { parseInput } from "../lib/http";
import { db } from "../lib/prisma";
import { allocateReference } from "../lib/references";
import { requireRole, roleAtLeast } from "../plugins/auth";
import { confirmUpload, SIGNED_COPY_MIME_TYPES } from "./documents";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ημερομηνία ΕΕΕΕ-ΜΜ-ΗΗ.").transform((v) => new Date(`${v}T00:00:00Z`));
const reasonSchema = z.object({ reason: z.string().trim().min(1, "Συμπληρώστε τον λόγο.").max(1000) });
const extensionSchema = z.object({ newEndDate: dateOnly, reason: z.string().trim().max(1000).optional() });
const overrideSchema = z.object({ conflictingMandateId: z.string().min(1).max(40), reason: z.string().trim().min(3, "Συμπληρώστε την αιτιολογία.").max(1000) });
const issueSchema = z.object({ acknowledgeFeeAnomaly: z.string().trim().min(3).max(500).optional() }).default({});
const signedCopySchema = z.object({ token: z.string().min(10).max(600), signedAt: dateOnly.optional(), note: z.string().trim().max(300).optional() });

export async function mandateDocumentRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  async function loadMandate(actor: { id: string; role: string }, id: string) {
    const where: Prisma.MandateWhereInput = roleAtLeast(actor.role, "MANAGER") ? { id } : { id, OR: [{ agentId: actor.id }, { createdById: actor.id }] };
    const m = await db().mandate.findFirst({ where });
    if (!m) throw notFound("Η εντολή δεν βρέθηκε.");
    return m;
  }

  async function loadExtension(actor: { id: string; role: string }, id: string) {
    const x = await db().mandateExtension.findUnique({ where: { id } });
    if (!x) throw notFound("Η παράταση δεν βρέθηκε.");
    await loadMandate(actor, x.mandateId);
    return x;
  }

  app.post("/mandates/:id/validate", agent, async (request) => {
    await requireDocPermission(request, "mandates.download_pdf");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const m = await loadMandate(actor, id);
    const [result, forIssue] = await Promise.all([evaluateMandate(db(), id), evaluateMandate(db(), id, new Date(), { blockAnomalies: true })]);
    await recordDocumentAudit(db(), { ...auditContext(request), type: "MANDATE_VALIDATED", entityType: "MANDATE", entityId: id, documentNumber: m.number ?? m.reference, metadata: { status: result.status, blocking: result.blockingIssues.map((i) => i.code), warnings: result.warnings.map((i) => i.code) } });
    return { result, issuable: forIssue.status !== "BLOCKED", issuanceBlockingIssues: forIssue.blockingIssues };
  });

  app.get("/mandates/:id/pdf", agent, async (request) => {
    await requireDocPermission(request, "mandates.download_pdf");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const m = await loadMandate(actor, id);
    const pdf = await guarded(() => loadIssuedPdf(db(), "MANDATE", id));
    const url = await documentStore().signedGet(pdf.key, pdf.filename, 120);
    await recordDocumentAudit(db(), { ...auditContext(request), type: "MANDATE_PDF_DOWNLOADED", entityType: "MANDATE", entityId: id, documentNumber: m.number, metadata: { checksum: pdf.checksum, expiresInSeconds: 120 } });
    return { url, filename: pdf.filename, checksum: pdf.checksum, number: pdf.number, expiresInSeconds: 120 };
  });

  app.get("/mandates/:id/events", agent, async (request) => {
    await requireDocPermission(request, "mandates.download_pdf");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    await loadMandate(actor, id);
    const audit = await db().documentAuditEvent.findMany({ where: { entityType: "MANDATE", entityId: id }, orderBy: { occurredAt: "desc" }, take: 200 });
    return { audit: audit.map((a) => ({ id: a.id, type: a.type, actorUserId: a.actorUserId, actorRole: a.actorRole, occurredAt: a.occurredAt, documentNumber: a.documentNumber, reason: a.reason, before: a.before, after: a.after, metadata: a.metadata })) };
  });

  /** A correction is a replacement: a new draft linked to the original, which is cancelled when the new one is issued. */
  app.post("/mandates/:id/replace", agent, async (request) => {
    await requireDocPermission(request, "mandates.replace");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const original = await loadMandate(actor, id);
    const input = parseInput(reasonSchema, request.body);
    if (!original.number) throw conflict("Αντικαθίσταται μόνο εντολή που έχει εκδοθεί. Μια πρόχειρη επεξεργάζεται.");
    if (original.status === "CANCELLED") throw conflict("Η εντολή είναι ήδη ακυρωμένη.");
    if (await db().mandate.findFirst({ where: { supersedesMandateId: id }, select: { id: true } })) throw conflict("Υπάρχει ήδη αντικαταστάτρια εντολή.");
    const ctx = auditContext(request);

    const created = await guarded(() =>
      db().$transaction(async (tx) => {
        const m = await tx.mandate.findUniqueOrThrow({ where: { id }, include: { parties: { orderBy: { sortOrder: "asc" } }, milestones: { orderBy: { sequence: "asc" } } } });
        const reference = await allocateReference(tx, "mandate", "MND");
        const { id: _i, reference: _r, number: _n, status: _s, createdAt: _c, updatedAt: _u, ...rest } = m as Record<string, unknown> & typeof m;
        void _i; void _r; void _n; void _s; void _c; void _u;
        const c = await tx.mandate.create({
          data: {
            reference, type: m.type, locale: m.locale, propertyId: m.propertyId, sellerLeadId: m.sellerLeadId, startsAt: m.startsAt, endsAt: m.endsAt,
            terms: m.terms as Prisma.InputJsonValue, agentId: actor.id, createdById: actor.id, supersedesMandateId: id,
            ...(pickStructured(rest) as Partial<Prisma.MandateUncheckedCreateInput>),
            parties: { create: m.parties.map(({ role, contactId, fullName, taxIdEncrypted, idNumberEncrypted, addressEncrypted, emailEncrypted, phoneEncrypted, sortOrder }) => ({ role, contactId, fullName, taxIdEncrypted, idNumberEncrypted, addressEncrypted, emailEncrypted, phoneEncrypted, sortOrder })) },
          },
        });
        for (const ms of m.milestones) await tx.paymentMilestone.create({ data: { mandateId: c.id, sequence: ms.sequence, percentage: ms.percentage, fixedAmount: ms.fixedAmount, currency: ms.currency, trigger: ms.trigger, description: ms.description, dueDateRule: ms.dueDateRule } });
        await tx.mandateEvent.create({ data: { mandateId: c.id, type: "CREATED", summary: `Αντικαταστάτρια της ${original.number} (πρόχειρη): ${input.reason}`, data: { replaces: id }, actorId: actor.id, actorName: nameOf(actor) } });
        await recordDocumentAudit(tx, { ...ctx, type: "MANDATE_CREATED", entityType: "MANDATE", entityId: c.id, documentNumber: reference, reason: input.reason, after: { status: "DRAFT", replacesNumber: original.number } });
        return c;
      }),
    );
    return { mandate: { id: created.id, reference: created.reference, replaces: id } };
  });

  app.post("/mandates/:id/conflict-override", agent, async (request) => {
    await requireDocPermission(request, "mandates.override_conflict");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const m = await loadMandate(actor, id);
    const input = parseInput(overrideSchema, request.body);
    const ctx = auditContext(request);
    const detected = await checkExclusiveConflict(db(), id);
    await guarded(async () => {
      await recordDocumentAudit(db(), { ...ctx, type: "EXCLUSIVE_CONFLICT_DETECTED", entityType: "MANDATE", entityId: id, documentNumber: m.number ?? m.reference, metadata: { conflictingMandateId: input.conflictingMandateId, issues: detected.blockingIssues.map((i) => i.code) } });
      const o = await recordConflictOverride(db(), { mandateId: id, conflictingMandateId: input.conflictingMandateId, reason: input.reason, approver: { id: actor.id, role: actor.role } });
      await recordDocumentAudit(db(), { ...ctx, type: "EXCLUSIVE_CONFLICT_OVERRIDE_APPROVED", entityType: "MANDATE", entityId: id, documentNumber: m.number ?? m.reference, reason: input.reason, metadata: { overrideId: o.id, conflictingMandateId: input.conflictingMandateId } });
    });
    return { ok: true };
  });

  // --- Extensions -------------------------------------------------------------

  app.post("/mandates/:id/extensions", agent, async (request) => {
    await requireDocPermission(request, "mandates.extend");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const m = await loadMandate(actor, id);
    const input = parseInput(extensionSchema, request.body);
    const x = await guarded(() => createMandateExtension(db(), { mandateId: id, newEndDate: input.newEndDate, reason: input.reason ?? null, actor: { id: actor.id, name: nameOf(actor) } }));
    await recordDocumentAudit(db(), { ...auditContext(request), type: "MANDATE_EXTENDED", entityType: "MANDATE", entityId: id, documentNumber: m.number, reason: input.reason ?? null, after: { extensionId: x.id, newEndDate: input.newEndDate.toISOString().slice(0, 10), status: "DRAFT" } });
    return { extension: { id: x.id, status: x.status, previousEndDate: x.previousEndDate, newEndDate: x.newEndDate } };
  });

  app.post("/mandate-extensions/:id/issue", agent, async (request) => {
    await requireDocPermission(request, "mandates.extend");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    await loadExtension(actor, id);
    const input = parseInput(issueSchema, request.body ?? {});
    const outcome = await guarded(() => issueDocument(db(), "MANDATE_EXTENSION", id, { ...auditContext(request), acknowledgeFeeAnomaly: input.acknowledgeFeeAnomaly }));
    return { ok: true, ...outcome };
  });

  app.get("/mandate-extensions/:id/pdf", agent, async (request) => {
    await requireDocPermission(request, "mandates.download_pdf");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const x = await loadExtension(actor, id);
    const pdf = await guarded(() => loadIssuedPdf(db(), "MANDATE_EXTENSION", id));
    const url = await documentStore().signedGet(pdf.key, pdf.filename, 120);
    await recordDocumentAudit(db(), { ...auditContext(request), type: "EXTENSION_PDF_DOWNLOADED", entityType: "MANDATE_EXTENSION", entityId: id, documentNumber: x.number, metadata: { checksum: pdf.checksum, expiresInSeconds: 120 } });
    return { url, filename: pdf.filename, checksum: pdf.checksum, number: pdf.number, expiresInSeconds: 120 };
  });

  app.post("/mandate-extensions/:id/send", agent, async (request) => {
    await requireDocPermission(request, "mandates.send");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    await loadExtension(actor, id);
    const r = await guarded(() => sendDocumentForSignature(db(), "MANDATE_EXTENSION", id, auditContext(request)));
    return { ok: true, signingUrls: r.signingUrls, documentChecksum: r.documentChecksum, level: r.level };
  });

  app.post("/mandate-extensions/:id/signed-copy", agent, async (request) => {
    await requireDocPermission(request, "mandates.send");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const x = await loadExtension(actor, id);
    const input = parseInput(signedCopySchema, request.body);
    const m = await db().mandate.findUniqueOrThrow({ where: { id: x.mandateId }, select: { propertyId: true } });
    const doc = await confirmUpload(actor, input.token, { title: `Παράταση ${x.number} (υπογεγραμμένη)`, category: "MANDATE", propertyId: m.propertyId, contactId: null, containsPersonalData: true }, undefined, { allowedMimeTypes: SIGNED_COPY_MIME_TYPES });
    try {
      const r = await guarded(() => recordPaperSignedCopy(db(), "MANDATE_EXTENSION", id, { storageKey: doc.storageKey, checksum: doc.checksum!, byteSize: doc.byteSize }, { signedAt: input.signedAt ?? new Date(), signerNote: input.note }, auditContext(request)));
      return { ok: true, ...r };
    } catch (error) {
      await db().document.delete({ where: { id: doc.id } }).catch(() => undefined);
      throw error;
    }
  });

  app.post("/mandate-extensions/:id/cancel", agent, async (request) => {
    await requireDocPermission(request, "mandates.cancel");
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const x = await loadExtension(actor, id);
    const input = parseInput(reasonSchema, request.body);
    await guarded(async () => {
      await resolveMandateExtension(db(), id, "CANCELLED", { actor: { id: actor.id, name: nameOf(actor) } });
      await recordDocumentAudit(db(), { ...auditContext(request), type: "EXTENSION_CANCELLED", entityType: "MANDATE_EXTENSION", entityId: id, documentNumber: x.number, reason: input.reason, before: { status: x.status }, after: { status: "CANCELLED" } });
    });
    return { ok: true };
  });
}

const STRUCTURED_KEYS = [
  "feePayer", "feeMethod", "feeBasis", "feePercentage", "feeFixedAmount", "feeCurrency", "vatTreatment", "vatRate", "paymentTrigger",
  "durationType", "knownDefects", "defectsDisclosureConfirmed", "defectsDescription", "photoPermission", "videoPermission", "floorplanPermission",
  "signboardPermission", "portalPublicationPermission", "socialMediaPermission", "cooperatingBrokerPermission", "brokerCooperationAllowed",
  "dualRepresentationConsent", "marketingChannels", "specialTerms",
] as const;

function pickStructured(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of STRUCTURED_KEYS) if (k in row && row[k] !== undefined) out[k] = row[k];
  return out;
}

export { BrokerageError };
