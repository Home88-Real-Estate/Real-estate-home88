/**
 * Signing issued documents: provider e-signature and signed paper copies, for
 * showings, mandates (the existing flow) and mandate extensions.
 *
 * The provider is given the exact issued PDF, read from private storage and
 * verified against the checksum recorded at issue; the request carries that
 * checksum, and the signature level recorded is the one configured in
 * Settings (never upgraded here). A paper-signed copy is a separate private
 * artifact with its own checksum; the issued PDF is never overwritten.
 */

import type { Prisma } from "@home88/database";

import { resolveSignatureProvider } from "../../../providers/signature";
import { settings } from "../../../settings";
import { documentKey, documentStore, sha256, type DocumentStore } from "../../document-store";
import { decryptField } from "../../pii";
import { BrokerageError } from "../errors";
import type { Db } from "../types";
import { recordDocumentAudit, type AuditContext } from "./audit";
import { asciiKeySegment, loadIssuedPdf, type IssueActor, type IssueKind } from "./issue";

export type SigningContext = AuditContext & { actor: IssueActor; now?: Date; store?: DocumentStore };
type Client = Db & { $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T> };

const ENTITY = { SHOWING: "SHOWING", MANDATE: "MANDATE", MANDATE_EXTENSION: "MANDATE_EXTENSION" } as const;
const PREFIX = { SHOWING: "SHOWING", MANDATE: "MANDATE", MANDATE_EXTENSION: "EXTENSION" } as const;

async function signersOf(db: Db, kind: IssueKind, id: string) {
  if (kind === "SHOWING") {
    const parties = await db.showingParty.findMany({ where: { showingId: id, isSignatory: true }, orderBy: { sortOrder: "asc" } });
    return parties.map((p) => ({ name: p.fullName, email: decryptField(p.emailEncrypted), phone: decryptField(p.phoneEncrypted) }));
  }
  const mandateId = kind === "MANDATE" ? id : (await db.mandateExtension.findUniqueOrThrow({ where: { id }, select: { mandateId: true } })).mandateId;
  const parties = await db.mandateParty.findMany({ where: { mandateId }, orderBy: { sortOrder: "asc" } });
  return parties.map((p) => ({ name: p.fullName, email: decryptField(p.emailEncrypted), phone: decryptField(p.phoneEncrypted) }));
}

