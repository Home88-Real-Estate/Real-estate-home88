/**
 * Issuing a showing, a mandate or an extension: the one place a document
 * becomes official.
 *
 * Inside ONE database transaction:
 *   lock the row → (re)validate → check the fee anomaly → check exclusive
 *   conflicts → resolve the approved template and verify its checksum → take the
 *   number → snapshot parties, properties, fee, terms and company → fill the
 *   approved wording → render the text and checksum it → render the PDF and
 *   checksum it → stage the PDF in private storage → write the issued state and
 *   the audit events.
 * If any step fails the transaction rolls back: the document stays a draft, the
 * number is not used, and the staged object is removed. After the commit the
 * PDF is moved to its final immutable key and verified; if that move fails the
 * document stays issued with storageState PENDING and cannot be sent or signed
 * until `recoverPendingStorage` (or a retry) has verified it.
 *
 * Issuing twice returns the document that was already issued: the row lock
 * serialises concurrent requests and the second one sees the first one's number.
 */

import { randomBytes, randomUUID } from "node:crypto";

import {
  blocksToText,
  buildDocumentBlocks,
  mergeValues,
  renderClauses,
  scanFinalText,
  validateMandate,
  validateShowing,
  validateTemplateCheck,
  validateCompanyFacts,
  validateParties,
  mergeCompleteness,
  type DocumentCompletenessResult,
  type DocumentKind,
  type DocumentSnapshot,
  type ValidationIssue,
} from "@home88/domain";
import type { Prisma } from "@home88/database";

import { documentStore, sha256, type DocumentStore } from "../../document-store";
import { decryptField, encryptField, hasEncryptionKey } from "../../pii";
import { settings } from "../../../settings";
import { loadCompanyFacts, loadTemplateCheck } from "../company";
import { BrokerageError, DocumentBlockedError } from "../errors";
import { buildMandateValidationInput, currentEndDate } from "../mandates";
import { allocateShowingNumber, buildShowingValidationInput, snapshotProperty } from "../showings";
import type { Actor } from "../types";
import { recordDocumentAudit, type AuditContext } from "./audit";
import { renderDocumentPdf } from "./pdf";
import { buildExtensionSnapshot, buildMandateSnapshot, buildShowingSnapshot, type IssuanceSnapshot, type Numbering } from "./snapshots";
import { resolveApprovedTemplate, TemplateRejectedError } from "./templates";

export type IssueKind = "SHOWING" | "MANDATE" | "MANDATE_EXTENSION";
export type IssueActor = Actor & { role: string };
export type IssueContext = AuditContext & {
  actor: IssueActor;
  now?: Date;
  /** A manager's recorded acceptance of a COMMISSION_ANOMALY, with the reason. */
  acknowledgeFeeAnomaly?: string | null;
  store?: DocumentStore;
};

export type IssueOutcome = {
  kind: IssueKind;
  id: string;
  number: string;
  alreadyIssued: boolean;
  verificationCode: string | null;
  templateVersion: number | null;
  renderedTextChecksum: string | null;
  pdfChecksum: string | null;
  storageKey: string | null;
  storageState: "PENDING" | "CONFIRMED" | "NOT_STORED";
  warnings: ValidationIssue[];
  pageCount: number | null;
};

export type Transactional = { $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }) => Promise<T> };
type Tx = Prisma.TransactionClient;

const ENTITY: Record<IssueKind, "SHOWING" | "MANDATE" | "MANDATE_EXTENSION"> = { SHOWING: "SHOWING", MANDATE: "MANDATE", MANDATE_EXTENSION: "MANDATE_EXTENSION" };
const PREFIX: Record<IssueKind, "SHOWING" | "MANDATE" | "EXTENSION"> = { SHOWING: "SHOWING", MANDATE: "MANDATE", MANDATE_EXTENSION: "EXTENSION" };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const GREEK: Record<string, string> = { Α: "A", Β: "V", Γ: "G", Δ: "D", Ε: "E", Ζ: "Z", Η: "I", Θ: "TH", Ι: "I", Κ: "K", Λ: "L", Μ: "M", Ν: "N", Ξ: "X", Ο: "O", Π: "P", Ρ: "R", Σ: "S", Τ: "T", Υ: "Y", Φ: "F", Χ: "CH", Ψ: "PS", Ω: "O" };

/** A document number as an object-key segment: ASCII only (ΥΠ-2026-000251 → YP-2026-000251). */
export function asciiKeySegment(number: string): string {
  return number
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[Α-Ω]/g, (c) => GREEK[c] ?? "")
    .replace(/[^A-Z0-9-]+/g, "_");
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function newVerificationCode(): string {
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => CROCKFORD[b % 32]).join("");
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function issuedStorageKey(kind: IssueKind, ownerId: string, number: string, textChecksum: string, extensionId?: string): string {
  if (kind === "SHOWING") return `private/documents/showings/${ownerId}/issued/${asciiKeySegment(number)}-${textChecksum}.pdf`;
  if (kind === "MANDATE") return `private/documents/mandates/${ownerId}/issued/${asciiKeySegment(number)}-${textChecksum}.pdf`;
  return `private/documents/mandates/${ownerId}/extensions/${extensionId}-${textChecksum}.pdf`;
}
export const stagingKey = () => `private/documents/staging/${randomUUID()}.pdf`;

