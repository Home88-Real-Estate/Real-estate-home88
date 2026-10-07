/**
 * Mandates, database side: exclusive conflicts and overrides, extensions, and
 * the validation input built from the stored mandate. Complements the existing
 * routes/mandates.ts without changing it.
 */

import {
  calculateFee,
  effectiveEndDate,
  validateExclusiveConflict,
  validateMandate,
  type ConflictCandidate,
  type DocumentCompletenessResult,
  type FeeTerms,
  type MandateValidationInput,
} from "@home88/domain";
import type { Prisma } from "@home88/database";

import { roleAtLeast } from "../../plugins/auth";
import { loadCompanyFacts, loadTemplateCheck } from "./company";
import { BrokerageError } from "./errors";
import { loadOwnerFacts } from "./owners";
import type { Actor, Db } from "./types";

const num = (v: unknown) => (v == null ? null : Number(String(v)));
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const LIVE = ["ISSUED", "SENT", "VIEWED", "SIGNED"];

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/** Every exclusive mandate on the property, shaped for validateExclusiveConflict. */
export async function loadConflictCandidates(db: Db, propertyId: string): Promise<ConflictCandidate[]> {
  const rows = await db.mandate.findMany({
    where: { propertyId, type: "EXCLUSIVE_ASSIGNMENT" },
    include: { extensions: { select: { status: true, newEndDate: true } }, supersededBy: { select: { status: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    label: m.number ?? m.reference,
    type: m.type,
    status: m.status,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    extensions: m.extensions,
    supersededByLive: m.supersededBy.some((s) => LIVE.includes(s.status)),
  }));
}

/**
 * Whether a mandate's period collides with another exclusive mandate on the
 * same property, taking effective end dates (extensions), superseded mandates
 * and recorded manager overrides into account.
 */
export async function checkExclusiveConflict(db: Db, mandateId: string, now = new Date()) {
  const m = await db.mandate.findUnique({ where: { id: mandateId }, include: { conflictOverrides: true } });
  if (!m) throw new BrokerageError("MANDATE_NOT_FOUND", "Η εντολή δεν βρέθηκε.");
  if (!m.propertyId) return { blockingIssues: [], warnings: [] };
  const others = await loadConflictCandidates(db, m.propertyId);
  // A mandate this one replaces does not compete with it.
  const candidates = others.filter((o) => o.id !== m.supersedesMandateId);
  return validateExclusiveConflict(m, candidates, { overrides: m.conflictOverrides.map((o) => ({ conflictingMandateId: o.conflictingMandateId, reason: o.reason })), now });
}

/**
 * A manager's decision to allow an overlapping exclusive mandate. Needs the
 * MANAGER role or above (decided here, on the server), a reason, and a real
 * conflict to override. The record is append-only.
 */
export async function recordConflictOverride(db: Db, input: { mandateId: string; conflictingMandateId: string; reason: string; approver: { id: string; role: string } }) {
  if (!roleAtLeast(input.approver.role, "MANAGER")) {
    throw new BrokerageError("FORBIDDEN", "Μόνο προϊστάμενος μπορεί να εγκρίνει σύγκρουση αποκλειστικών εντολών.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new BrokerageError("REASON_REQUIRED", "Η έγκριση απαιτεί αιτιολογία.");
  if (input.mandateId === input.conflictingMandateId) throw new BrokerageError("INVALID_OVERRIDE", "Μια εντολή δεν συγκρούεται με τον εαυτό της.");

  const m = await db.mandate.findUnique({ where: { id: input.mandateId } });
  if (!m?.propertyId) throw new BrokerageError("MANDATE_NOT_FOUND", "Η εντολή δεν βρέθηκε.");
  const others = await loadConflictCandidates(db, m.propertyId);
  const real = validateExclusiveConflict(m, others.filter((o) => o.id === input.conflictingMandateId));
  if (real.blockingIssues.length === 0) throw new BrokerageError("NO_CONFLICT", "Δεν υπάρχει σύγκρουση για έγκριση.");

  return db.mandateConflictOverride.create({
    data: { mandateId: input.mandateId, conflictingMandateId: input.conflictingMandateId, reason, approvedById: input.approver.id },
  });
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

/** The end date that counts today: the mandate's own, or its latest issued/signed extension. */
export async function currentEndDate(db: Db, mandateId: string): Promise<Date | null> {
  const m = await db.mandate.findUnique({ where: { id: mandateId }, include: { extensions: { select: { status: true, newEndDate: true } } } });
  if (!m) throw new BrokerageError("MANDATE_NOT_FOUND", "Η εντολή δεν βρέθηκε.");
  return effectiveEndDate(m.endsAt, m.extensions);
}

/**
 * Starts a prolongation. The mandate's own end date is never touched: the
 * extension records the end it replaces (the current effective one) and the new
 * end. Only a signed, in-force fixed-term mandate can be extended, one at a time,
 * and not into another exclusive mandate's period.
 */
export async function createMandateExtension(db: Db, input: { mandateId: string; newEndDate: Date | string; reason?: string | null; actor: Actor }) {
  const m = await db.mandate.findUnique({ where: { id: input.mandateId }, include: { extensions: true } });
  if (!m) throw new BrokerageError("MANDATE_NOT_FOUND", "Η εντολή δεν βρέθηκε.");
  if (m.status !== "SIGNED") throw new BrokerageError("MANDATE_NOT_SIGNED", "Παράταση ορίζεται μόνο σε υπογεγραμμένη εντολή.");
  if (!m.endsAt) throw new BrokerageError("MANDATE_HAS_NO_END", "Η εντολή αορίστου χρόνου δεν έχει λήξη για να παραταθεί.");
  if (m.extensions.some((x) => x.status === "DRAFT" || x.status === "ISSUED")) {
    throw new BrokerageError("EXTENSION_PENDING", "Υπάρχει ήδη εκκρεμής παράταση.");
  }
  const previous = effectiveEndDate(m.endsAt, m.extensions)!;
  const next = new Date(input.newEndDate);
  if (Number.isNaN(next.getTime())) throw new BrokerageError("INVALID_DATE", "Μη έγκυρη ημερομηνία.");
  if (day(next) <= day(previous)) throw new BrokerageError("EXTENSION_NOT_LATER", "Η νέα λήξη πρέπει να είναι μετά την τρέχουσα.");

  if (m.type === "EXCLUSIVE_ASSIGNMENT" && m.propertyId) {
    const nextDay = new Date(previous.getTime() + 86_400_000);
    const others = (await loadConflictCandidates(db, m.propertyId)).filter((o) => o.id !== m.id);
    const clash = validateExclusiveConflict({ id: m.id, type: m.type, startsAt: nextDay, endsAt: next }, others);
    if (clash.blockingIssues.length > 0) throw new BrokerageError("EXCLUSIVE_CONFLICT", clash.blockingIssues[0]!.message);

    const settings = await db.mandateSettings.findUnique({ where: { id: "default" } });
    if (settings?.maxExclusiveMonths && m.startsAt) {
      const months = (next.getUTCFullYear() - m.startsAt.getUTCFullYear()) * 12 + (next.getUTCMonth() - m.startsAt.getUTCMonth());
      if (months > settings.maxExclusiveMonths) throw new BrokerageError("EXCLUSIVE_TOO_LONG", `Η συνολική διάρκεια ξεπερνά το επιτρεπόμενο μέγιστο (${settings.maxExclusiveMonths} μήνες).`);
    }
  }

  const extension = await db.mandateExtension.create({
    data: { mandateId: m.id, previousEndDate: previous, newEndDate: next, extensionReason: input.reason?.trim() || null, createdByUserId: input.actor.id },
  });
  await db.mandateEvent.create({
    data: { mandateId: m.id, type: "EXTENSION_CREATED", summary: `Παράταση έως ${day(next)}`, data: { extensionId: extension.id, previousEndDate: day(previous), newEndDate: day(next) }, actorId: input.actor.id, actorName: input.actor.name },
  });
  return extension;
}

/** DRAFT → ISSUED. The wording as issued is kept on the extension. */
export async function issueMandateExtension(db: Db, extensionId: string, input: { text: string; templateVersionId?: string | null; actor: Actor; now?: Date }) {
  const text = input.text.trim();
  if (!text) throw new BrokerageError("TEXT_REQUIRED", "Λείπει το κείμενο της παράτασης.");
  const x = await db.mandateExtension.findUnique({ where: { id: extensionId } });
  if (!x) throw new BrokerageError("EXTENSION_NOT_FOUND", "Η παράταση δεν βρέθηκε.");
  if (x.status !== "DRAFT") throw new BrokerageError("INVALID_TRANSITION", "Εκδίδεται μόνο πρόχειρη παράταση.");
  const updated = await db.mandateExtension.update({
    where: { id: extensionId },
    data: { status: "ISSUED", issuedAt: input.now ?? new Date(), extensionTextSnapshot: text, templateVersionId: input.templateVersionId ?? null },
  });
  await db.mandateEvent.create({ data: { mandateId: x.mandateId, type: "EXTENSION_ISSUED", summary: `Εκδόθηκε παράταση έως ${day(x.newEndDate)}`, data: { extensionId }, actorId: input.actor.id, actorName: input.actor.name } });
  return updated;
}

/** ISSUED → SIGNED (the new end now counts) or CANCELLED. */
export async function resolveMandateExtension(db: Db, extensionId: string, to: "SIGNED" | "CANCELLED", input: { actor: Actor; signedPdfStorageKey?: string | null; signedPdfChecksum?: string | null; now?: Date }) {
  const x = await db.mandateExtension.findUnique({ where: { id: extensionId } });
  if (!x) throw new BrokerageError("EXTENSION_NOT_FOUND", "Η παράταση δεν βρέθηκε.");
  const allowed = (x.status === "ISSUED" && (to === "SIGNED" || to === "CANCELLED")) || (x.status === "DRAFT" && to === "CANCELLED");
  if (!allowed) throw new BrokerageError("INVALID_TRANSITION", "Μη επιτρεπτή αλλαγή κατάστασης παράτασης.");
  const updated = await db.mandateExtension.update({
    where: { id: extensionId },
    data: to === "SIGNED" ? { status: "SIGNED", signedAt: input.now ?? new Date(), signedPdfStorageKey: input.signedPdfStorageKey ?? null, signedPdfChecksum: input.signedPdfChecksum ?? null } : { status: "CANCELLED" },
  });
  await db.mandateEvent.create({ data: { mandateId: x.mandateId, type: to === "SIGNED" ? "EXTENSION_SIGNED" : "EXTENSION_CANCELLED", summary: to === "SIGNED" ? `Υπογράφηκε παράταση έως ${day(x.newEndDate)}` : "Ακυρώθηκε παράταση", data: { extensionId }, actorId: input.actor.id, actorName: input.actor.name } });
  return updated;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export async function buildMandateValidationInput(db: Db, mandateId: string, now = new Date(), opts: { blockAnomalies?: boolean } = {}): Promise<MandateValidationInput> {
  const m = await db.mandate.findUnique({ where: { id: mandateId }, include: { parties: { orderBy: { sortOrder: "asc" } }, milestones: { orderBy: { sequence: "asc" } }, property: true } });
  if (!m) throw new BrokerageError("MANDATE_NOT_FOUND", "Η εντολή δεν βρέθηκε.");
  const [company, tpl, settings, owners, conflicts] = await Promise.all([
    loadCompanyFacts(db, m.locale),
    loadTemplateCheck(db, m.type, m.locale),
    db.mandateSettings.findUnique({ where: { id: "default" } }),
    m.propertyId ? loadOwnerFacts(db, m.propertyId) : Promise.resolve(undefined),
    checkExclusiveConflict(db, mandateId, now),
  ]);

  const fee: FeeTerms = {
    payer: m.feePayer,
    method: m.feeMethod,
    basis: m.feeBasis,
    percentage: num(m.feePercentage),
    fixedAmount: num(m.feeFixedAmount),
    currency: m.feeCurrency,
    vatTreatment: m.vatTreatment,
    vatRate: num(m.vatRate),
    paymentTrigger: m.paymentTrigger,
    anomalyOverrideReason: m.feeAnomalyOverrideReason,
    milestones: m.milestones.map((x) => ({ sequence: x.sequence, percentage: num(x.percentage), fixedAmount: num(x.fixedAmount), trigger: x.trigger })),
  };
  const p = m.property;
  const price = p ? (p.listingType === "RENT" ? num(p.monthlyRent) ?? num(p.price) : num(p.price)) : null;

  return {
    type: m.type,
    language: m.locale,
    durationType: m.durationType,
    startDate: m.startsAt,
    endDate: m.endsAt,
    hasProperty: p != null,
    property: p ? { propertyId: p.id, code: p.reference, hasAddress: !!p.address?.trim(), price, transactionType: p.listingType, offMarket: ["SOLD", "RENTED", "INACTIVE", "ARCHIVED", "DELETED"].includes(p.status) } : null,
    parties: m.parties.map((x) => ({
      fullName: x.fullName,
      role: x.role,
      isSignatory: true,
      hasTaxId: x.taxIdEncrypted != null,
      hasIdNumber: x.idNumberEncrypted != null,
      hasAddress: x.addressEncrypted != null,
      hasPhone: x.phoneEncrypted != null,
      hasEmail: x.emailEncrypted != null,
    })),
    owners,
    fee,
    feeContext: { configuredVatRatePct: company.configuredVatRatePct, blockAnomalies: opts.blockAnomalies ?? false },
    knownDefects: m.knownDefects,
    defectsDisclosureConfirmed: m.defectsDisclosureConfirmed,
    defectsDescription: m.defectsDescription,
    permissions: {
      photoPermission: m.photoPermission,
      videoPermission: m.videoPermission,
      floorplanPermission: m.floorplanPermission,
      signboardPermission: m.signboardPermission,
      portalPublicationPermission: m.portalPublicationPermission,
      socialMediaPermission: m.socialMediaPermission,
      cooperatingBrokerPermission: m.cooperatingBrokerPermission,
      brokerCooperationAllowed: m.brokerCooperationAllowed,
    },
    template: tpl.check,
    companyMissing: company.missing,
    conflicts,
    maxExclusiveMonths: settings?.maxExclusiveMonths ?? null,
    now,
  };
}

export async function evaluateMandate(db: Db, mandateId: string, now = new Date(), opts: { blockAnomalies?: boolean } = {}): Promise<DocumentCompletenessResult> {
  return validateMandate(await buildMandateValidationInput(db, mandateId, now, opts));
}

/** The fee as it will be printed, from the stored terms and the property's current price. Null while undecided. */
export async function calculateMandateFee(db: Db, mandateId: string) {
  const input = await buildMandateValidationInput(db, mandateId);
  const base = input.fee.method === "PERCENTAGE" ? input.property?.price ?? null : null;
  return calculateFee(input.fee, base, input.feeContext?.configuredVatRatePct ?? null);
}

/** Stores the latest result while the mandate is still a draft (an issued one is frozen). */
export async function refreshMandateCompleteness(db: Db, mandateId: string): Promise<DocumentCompletenessResult> {
  const result = await evaluateMandate(db, mandateId);
  const m = await db.mandate.findUnique({ where: { id: mandateId }, select: { status: true } });
  if (m?.status === "DRAFT") {
    await db.mandate.update({ where: { id: mandateId }, data: { completenessResult: result as unknown as Prisma.InputJsonValue, completenessCheckedAt: new Date() } });
  }
  return result;
}