/** Sends the exact issued PDF to the signature provider. Refuses while storage is unverified. */
export async function sendDocumentForSignature(db: Client, kind: IssueKind, id: string, ctx: SigningContext) {
  const cfg = await settings().config("mandates");
  const provider = await resolveSignatureProvider();
  if (provider.getStatus().state !== "configured") {
    throw new BrokerageError("NO_SIGNATURE_PROVIDER", "Δεν υπάρχει ενεργός πάροχος ηλεκτρονικής υπογραφής. Μπορείτε να υπογράψετε σε χαρτί και να ανεβάσετε το υπογεγραμμένο αντίγραφο.");
  }
  const level = String(cfg.signatureLevel ?? "");
  if (!level || !(Number(cfg.signingExpiryDays) > 0)) throw new BrokerageError("SIGNING_SETTINGS_MISSING", "Ρυθμίσεις → Ψηφιακές Εντολές: λείπουν το επίπεδο υπογραφής ή η λήξη συνδέσμου.");

  // The issued file, verified against its recorded checksum (and storage confirmed).
  const pdf = await loadIssuedPdf(db, kind, id, ctx.store);
  const signers = await signersOf(db, kind, id);
  if (signers.length === 0) throw new BrokerageError("NO_SIGNERS", "Δεν υπάρχει υπογράφων.");

  const state = await currentState(db, kind, id);
  if (state.status === "DRAFT" || state.status === "READY_FOR_ISSUANCE" || ["SIGNED", "DECLINED", "EXPIRED", "CANCELLED"].includes(state.status)) {
    throw new BrokerageError("INVALID_TRANSITION", "Αποστέλλεται μόνο έγγραφο που έχει εκδοθεί και δεν έχει κλείσει.");
  }
  if (state.envelopeId) throw new BrokerageError("ALREADY_SENT", "Το έγγραφο έχει ήδη σταλεί για υπογραφή.");

  const now = ctx.now ?? new Date();
  const expiresAt = new Date(now.getTime() + Number(cfg.signingExpiryDays) * 86_400_000);
  const envelope = await provider.createSigningRequest({
    documentId: id,
    // The provider is told which exact bytes it is signing.
    documentChecksum: pdf.checksum,
    pdf: pdf.bytes,
    title: `${state.title} ${pdf.number}`,
    signers,
    level: level as "SIMPLE" | "ADVANCED" | "QUALIFIED",
    expiresAt,
  });

  await db.$transaction(async (tx) => {
    if (kind === "SHOWING") {
      await tx.showing.update({ where: { id }, data: { status: "SENT", sentAt: now, envelopeId: envelope.envelopeId, signatureProvider: provider.name, signatureLevel: level, signatureMethod: "PROVIDER", signingExpiresAt: expiresAt } });
      await tx.showingEvent.create({ data: { showingId: id, type: "SENT", summary: `Στάλθηκε για υπογραφή μέσω ${provider.name}`, data: { envelopeId: envelope.envelopeId }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
    } else if (kind === "MANDATE") {
      await tx.mandate.update({ where: { id }, data: { status: "SENT", sentAt: now, envelopeId: envelope.envelopeId, signatureProvider: provider.name, signatureLevel: level, signatureMethod: "PROVIDER", signingExpiresAt: expiresAt } });
      await tx.mandateEvent.create({ data: { mandateId: id, type: "SENT", summary: `Στάλθηκε για υπογραφή μέσω ${provider.name}`, data: { envelopeId: envelope.envelopeId }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
    } else {
      const x = await tx.mandateExtension.update({ where: { id }, data: { sentAt: now, envelopeId: envelope.envelopeId, signatureProvider: provider.name, signatureLevel: level, signatureMethod: "PROVIDER", signingExpiresAt: expiresAt } });
      await tx.mandateEvent.create({ data: { mandateId: x.mandateId, type: "EXTENSION_SENT", summary: `Στάλθηκε η παράταση ${pdf.number} για υπογραφή`, data: { extensionId: id, envelopeId: envelope.envelopeId }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
    }
    await recordDocumentAudit(tx, {
      ...ctx, actorUserId: ctx.actor.id, actorRole: ctx.actor.role, type: `${PREFIX[kind]}_SENT` as never, entityType: ENTITY[kind], entityId: id, documentNumber: pdf.number,
      metadata: { provider: provider.name, level, envelopeId: envelope.envelopeId, documentChecksum: pdf.checksum },
    });
  });
  return { envelopeId: envelope.envelopeId, signingUrls: envelope.signingUrls, documentChecksum: pdf.checksum, level, provider: provider.name };
}

async function currentState(db: Db, kind: IssueKind, id: string): Promise<{ status: string; envelopeId: string | null; title: string }> {
  if (kind === "SHOWING") {
    const s = await db.showing.findUniqueOrThrow({ where: { id } });
    return { status: s.status, envelopeId: s.envelopeId, title: s.language === "en" ? "Property Showing Mandate" : "Εντολή Υπόδειξης" };
  }
  if (kind === "MANDATE") {
    const m = await db.mandate.findUniqueOrThrow({ where: { id } });
    return { status: m.status, envelopeId: m.envelopeId, title: m.locale === "en" ? "Assignment Mandate" : "Εντολή Ανάθεσης" };
  }
  const x = await db.mandateExtension.findUniqueOrThrow({ where: { id }, include: { mandate: { select: { locale: true } } } });
  // An extension is "in play" while ISSUED; map DRAFT/CANCELLED/SIGNED to the refusing states.
  return { status: x.status === "ISSUED" ? "ISSUED" : x.status, envelopeId: x.envelopeId, title: x.mandate.locale === "en" ? "Mandate Extension" : "Παράταση Εντολής" };
}

// ---------------------------------------------------------------------------
// Paper signature
// ---------------------------------------------------------------------------

export type PaperCopy = { storageKey: string; checksum: string; byteSize: number };

/**
 * Records a scanned, signed copy for a showing or extension. The original
 * issued PDF is untouched; the signed copy is its own private object with its
 * own checksum, and the signature level recorded is SIMPLE, as agreed on paper.
 * (Mandates have their own, existing signed-copy route.)
 */
export async function recordPaperSignedCopy(db: Client, kind: "SHOWING" | "MANDATE_EXTENSION", id: string, copy: PaperCopy, input: { signedAt: Date; signerNote?: string | null }, ctx: SigningContext) {
  const now = ctx.now ?? new Date();
  if (input.signedAt.getTime() > now.getTime()) throw new BrokerageError("INVALID_DATE", "Η ημερομηνία υπογραφής δεν μπορεί να είναι μελλοντική.");
  // The original must be intact and verified before a signed copy is attached to it.
  const issued = await loadIssuedPdf(db, kind, id, ctx.store);
  if (copy.checksum === issued.checksum) throw new BrokerageError("SAME_AS_ORIGINAL", "Το υπογεγραμμένο αντίγραφο δεν μπορεί να είναι το αρχικό μη υπογεγραμμένο PDF.");

  await db.$transaction(async (tx) => {
    if (kind === "SHOWING") {
      const s = await tx.showing.findUniqueOrThrow({ where: { id } });
      if (!["ISSUED", "SENT", "VIEWED"].includes(s.status)) throw new BrokerageError("INVALID_TRANSITION", "Υπογεγραμμένο αντίγραφο καταχωρίζεται μόνο για έγγραφο που έχει εκδοθεί και δεν έχει κλείσει.");
      if (s.issuedAt && input.signedAt < new Date(s.issuedAt.toISOString().slice(0, 10))) throw new BrokerageError("INVALID_DATE", "Η ημερομηνία υπογραφής είναι πριν την έκδοση.");
      await tx.showing.update({
        where: { id },
        data: { status: "SIGNED", signedAt: input.signedAt, signatureMethod: "PAPER", signatureLevel: "SIMPLE", signedPdfStorageKey: copy.storageKey, signedPdfChecksum: copy.checksum, signedUploadedById: ctx.actor.id, signedUploadedAt: now },
      });
      await tx.showingParty.updateMany({ where: { showingId: id, signedAt: null, isSignatory: true }, data: { signedAt: input.signedAt } });
      await tx.showingEvent.create({ data: { showingId: id, type: "SIGNED", summary: "Υπογράφηκε σε χαρτί· καταχωρίστηκε το υπογεγραμμένο αντίγραφο", data: { checksum: copy.checksum }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
    } else {
      const x = await tx.mandateExtension.findUniqueOrThrow({ where: { id } });
      if (x.status !== "ISSUED") throw new BrokerageError("INVALID_TRANSITION", "Υπογεγραμμένο αντίγραφο καταχωρίζεται μόνο για παράταση που έχει εκδοθεί.");
      await tx.mandateExtension.update({
        where: { id },
        data: { status: "SIGNED", signedAt: input.signedAt, signatureMethod: "PAPER", signatureLevel: "SIMPLE", signedPdfStorageKey: copy.storageKey, signedPdfChecksum: copy.checksum, signedUploadedById: ctx.actor.id, signedUploadedAt: now },
      });
      await tx.mandateEvent.create({ data: { mandateId: x.mandateId, type: "EXTENSION_SIGNED", summary: `Υπογράφηκε η παράταση ${x.number} σε χαρτί`, data: { extensionId: id, checksum: copy.checksum }, actorId: ctx.actor.id, actorName: ctx.actor.name } });
    }
    await recordDocumentAudit(tx, {
      ...ctx, actorUserId: ctx.actor.id, actorRole: ctx.actor.role, type: `${PREFIX[kind]}_SIGNED` as never, entityType: ENTITY[kind], entityId: id, documentNumber: issued.number,
      metadata: { method: "PAPER", level: "SIMPLE", signedCopyChecksum: copy.checksum, originalChecksum: issued.checksum, signedAt: input.signedAt.toISOString().slice(0, 10), note: input.signerNote ? "[provided]" : null },
    });
  });
  return { originalChecksum: issued.checksum, signedCopyChecksum: copy.checksum };
}

// ---------------------------------------------------------------------------
// Provider callbacks for showings and extensions
// ---------------------------------------------------------------------------

/**
 * A status reported by the signature provider for an envelope belonging to a
 * showing or an extension. Idempotent; returns false when the envelope is not
 * one of ours or nothing changes. (Mandates keep their existing handler.)
 */
export async function applyDocumentSignatureStatus(db: Client, envelopeId: string, status: string, store: DocumentStore = documentStore()): Promise<boolean> {
  const showing = await db.showing.findUnique({ where: { envelopeId } });
  const extension = showing ? null : await db.mandateExtension.findUnique({ where: { envelopeId } });
  if (!showing && !extension) return false;
  const kind: IssueKind = showing ? "SHOWING" : "MANDATE_EXTENSION";
  const id = (showing ?? extension)!.id;
  const number = (showing ?? extension)!.number;
  const current = showing?.status ?? extension!.status;
  if (["SIGNED", "DECLINED", "EXPIRED", "CANCELLED"].includes(current) || current === status) return false;
  const now = new Date();
  const provider = await resolveSignatureProvider();
  const providerName = "Πάροχος υπογραφής";
  const audit = (tx: Db, type: string, metadata?: unknown) =>
    recordDocumentAudit(tx, { actorUserId: null, actorRole: "PROVIDER", type: type as never, entityType: ENTITY[kind], entityId: id, documentNumber: number, metadata, occurredAt: now });

  if (status === "VIEWED") {
    if (showing && showing.status === "SENT") {
      await db.$transaction(async (tx) => {
        await tx.showing.update({ where: { id }, data: { status: "VIEWED", viewedAt: now } });
        await tx.showingEvent.create({ data: { showingId: id, type: "VIEWED", summary: "Ανοίχτηκε από τον υπογράφοντα", actorName: providerName } });
        await audit(tx, `${PREFIX[kind]}_VIEWED`);
      });
      return true;
    }
    if (extension) {
      await audit(db, "EXTENSION_VIEWED");
      return true;
    }
    return false;
  }

  if (status === "SIGNED") {
    let signed: { key: string; checksum: string } | null = null;
    if (provider.downloadSigned) {
      const bytes = await provider.downloadSigned(envelopeId);
      const key = `private/documents/${showing ? `showings/${id}` : `mandates/${extension!.mandateId}/extensions`}/signed/${asciiKeySegment(number ?? id)}-${sha256(bytes).slice(0, 32)}.pdf`;
      await store.put(key, bytes, "application/pdf");
      signed = { key, checksum: sha256(bytes) };
    }
    if (!signed) throw new BrokerageError("NO_SIGNED_COPY", "Ο πάροχος δεν επέστρεψε το υπογεγραμμένο έγγραφο.");
    await db.$transaction(async (tx) => {
      if (showing) {
        await tx.showing.update({ where: { id }, data: { status: "SIGNED", signedAt: now, signedPdfStorageKey: signed!.key, signedPdfChecksum: signed!.checksum } });
        await tx.showingParty.updateMany({ where: { showingId: id, signedAt: null, isSignatory: true }, data: { signedAt: now } });
        await tx.showingEvent.create({ data: { showingId: id, type: "SIGNED", summary: "Υπογράφηκε ηλεκτρονικά", data: { checksum: signed!.checksum }, actorName: providerName } });
      } else {
        await tx.mandateExtension.update({ where: { id }, data: { status: "SIGNED", signedAt: now, signedPdfStorageKey: signed!.key, signedPdfChecksum: signed!.checksum } });
        await tx.mandateEvent.create({ data: { mandateId: extension!.mandateId, type: "EXTENSION_SIGNED", summary: `Υπογράφηκε ηλεκτρονικά η παράταση ${number}`, data: { extensionId: id }, actorName: providerName } });
      }
      await audit(tx, `${PREFIX[kind]}_SIGNED`, { method: "PROVIDER", level: (showing ?? extension)!.signatureLevel, signedCopyChecksum: signed!.checksum, envelopeId });
    });
    return true;
  }

  if (showing && ["DECLINED", "EXPIRED"].includes(status)) {
    await db.$transaction(async (tx) => {
      await tx.showing.update({ where: { id }, data: status === "DECLINED" ? { status: "DECLINED", declinedAt: now } : { status: "EXPIRED", expiresAt: now } });
      await tx.showingEvent.create({ data: { showingId: id, type: status, summary: status === "DECLINED" ? "Απορρίφθηκε από τον υπογράφοντα" : "Έληξε ο σύνδεσμος υπογραφής", actorName: providerName } });
      await audit(tx, status === "DECLINED" ? "SHOWING_DECLINED" : "SHOWING_EXPIRED", { status });
    });
    return true;
  }
  return false;
}

export { documentKey };