function titleOf(kind: DocumentKind, language: "el" | "en"): string {
  const el: Record<DocumentKind, string> = { SHOWING: "Εντολή Υπόδειξης", SIMPLE_ASSIGNMENT: "Απλή Εντολή Ανάθεσης", EXCLUSIVE_ASSIGNMENT: "Αποκλειστική Εντολή Ανάθεσης", MANDATE_EXTENSION: "Παράταση Εντολής" };
  const en: Record<DocumentKind, string> = { SHOWING: "Property Showing Mandate", SIMPLE_ASSIGNMENT: "Simple Assignment Mandate", EXCLUSIVE_ASSIGNMENT: "Exclusive Assignment Mandate", MANDATE_EXTENSION: "Mandate Extension" };
  return (language === "en" ? en : el)[kind];
}

export function encryptSnapshot(s: IssuanceSnapshot): { encrypted: string; checksum: string } {
  const json = JSON.stringify(s);
  const encrypted = encryptField(json);
  if (!encrypted) throw new BrokerageError("ENCRYPTION_NOT_CONFIGURED", "Η κρυπτογράφηση δεν έχει ρυθμιστεί (PII_ENCRYPTION_KEY).");
  return { encrypted, checksum: sha256(json) };
}
export function decryptSnapshot(encrypted: string): IssuanceSnapshot | null {
  const json = decryptField(encrypted);
  return json ? (JSON.parse(json) as IssuanceSnapshot) : null;
}

async function lockRow(tx: Tx, table: "showings" | "mandates" | "mandate_extensions", id: string) {
  // The identifier is one of three constants: it is never user input.
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
}

// ---------------------------------------------------------------------------
// Adapters: what differs between the three kinds
// ---------------------------------------------------------------------------

type Prepared = {
  language: "el" | "en";
  templateKind: DocumentKind;
  validation: DocumentCompletenessResult;
  numbering: (now: Date) => Promise<Numbering>;
  snapshot: (n: Numbering, tpl: { version: number; checksum: string }, representative: string) => Promise<DocumentSnapshot>;
  finalKey: (number: string, textChecksum: string) => string;
};

type Adapter = {
  lockAndLoad(tx: Tx, id: string): Promise<{ status: string; number: string | null }>;
  issuableStatuses: string[];
  setAnomalyAck(tx: Tx, id: string, reason: string, actorId: string): Promise<void>;
  prepare(tx: Tx, id: string, now: Date, ctx: IssueContext): Promise<Prepared>;
  existing(tx: Tx, id: string): Promise<IssueOutcome>;
  commit(tx: Tx, id: string, data: CommitData, ctx: IssueContext): Promise<void>;
  confirm(db: Tx, id: string): Promise<void>;
};

type CommitData = {
  now: Date;
  number: string;
  numbering: Numbering;
  document: DocumentSnapshot;
  template: { id: string; version: number; checksum: string };
  text: string;
  textChecksum: string;
  clauses: string;
  pdf: Buffer;
  pdfChecksum: string;
  finalKey: string;
  snapshotEncrypted: string;
  snapshotChecksum: string;
  verificationCode: string;
  issuance: IssuanceSnapshot;
};

const outcomeOf = (kind: IssueKind, id: string, row: { number: string | null; verificationCode: string | null; pdfChecksum: string | null; renderedChecksum: string | null; storageKey: string | null; storageState: string; templateVersion: number | null }): IssueOutcome => ({
  kind,
  id,
  number: row.number ?? "",
  alreadyIssued: true,
  verificationCode: row.verificationCode,
  templateVersion: row.templateVersion,
  renderedTextChecksum: row.renderedChecksum,
  pdfChecksum: row.pdfChecksum,
  storageKey: row.storageKey,
  storageState: row.storageState as IssueOutcome["storageState"],
  warnings: [],
  pageCount: null,
});

// --- Showing ---------------------------------------------------------------

const showingAdapter: Adapter = {
  async lockAndLoad(tx, id) {
    await lockRow(tx, "showings", id);
    const s = await tx.showing.findUnique({ where: { id }, select: { status: true, number: true } });
    if (!s) throw new BrokerageError("SHOWING_NOT_FOUND", "Η υπόδειξη δεν βρέθηκε.");
    return s;
  },
  issuableStatuses: ["DRAFT", "READY_FOR_ISSUANCE"],
  async setAnomalyAck(tx, id, reason, actorId) {
    await tx.showing.update({ where: { id }, data: { feeAnomalyOverrideReason: reason, feeAnomalyOverriddenById: actorId } });
  },
  async prepare(tx, id, now, ctx) {
    const s = await tx.showing.findUniqueOrThrow({ where: { id }, include: { properties: true } });
    // What is printed is what the canonical property says now, so refresh before validating.
    for (const sp of s.properties) {
      if (!sp.propertyId) continue;
      const property = await tx.property.findUnique({ where: { id: sp.propertyId } });
      if (!property) continue;
      const snap = snapshotProperty(property, now);
      await tx.showingProperty.update({ where: { id: sp.id }, data: { ...snap.columns, propertySnapshot: snap.document } });
    }
    const built = await buildShowingValidationInput(tx, id, { blockAnomalies: true });
    const validation = validateShowing(built.input);
    const year = now.getUTCFullYear();
    return {
      language: s.language as "el" | "en",
      templateKind: "SHOWING",
      validation,
      async numbering(at) {
        return { number: await allocateShowingNumber(tx, year), issuedOn: dayOf(at), verificationCode: newVerificationCode() };
      },
      snapshot: (n, tpl, rep) => buildShowingSnapshot(tx, id, n, tpl, rep),
      finalKey: (number, checksum) => issuedStorageKey("SHOWING", id, number, checksum),
    };
  },
  async existing(tx, id) {
    const s = await tx.showing.findUniqueOrThrow({ where: { id }, include: { templateVersion: { select: { version: true } } } });
    return outcomeOf("SHOWING", id, { number: s.number, verificationCode: s.verificationCode, pdfChecksum: s.pdfChecksum, renderedChecksum: s.renderedTextChecksum, storageKey: s.pdfStorageKey, storageState: s.storageState, templateVersion: s.templateVersion?.version ?? null });
  },
  async commit(tx, id, d, ctx) {
    const s = await tx.showing.findUniqueOrThrow({ where: { id }, include: { properties: { orderBy: { sortOrder: "asc" } } } });
    if (s.status === "DRAFT") await tx.showing.update({ where: { id }, data: { status: "READY_FOR_ISSUANCE" } });
    // The fee as it applies to each printed property.
    for (const [i, sp] of s.properties.entries()) {
      const fee = d.document.properties[i]?.fee;
      await tx.showingProperty.update({ where: { id: sp.id }, data: { commissionSnapshot: fee ? ({ ...fee, currency: d.document.fee?.currency ?? "EUR", method: d.document.fee?.method ?? null, percentage: d.document.fee?.percentage ?? null } as Prisma.InputJsonObject) : undefined, vatTreatmentSnapshot: s.vatTreatment } });
    }
    const clients = d.document.parties;
    const clientSnapshotEncrypted = encryptField(JSON.stringify(clients));
    await tx.showing.update({
      where: { id },
      data: {
        status: "ISSUED",
        number: d.number,
        year: Number(d.number.match(/-(\d{4})-/)![1]),
        issuedAt: d.now,
        documentDate: s.documentDate ?? new Date(`${d.numbering.issuedOn}T00:00:00Z`),
        templateVersionId: d.template.id,
        templateChecksum: d.template.checksum,
        renderedTextEncrypted: encryptField(d.text),
        renderedTextChecksum: d.textChecksum,
        issuanceSnapshotEncrypted: d.snapshotEncrypted,
        issuanceSnapshotChecksum: d.snapshotChecksum,
        pdfStorageKey: d.finalKey,
        pdfChecksum: d.pdfChecksum,
        storageState: "PENDING",
        verificationCode: d.verificationCode,
        clientSnapshotEncrypted,
        companySnapshot: d.document.company as Prisma.InputJsonObject,
        completenessResult: { status: "READY", blockingIssues: [], warnings: [], draftSaveable: true } as Prisma.InputJsonObject,
        completenessCheckedAt: d.now,
      },
    });
    await tx.showingEvent.create({ data: { showingId: id, type: "ISSUED", summary: `Εκδόθηκε η υπόδειξη ${d.number}`, data: { number: d.number, templateVersion: d.template.version, pdfChecksum: d.pdfChecksum }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
    await replaceOriginalShowing(tx, s.replacesShowingId, id, d.number, ctx);
  },
  async confirm(db, id) {
    await db.showing.update({ where: { id }, data: { storageState: "CONFIRMED" } });
  },
};

async function replaceOriginalShowing(tx: Tx, originalId: string | null, replacementId: string, number: string, ctx: IssueContext) {
  if (!originalId) return;
  const o = await tx.showing.findUnique({ where: { id: originalId }, select: { status: true, number: true } });
  if (!o) return;
  const reason = `Αντικαταστάθηκε από την ${number}`;
  // A signed showing stays as signed history; anything else still in play is cancelled with the replacement.
  if (!["SIGNED", "DECLINED", "EXPIRED", "CANCELLED"].includes(o.status)) {
    await tx.showing.update({ where: { id: originalId }, data: { status: "CANCELLED", cancelledAt: ctx.now ?? new Date(), cancelReason: reason } });
    await tx.showingEvent.create({ data: { showingId: originalId, type: "CANCELLED", summary: reason, actorId: ctx.actor.id, actorName: ctx.actor.name } });
  }
  await tx.showingEvent.create({ data: { showingId: originalId, type: "REPLACED", summary: `Αντικαταστάθηκε από την ${number}`, data: { replacementId }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
  await recordDocumentAudit(tx, { ...ctx, actorUserId: ctx.actor.id, actorRole: ctx.actor.role, type: "SHOWING_REPLACED", entityType: "SHOWING", entityId: originalId, documentNumber: o.number, reason, after: { replacementId, replacementNumber: number, originalStatus: o.status } });
}

// --- Mandate ---------------------------------------------------------------

async function allocateMandateNumber(tx: Tx): Promise<string> {
  const cfg = await settings().config("mandates");
  const prefix = typeof cfg.numberingPrefix === "string" ? cfg.numberingPrefix.trim() : "";
  const digits = Number(cfg.numberingDigits);
  if (!prefix || !(digits > 0)) throw new BrokerageError("MANDATE_NUMBERING_MISSING", "Ρυθμίσεις → Ψηφιακές Εντολές: λείπει το πρόθεμα ή τα ψηφία της αρίθμησης.");
  const counter = await tx.referenceCounter.upsert({ where: { scope: "mandate-number" }, create: { scope: "mandate-number", nextValue: 2 }, update: { nextValue: { increment: 1 } } });
  return `${prefix}-${String(counter.nextValue - 1).padStart(Math.max(1, digits), "0")}`;
}

const mandateAdapter: Adapter = {
  async lockAndLoad(tx, id) {
    await lockRow(tx, "mandates", id);
    const m = await tx.mandate.findUnique({ where: { id }, select: { status: true, number: true } });
    if (!m) throw new BrokerageError("MANDATE_NOT_FOUND", "Η εντολή δεν βρέθηκε.");
    return m;
  },
  issuableStatuses: ["DRAFT"],
  async setAnomalyAck(tx, id, reason, actorId) {
    await tx.mandate.update({ where: { id }, data: { feeAnomalyOverrideReason: reason, feeAnomalyOverriddenById: actorId } });
  },
  async prepare(tx, id, now) {
    const m = await tx.mandate.findUniqueOrThrow({ where: { id }, select: { type: true, locale: true } });
    if (m.type !== "SIMPLE_ASSIGNMENT" && m.type !== "EXCLUSIVE_ASSIGNMENT") throw new BrokerageError("MANDATE_TYPE_UNSUPPORTED", "Το έγγραφο εκδίδεται μόνο για απλή ή αποκλειστική ανάθεση.");
    const validation = validateMandate(await buildMandateValidationInput(tx, id, now, { blockAnomalies: true }));
    return {
      language: m.locale as "el" | "en",
      templateKind: m.type,
      validation,
      async numbering(at) {
        return { number: await allocateMandateNumber(tx), issuedOn: dayOf(at), verificationCode: newVerificationCode() };
      },
      snapshot: (n, tpl, rep) => buildMandateSnapshot(tx, id, n, tpl, rep),
      finalKey: (number, checksum) => issuedStorageKey("MANDATE", id, number, checksum),
    };
  },
  async existing(tx, id) {
    const m = await tx.mandate.findUniqueOrThrow({ where: { id }, include: { templateVersion: { select: { version: true } }, pdfDocument: { select: { storageKey: true } } } });
    return outcomeOf("MANDATE", id, { number: m.number, verificationCode: m.verificationCode, pdfChecksum: m.pdfChecksum, renderedChecksum: m.renderedChecksum, storageKey: m.pdfDocument?.storageKey ?? null, storageState: m.storageState, templateVersion: m.templateVersion?.version ?? null });
  },
  async commit(tx, id, d, ctx) {
    const m = await tx.mandate.findUniqueOrThrow({ where: { id }, include: { parties: { orderBy: { sortOrder: "asc" } }, property: { select: { id: true } } } });
    const typeTitle = titleOf(d.document.kind, d.document.language);
    const doc = await tx.document.create({
      data: {
        title: `${typeTitle} ${d.number}`,
        category: "MANDATE",
        storageKey: d.finalKey,
        mimeType: "application/pdf",
        byteSize: d.pdf.length,
        checksum: d.pdfChecksum,
        containsPersonalData: true,
        propertyId: m.propertyId,
        contactId: m.parties[0]?.contactId ?? null,
        uploadedById: ctx.actor.id,
      },
    });
    await tx.mandate.update({
      where: { id },
      data: {
        status: "ISSUED",
        number: d.number,
        issuedAt: d.now,
        templateVersionId: d.template.id,
        templateChecksum: d.template.checksum,
        renderedTextEncrypted: encryptField(d.text),
        renderedChecksum: d.textChecksum,
        pdfDocumentId: doc.id,
        pdfChecksum: d.pdfChecksum,
        issuanceSnapshotEncrypted: d.snapshotEncrypted,
        issuanceSnapshotChecksum: d.snapshotChecksum,
        storageState: "PENDING",
        verificationCode: d.verificationCode,
        completenessResult: { status: "READY", blockingIssues: [], warnings: [], draftSaveable: true } as Prisma.InputJsonObject,
        completenessCheckedAt: d.now,
      },
    });
    await tx.mandateEvent.create({ data: { mandateId: id, type: "ISSUED", summary: `Εκδόθηκε με αριθμό ${d.number} (πρότυπο έκδοση ${d.template.version})`, data: { number: d.number, templateVersion: d.template.version, pdfChecksum: d.pdfChecksum }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
    if (m.sellerLeadId) {
      await tx.sellerLeadEvent.create({ data: { sellerLeadId: m.sellerLeadId, type: "MANDATE", summary: `Εκδόθηκε η εντολή ${d.number}`, actorId: ctx.actor.id, actorName: ctx.actor.name } });
    }
    await replaceOriginalMandate(tx, m.supersedesMandateId, id, d.number, ctx);
  },
  async confirm(db, id) {
    await db.mandate.update({ where: { id }, data: { storageState: "CONFIRMED" } });
  },
};

async function replaceOriginalMandate(tx: Tx, originalId: string | null, replacementId: string, number: string, ctx: IssueContext) {
  if (!originalId) return;
  const o = await tx.mandate.findUnique({ where: { id: originalId }, select: { status: true, number: true, reference: true } });
  if (!o) return;
  const reason = `Αντικαταστάθηκε από την ${number}`;
  if (["ISSUED", "SENT", "VIEWED"].includes(o.status)) {
    await tx.mandate.update({ where: { id: originalId }, data: { status: "CANCELLED", cancelledAt: ctx.now ?? new Date(), cancelReason: reason } });
    await tx.mandateEvent.create({ data: { mandateId: originalId, type: "CANCELLED", summary: reason, actorId: ctx.actor.id, actorName: ctx.actor.name } });
  }
  await tx.mandateEvent.create({ data: { mandateId: originalId, type: "REPLACED", summary: reason, data: { replacementId }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
  await recordDocumentAudit(tx, { ...ctx, actorUserId: ctx.actor.id, actorRole: ctx.actor.role, type: "MANDATE_REPLACED", entityType: "MANDATE", entityId: originalId, documentNumber: o.number ?? o.reference, reason, after: { replacementId, replacementNumber: number, originalStatus: o.status } });
}

// --- Extension -----------------------------------------------------------------

const extensionAdapter: Adapter = {
  async lockAndLoad(tx, id) {
    await lockRow(tx, "mandate_extensions", id);
    const x = await tx.mandateExtension.findUnique({ where: { id }, select: { status: true, number: true } });
    if (!x) throw new BrokerageError("EXTENSION_NOT_FOUND", "Η παράταση δεν βρέθηκε.");
    return x;
  },
  issuableStatuses: ["DRAFT"],
  async setAnomalyAck() {
    /* an extension carries no fee */
  },
  async prepare(tx, id, now) {
    const x = await tx.mandateExtension.findUniqueOrThrow({ where: { id }, include: { mandate: { include: { parties: true, extensions: true } } } });
    const m = x.mandate;
    const blocking: ValidationIssue[] = [];
    if (m.status !== "SIGNED") blocking.push({ code: "MANDATE_NOT_SIGNED", message: "Παράταση εκδίδεται μόνο σε υπογεγραμμένη εντολή." });
    const effective = await currentEndDate(tx, m.id);
    if (!effective || x.previousEndDate.toISOString().slice(0, 10) !== effective.toISOString().slice(0, 10)) {
      blocking.push({ code: "EXTENSION_CHAIN_BROKEN", message: "Η προηγούμενη λήξη της παράτασης δεν ταιριάζει με την τρέχουσα λήξη της εντολής." });
    }
    // The extended period was checked against other exclusive mandates when the extension was created.
    const [company, tpl] = await Promise.all([loadCompanyFacts(tx, m.locale), loadTemplateCheck(tx, "MANDATE_EXTENSION", m.locale)]);
    const validation = mergeCompleteness(
      { blockingIssues: blocking, warnings: [] },
      validateParties(m.parties.map((p) => ({ fullName: p.fullName, role: p.role, isSignatory: true, hasTaxId: p.taxIdEncrypted != null, hasIdNumber: p.idNumberEncrypted != null, hasAddress: p.addressEncrypted != null, hasPhone: p.phoneEncrypted != null, hasEmail: p.emailEncrypted != null })), "εντολέας"),
      validateTemplateCheck(tpl.check, { type: "MANDATE_EXTENSION", locale: m.locale }),
      validateCompanyFacts(company.missing),
    );
    return {
      language: m.locale as "el" | "en",
      templateKind: "MANDATE_EXTENSION",
      validation,
      async numbering(at) {
        const counter = await tx.referenceCounter.upsert({ where: { scope: `extension:${m.id}` }, create: { scope: `extension:${m.id}`, nextValue: 2 }, update: { nextValue: { increment: 1 } } });
        return { number: `${m.number ?? m.reference}/Π${counter.nextValue - 1}`, issuedOn: dayOf(at), verificationCode: newVerificationCode() };
      },
      snapshot: (n, template, rep) => buildExtensionSnapshot(tx, id, n, template, rep, decryptSnapshot),
      finalKey: (_number, checksum) => issuedStorageKey("MANDATE_EXTENSION", m.id, "", checksum, id),
    };
  },
  async existing(tx, id) {
    const x = await tx.mandateExtension.findUniqueOrThrow({ where: { id } });
    const v = x.templateVersionId ? await tx.mandateTemplateVersion.findUnique({ where: { id: x.templateVersionId }, select: { version: true } }) : null;
    return outcomeOf("MANDATE_EXTENSION", id, { number: x.number, verificationCode: x.verificationCode, pdfChecksum: x.pdfChecksum, renderedChecksum: x.renderedTextChecksum, storageKey: x.pdfStorageKey, storageState: x.storageState, templateVersion: v?.version ?? null });
  },
  async commit(tx, id, d, ctx) {
    await tx.mandateExtension.update({
      where: { id },
      data: {
        status: "ISSUED",
        number: d.number,
        issuedAt: d.now,
        extensionTextSnapshot: d.clauses,
        templateVersionId: d.template.id,
        templateChecksum: d.template.checksum,
        renderedTextEncrypted: encryptField(d.text),
        renderedTextChecksum: d.textChecksum,
        issuanceSnapshotEncrypted: d.snapshotEncrypted,
        issuanceSnapshotChecksum: d.snapshotChecksum,
        pdfStorageKey: d.finalKey,
        pdfChecksum: d.pdfChecksum,
        storageState: "PENDING",
        verificationCode: d.verificationCode,
      },
    });
    const x = await tx.mandateExtension.findUniqueOrThrow({ where: { id }, select: { mandateId: true, newEndDate: true } });
    await tx.mandateEvent.create({ data: { mandateId: x.mandateId, type: "EXTENSION_ISSUED", summary: `Εκδόθηκε παράταση ${d.number} έως ${dayOf(x.newEndDate)}`, data: { extensionId: id, number: d.number, pdfChecksum: d.pdfChecksum }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
  },
  async confirm(db, id) {
    await db.mandateExtension.update({ where: { id }, data: { storageState: "CONFIRMED" } });
  },
};

const ADAPTERS: Record<IssueKind, Adapter> = { SHOWING: showingAdapter, MANDATE: mandateAdapter, MANDATE_EXTENSION: extensionAdapter };

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

type Pending = { staged: string | null; finalKey: string; bytes: Buffer; checksum: string; number: string };

export async function issueDocument(client: Transactional & Parameters<typeof recordDocumentAudit>[0], kind: IssueKind, id: string, ctx: IssueContext): Promise<IssueOutcome> {
  const store = ctx.store ?? documentStore();
  if (!store.configured()) throw new BrokerageError("STORAGE_NOT_CONFIGURED", "Η αποθήκευση αρχείων (S3) δεν έχει ρυθμιστεί στον server.");
  if (!hasEncryptionKey()) throw new BrokerageError("ENCRYPTION_NOT_CONFIGURED", "Η κρυπτογράφηση δεν έχει ρυθμιστεί (PII_ENCRYPTION_KEY).");
  const adapter = ADAPTERS[kind];
  const now = ctx.now ?? new Date();
  const audit = (db: Parameters<typeof recordDocumentAudit>[0], type: Parameters<typeof recordDocumentAudit>[1]["type"], entityId: string, extra: Partial<Parameters<typeof recordDocumentAudit>[1]> = {}) =>
    recordDocumentAudit(db, { ...ctx, actorUserId: ctx.actor.id, actorRole: ctx.actor.role, type, entityType: ENTITY[kind], entityId, occurredAt: now, ...extra });

  const pending: Pending = { staged: null, finalKey: "", bytes: Buffer.alloc(0), checksum: "", number: "" };
  let result: IssueOutcome;
  try {
    result = await client.$transaction(
      async (tx) => {
        const row = await adapter.lockAndLoad(tx, id);
        // Already issued (maybe a moment ago, by another request): hand back that document.
        if (row.number) return adapter.existing(tx, id);
        if (!adapter.issuableStatuses.includes(row.status)) throw new BrokerageError("INVALID_TRANSITION", "Το έγγραφο δεν μπορεί να εκδοθεί από την τρέχουσα κατάσταση.");

        const reason = ctx.acknowledgeFeeAnomaly?.trim();
        if (reason) {
          await adapter.setAnomalyAck(tx, id, reason, ctx.actor.id);
          await audit(tx, "COMMISSION_ANOMALY_ACKNOWLEDGED", id, { reason });
        }

        const prepared = await adapter.prepare(tx, id, now, ctx);
        if (prepared.validation.status === "BLOCKED") throw new DocumentBlockedError(prepared.validation);

        // The wording: only the approved ACTIVE version, checksum verified, no fallback.
        const template = await resolveApprovedTemplate(tx, prepared.templateKind, prepared.language);
        await audit(tx, "TEMPLATE_RESOLVED", id, { metadata: { templateKind: prepared.templateKind, language: prepared.language, version: template.version } });
        await audit(tx, "TEMPLATE_CHECKSUM_VERIFIED", id, { metadata: { version: template.version, checksum: template.checksum } });

        const numbering = await prepared.numbering(now);
        const tpl = { version: template.version, checksum: template.checksum };
        const document = await prepared.snapshot(numbering, tpl, ctx.actor.name);

        const merged = renderClauses(template.body, mergeValues(document));
        if (!merged.ok) {
          const parts = [merged.unknown.length ? `άγνωστα πεδία: ${merged.unknown.join(", ")}` : "", merged.missing.length ? `δεν έχουν τιμή: ${merged.missing.join(", ")}` : "", merged.unclosed ? "πεδίο χωρίς κλείσιμο" : ""].filter(Boolean);
          throw new TemplateRejectedError("TEMPLATE_FIELDS_INVALID", `Το πρότυπο δεν μπορεί να συμπληρωθεί για αυτό το έγγραφο — ${parts.join(" · ")}.`);
        }
        const blocks = buildDocumentBlocks(document, merged.text);
        const text = blocksToText(blocks).trim(); // stored encrypted (which trims): the checksum must be of exactly what is stored
        const problems = scanFinalText(document.kind, text);
        if (problems.length > 0) throw new TemplateRejectedError("FINAL_TEXT_INVALID", `Το έγγραφο δεν εκδόθηκε: ${problems.map((p) => p.message).join(" ")}`);
        const textChecksum = sha256(text);

        const { pdf, layout } = await renderDocumentPdf({ blocks, snapshot: document, title: titleOf(document.kind, document.language), issuedAt: now });
        const pdfChecksum = sha256(pdf);
        const finalKey = prepared.finalKey(numbering.number, textChecksum);

        // Stage privately before committing; the final key is only written once the database agrees.
        pending.staged = stagingKey();
        await store.put(pending.staged, pdf, "application/pdf");
        Object.assign(pending, { finalKey, bytes: pdf, checksum: pdfChecksum, number: numbering.number });

        const issuance: IssuanceSnapshot = { version: 1, title: titleOf(document.kind, document.language), document, clauses: merged.text, issuedAt: now.toISOString() };
        const snap = encryptSnapshot(issuance);
        await adapter.commit(tx, id, { now, number: numbering.number, numbering, document, template: { id: template.id, version: template.version, checksum: template.checksum }, text, textChecksum, clauses: merged.text, pdf, pdfChecksum, finalKey, snapshotEncrypted: snap.encrypted, snapshotChecksum: snap.checksum, verificationCode: numbering.verificationCode, issuance }, ctx);

        const issuedType = `${PREFIX[kind]}_ISSUED` as Parameters<typeof recordDocumentAudit>[1]["type"];
        const pdfType = `${PREFIX[kind]}_PDF_GENERATED` as Parameters<typeof recordDocumentAudit>[1]["type"];
        await audit(tx, issuedType, id, {
          documentNumber: numbering.number,
          before: { status: row.status },
          after: { status: kind === "MANDATE_EXTENSION" ? "ISSUED" : "ISSUED", number: numbering.number, templateVersion: template.version, storageState: "PENDING" },
          metadata: { warnings: prepared.validation.warnings.map((w) => w.code), pageCount: layout.pageCount },
        });
        await audit(tx, pdfType, id, { documentNumber: numbering.number, metadata: { renderedTextChecksum: textChecksum, pdfChecksum, templateChecksum: template.checksum, pages: layout.pageCount } });
        return {
          kind, id, number: numbering.number, alreadyIssued: false, verificationCode: numbering.verificationCode, templateVersion: template.version,
          renderedTextChecksum: textChecksum, pdfChecksum, storageKey: finalKey, storageState: "PENDING" as const, warnings: prepared.validation.warnings, pageCount: layout.pageCount,
        };
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (error) {
    // Nothing was committed: remove what was staged and keep a record of why it stopped.
    if (pending.staged) await store.remove(pending.staged).catch((e) => console.error("[home88:documents] staged object cleanup failed:", (e as Error).message));
    if (error instanceof DocumentBlockedError) {
      await audit(client, "DOCUMENT_VALIDATION_BLOCKED", id, { metadata: { codes: error.result.blockingIssues.map((i) => i.code) } }).catch(() => undefined);
      if (error.result.blockingIssues.some((i) => i.code === "EXCLUSIVE_CONFLICT")) {
        await audit(client, "EXCLUSIVE_CONFLICT_DETECTED", id, { metadata: { codes: ["EXCLUSIVE_CONFLICT"] } }).catch(() => undefined);
      }
    } else if (error instanceof TemplateRejectedError) {
      await audit(client, "DOCUMENT_VALIDATION_BLOCKED", id, { metadata: { codes: [error.code] } }).catch(() => undefined);
    }
    throw error;
  }

  if (result.alreadyIssued) return result;
  return finalizeStorage(client, kind, id, { ...pending }, result, store, ctx);
}

/** Moves the staged PDF to its final immutable key, verifies it, and confirms the document. */
async function finalizeStorage(client: Parameters<typeof recordDocumentAudit>[0] & Transactional, kind: IssueKind, id: string, p: Pending, result: IssueOutcome, store: DocumentStore, ctx: IssueContext): Promise<IssueOutcome> {
  const base = { ...ctx, actorUserId: ctx.actor.id, actorRole: ctx.actor.role, entityType: ENTITY[kind], entityId: id, documentNumber: p.number };
  try {
    await store.put(p.finalKey, p.bytes, "application/pdf");
    const back = await store.read(p.finalKey);
    if (!back || sha256(back) !== p.checksum) throw new Error("final object did not verify");
    await ADAPTERS[kind].confirm(client as Tx, id);
    if (p.staged) await store.remove(p.staged).catch(() => undefined);
    await recordDocumentAudit(client, { ...base, type: "DOCUMENT_STORAGE_CONFIRMED", metadata: { pdfChecksum: p.checksum } });
    return { ...result, storageState: "CONFIRMED" };
  } catch (error) {
    // Issued, but not yet verified at its final key: recoverable, and never sent or signed meanwhile.
    console.error(`[home88:documents] ${kind} ${id}: final storage not confirmed:`, (error as Error).message);
    await recordDocumentAudit(client, { ...base, type: "DOCUMENT_STORAGE_PENDING", reason: "Η μεταφορά στο τελικό αντικείμενο δεν επιβεβαιώθηκε" }).catch(() => undefined);
    return { ...result, storageState: "PENDING" };
  }
}

// ---------------------------------------------------------------------------
// Recovery and reading
// ---------------------------------------------------------------------------

/**
 * Finishes documents left PENDING: if the final object is already there and
 * matches, confirm it; otherwise re-render the PDF from the stored snapshot
 * (the PDF is deterministic) and store it only if it reproduces the recorded
 * checksum. A document whose bytes cannot be reproduced stays PENDING.
 */
export async function recoverPendingStorage(client: Parameters<typeof recordDocumentAudit>[0] & Transactional, store: DocumentStore = documentStore(), limit = 25): Promise<{ confirmed: number; stillPending: number }> {
  let confirmed = 0;
  let stillPending = 0;
  type Row = { kind: IssueKind; id: string; key: string; checksum: string; snapshot: string | null; number: string | null; issuedAt: Date | null };
  const rows: Row[] = [];
  for (const s of await client.showing.findMany({ where: { storageState: "PENDING" }, take: limit })) rows.push({ kind: "SHOWING", id: s.id, key: s.pdfStorageKey!, checksum: s.pdfChecksum!, snapshot: s.issuanceSnapshotEncrypted, number: s.number, issuedAt: s.issuedAt });
  for (const m of await client.mandate.findMany({ where: { storageState: "PENDING" }, take: limit, include: { pdfDocument: true } })) rows.push({ kind: "MANDATE", id: m.id, key: m.pdfDocument?.storageKey ?? "", checksum: m.pdfChecksum ?? "", snapshot: m.issuanceSnapshotEncrypted, number: m.number, issuedAt: m.issuedAt });
  for (const x of await client.mandateExtension.findMany({ where: { storageState: "PENDING" }, take: limit })) rows.push({ kind: "MANDATE_EXTENSION", id: x.id, key: x.pdfStorageKey!, checksum: x.pdfChecksum!, snapshot: x.issuanceSnapshotEncrypted, number: x.number, issuedAt: x.issuedAt });

  for (const r of rows) {
    try {
      let bytes = await store.read(r.key);
      if (!bytes || sha256(bytes) !== r.checksum) {
        const snap = r.snapshot ? decryptSnapshot(r.snapshot) : null;
        if (!snap || !r.issuedAt) throw new Error("no snapshot to reproduce the PDF from");
        const { buildDocumentBlocks: build } = await import("@home88/domain");
        const { pdf } = await renderDocumentPdf({ blocks: build(snap.document, snap.clauses), snapshot: snap.document, title: snap.title, issuedAt: r.issuedAt });
        if (sha256(pdf) !== r.checksum) throw new Error("re-rendered PDF does not match the recorded checksum");
        bytes = pdf;
        await store.put(r.key, bytes, "application/pdf");
      }
      const back = await store.read(r.key);
      if (!back || sha256(back) !== r.checksum) throw new Error("stored object does not verify");
      await ADAPTERS[r.kind].confirm(client as Tx, r.id);
      await recordDocumentAudit(client, { type: "DOCUMENT_STORAGE_CONFIRMED", entityType: ENTITY[r.kind], entityId: r.id, documentNumber: r.number, reason: "Επαναφορά αποθήκευσης", metadata: { recovered: true } });
      confirmed++;
    } catch (error) {
      console.error(`[home88:documents] recovery of ${r.kind} ${r.id} failed:`, (error as Error).message);
      stillPending++;
    }
  }
  return { confirmed, stillPending };
}

export type IssuedPdf = { bytes: Buffer; checksum: string; key: string; filename: string; number: string };

/**
 * The issued PDF, read from private storage and verified against its recorded
 * checksum. Refuses while storage is PENDING: nothing unverified is sent,
 * signed or handed out.
 */
export async function loadIssuedPdf(db: Parameters<typeof recordDocumentAudit>[0], kind: IssueKind, id: string, store: DocumentStore = documentStore()): Promise<IssuedPdf> {
  let row: { number: string | null; key: string | null; checksum: string | null; state: string };
  if (kind === "SHOWING") {
    const s = await db.showing.findUnique({ where: { id } });
    if (!s) throw new BrokerageError("SHOWING_NOT_FOUND", "Η υπόδειξη δεν βρέθηκε.");
    row = { number: s.number, key: s.pdfStorageKey, checksum: s.pdfChecksum, state: s.storageState };
  } else if (kind === "MANDATE") {
    const m = await db.mandate.findUnique({ where: { id }, include: { pdfDocument: true } });
    if (!m) throw new BrokerageError("MANDATE_NOT_FOUND", "Η εντολή δεν βρέθηκε.");
    row = { number: m.number, key: m.pdfDocument?.storageKey ?? null, checksum: m.pdfChecksum, state: m.storageState };
  } else {
    const x = await db.mandateExtension.findUnique({ where: { id } });
    if (!x) throw new BrokerageError("EXTENSION_NOT_FOUND", "Η παράταση δεν βρέθηκε.");
    row = { number: x.number, key: x.pdfStorageKey, checksum: x.pdfChecksum, state: x.storageState };
  }
  if (!row.number || !row.key || !row.checksum) throw new BrokerageError("NOT_ISSUED", "Το έγγραφο δεν έχει εκδοθεί.");
  if (row.state === "PENDING") throw new BrokerageError("STORAGE_PENDING", "Το PDF δεν έχει επαληθευτεί ακόμη στην αποθήκευση. Δοκιμάστε ξανά σε λίγο.");
  const bytes = await store.read(row.key);
  if (!bytes || sha256(bytes) !== row.checksum) throw new BrokerageError("PDF_INTEGRITY", "Το PDF δεν βρέθηκε ή δεν ταιριάζει με το checksum του.");
  return { bytes, checksum: row.checksum, key: row.key, number: row.number, filename: `${asciiKeySegment(row.number)}.pdf` };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export type DocumentPreview = {
  /** TEMPLATE_UNAVAILABLE: no approved active wording yet. BLOCKED: the document is not complete. */
  state: "READY" | "BLOCKED" | "TEMPLATE_UNAVAILABLE" | "TEMPLATE_INVALID";
  message: string | null;
  text: string | null;
  templateVersion: number | null;
  validation: DocumentCompletenessResult;
};

class PreviewRollback extends Error {
  constructor(readonly preview: DocumentPreview) {
    super("preview");
  }
}

/**
 * What the document would say if it were issued now, from the approved ACTIVE
 * template only. Nothing is kept: no number is allocated, no snapshot is
 * stored and the property refresh that issuing performs is rolled back. The
 * text holds personal data, so callers decide who may see it.
 */
export async function previewDocument(client: Transactional, kind: IssueKind, id: string, actor: string, now: Date = new Date()): Promise<DocumentPreview> {
  const adapter = ADAPTERS[kind];
  try {
    await client.$transaction(async (tx) => {
      const row = await adapter.lockAndLoad(tx, id);
      if (row.number) throw new BrokerageError("INVALID_TRANSITION", "Το έγγραφο έχει ήδη εκδοθεί.");
      const prepared = await adapter.prepare(tx, id, now, { actor: { id: "preview", name: actor, role: "AGENT" } } as IssueContext);
      const validation = prepared.validation;
      if (validation.status === "BLOCKED") throw new PreviewRollback({ state: "BLOCKED", message: null, text: null, templateVersion: null, validation });
      let template;
      try {
        template = await resolveApprovedTemplate(tx, prepared.templateKind, prepared.language);
      } catch (e) {
        if (e instanceof TemplateRejectedError) throw new PreviewRollback({ state: "TEMPLATE_UNAVAILABLE", message: e.message, text: null, templateVersion: null, validation });
        throw e;
      }
      const numbering: Numbering = { number: "«αριθμός κατά την έκδοση»", issuedOn: dayOf(now), verificationCode: "—" };
      const document = await prepared.snapshot(numbering, { version: template.version, checksum: template.checksum }, actor);
      const merged = renderClauses(template.body, mergeValues(document));
      if (!merged.ok) {
        const parts = [merged.unknown.length ? `άγνωστα πεδία: ${merged.unknown.join(", ")}` : "", merged.missing.length ? `δεν έχουν τιμή: ${merged.missing.join(", ")}` : "", merged.unclosed ? "πεδίο χωρίς κλείσιμο" : ""].filter(Boolean);
        throw new PreviewRollback({ state: "TEMPLATE_INVALID", message: `Το πρότυπο δεν μπορεί να συμπληρωθεί — ${parts.join(" · ")}.`, text: null, templateVersion: template.version, validation });
      }
      const text = blocksToText(buildDocumentBlocks(document, merged.text)).trim();
      throw new PreviewRollback({ state: "READY", message: null, text, templateVersion: template.version, validation });
    });
  } catch (e) {
    if (e instanceof PreviewRollback) return e.preview;
    throw e;
  }
  throw new Error("preview did not complete");
}
