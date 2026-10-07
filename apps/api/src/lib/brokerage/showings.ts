/**
 * Showings (Υπόδειξη Ακινήτου), database side.
 *
 * Everything a document will print is read here, on the server, from the
 * canonical contact and property records, and copied into the showing when it
 * is issued. Nothing the browser sends is trusted for those values.
 */

import {
  calculateFee,
  canMoveShowing,
  formatShowingNumber,
  SHOWING_TEMPLATE_TYPE,
  validateShowing,
  type DocumentCompletenessResult,
  type FeeTerms,
  type ShowingValidationInput,
} from "@home88/domain";
import type { Prisma } from "@home88/database";

import { decryptField, encryptField, hasEncryptionKey } from "../pii";
import { loadCompanyFacts, loadTemplateCheck } from "./company";
import { BrokerageError, DocumentBlockedError } from "./errors";
import type { Actor, Db } from "./types";

const OFF_MARKET = new Set(["SOLD", "RENTED", "INACTIVE", "ARCHIVED", "DELETED"]);

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/**
 * Next ΥΠ-YYYY-NNNNNN. The counter row is incremented by one INSERT … ON
 * CONFLICT DO UPDATE inside the caller's transaction: concurrent callers wait
 * for each other, a rolled-back transaction gives its number back, and the
 * unique index on showings.number is a second line of defence.
 */
export async function allocateShowingNumber(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const scope = `showing:${year}`;
  const counter = await tx.referenceCounter.upsert({
    where: { scope },
    create: { scope, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return formatShowingNumber(year, counter.nextValue - 1);
}

// ---------------------------------------------------------------------------
// Property snapshot
// ---------------------------------------------------------------------------

type PropertyRow = Prisma.PropertyGetPayload<Record<string, never>>;

const num = (v: unknown) => (v == null ? null : Number(String(v)));

/** What a showing may keep about a property. No owner, agent or internal notes. */
export function snapshotProperty(p: PropertyRow, at = new Date()) {
  const address = [p.address, p.neighborhood, p.areaName, p.city, p.postalCode].filter((x) => x && String(x).trim()).join(", ") || null;
  const price = p.listingType === "RENT" ? num(p.monthlyRent) ?? num(p.price) : num(p.price);
  return {
    columns: {
      propertyCodeSnapshot: p.reference,
      addressSnapshot: address,
      descriptionSnapshot: p.descriptionEl || null,
      transactionTypeSnapshot: p.listingType as string,
      propertyTypeSnapshot: p.propertyType as string,
      areaSnapshot: num(p.area),
      priceSnapshot: price,
      currencySnapshot: "EUR",
    },
    document: {
      reference: p.reference,
      listingType: p.listingType,
      propertyType: p.propertyType,
      status: p.status,
      titleEl: p.titleEl,
      titleEn: p.titleEn,
      descriptionEl: p.descriptionEl,
      descriptionEn: p.descriptionEn,
      region: p.region,
      city: p.city,
      areaName: p.areaName,
      neighborhood: p.neighborhood,
      address: p.address,
      postalCode: p.postalCode,
      area: num(p.area),
      plotArea: num(p.plotArea),
      floor: p.floor,
      totalFloors: p.totalFloors,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      yearBuilt: p.yearBuilt,
      energyClass: p.energyClass,
      price: num(p.price),
      monthlyRent: num(p.monthlyRent),
      priceOnRequest: p.priceOnRequest,
      capturedAt: at.toISOString(),
    } satisfies Prisma.InputJsonObject,
  };
}

async function requireEditable(db: Db, showingId: string) {
  const showing = await db.showing.findUnique({ where: { id: showingId }, select: { id: true, status: true } });
  if (!showing) throw new BrokerageError("SHOWING_NOT_FOUND", "Η υπόδειξη δεν βρέθηκε.");
  if (showing.status !== "DRAFT" && showing.status !== "READY_FOR_ISSUANCE") {
    throw new BrokerageError("SHOWING_LOCKED", "Η υπόδειξη έχει εκδοθεί και δεν αλλάζει.");
  }
  return showing;
}

/** Adds a property to a draft showing, copying its details from the canonical property record. */
export async function addPropertyToShowing(db: Db, showingId: string, propertyId: string) {
  await requireEditable(db, showingId);
  const property = await db.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new BrokerageError("PROPERTY_NOT_FOUND", "Το ακίνητο δεν βρέθηκε.");
  const last = await db.showingProperty.aggregate({ where: { showingId }, _max: { sortOrder: true } });
  const snap = snapshotProperty(property);
  return db.showingProperty.create({
    data: { showingId, propertyId, sortOrder: (last._max.sortOrder ?? -1) + 1, ...snap.columns, propertySnapshot: snap.document },
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const feeOf = (s: { feePayer: unknown; feeMethod: unknown; feeBasis: unknown; feePercentage: unknown; feeFixedAmount: unknown; feeCurrency: unknown; vatTreatment: unknown; vatRate: unknown; paymentTrigger: unknown; feeAnomalyOverrideReason: string | null }, milestones: Array<{ sequence: number; percentage: unknown; fixedAmount: unknown; trigger: unknown }>): FeeTerms => ({
  payer: s.feePayer as FeeTerms["payer"],
  method: s.feeMethod as FeeTerms["method"],
  basis: s.feeBasis as FeeTerms["basis"],
  percentage: num(s.feePercentage),
  fixedAmount: num(s.feeFixedAmount),
  currency: s.feeCurrency as string | null,
  vatTreatment: s.vatTreatment as FeeTerms["vatTreatment"],
  vatRate: num(s.vatRate),
  paymentTrigger: s.paymentTrigger as FeeTerms["paymentTrigger"],
  anomalyOverrideReason: s.feeAnomalyOverrideReason,
  milestones: milestones.map((m) => ({ sequence: m.sequence, percentage: num(m.percentage), fixedAmount: num(m.fixedAmount), trigger: m.trigger as string })),
});

export const showingInclude = {
  properties: { orderBy: { sortOrder: "asc" as const } },
  parties: { orderBy: { sortOrder: "asc" as const } },
  milestones: { orderBy: { sequence: "asc" as const } },
} satisfies Prisma.ShowingInclude;

export async function buildShowingValidationInput(db: Db, showingId: string, opts: { blockAnomalies?: boolean } = {}): Promise<{ input: ShowingValidationInput; templateVersionId: string | null; companySnapshot: Record<string, string | null> }> {
  const showing = await db.showing.findUnique({ where: { id: showingId }, include: showingInclude });
  if (!showing) throw new BrokerageError("SHOWING_NOT_FOUND", "Η υπόδειξη δεν βρέθηκε.");

  const [company, tpl] = await Promise.all([loadCompanyFacts(db, showing.language), loadTemplateCheck(db, SHOWING_TEMPLATE_TYPE, showing.language)]);

  const propertyIds = showing.properties.map((p) => p.propertyId).filter((x): x is string => !!x);
  const current = propertyIds.length ? await db.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true, status: true } }) : [];
  const status = new Map(current.map((p) => [p.id, p.status as string]));

  const input: ShowingValidationInput = {
    language: showing.language,
    parties: showing.parties.map((p) => ({
      fullName: p.fullName,
      role: p.role,
      isSignatory: p.isSignatory,
      // Presence only: the validator never needs the values.
      hasTaxId: p.taxIdEncrypted != null,
      hasIdNumber: p.idNumberEncrypted != null,
      hasTaxOffice: p.taxOfficeEncrypted != null,
      hasAddress: p.addressEncrypted != null,
      hasPhone: p.phoneEncrypted != null,
      hasEmail: p.emailEncrypted != null,
      identityVerified: p.identityVerifiedAt != null,
      representativeCapacity: p.representativeCapacity,
      hasAuthority: p.authorityReference != null && p.authorityReference.trim() !== "",
    })),
    properties: showing.properties.map((p) => ({
      propertyId: p.propertyId,
      code: p.propertyCodeSnapshot,
      hasSnapshot: p.propertySnapshot != null && typeof p.propertySnapshot === "object" && Object.keys(p.propertySnapshot as object).length > 0,
      hasAddress: !!p.addressSnapshot?.trim(),
      price: num(p.priceSnapshot),
      transactionType: p.transactionTypeSnapshot,
      offMarket: p.propertyId ? OFF_MARKET.has(status.get(p.propertyId) ?? "") : false,
    })),
    fee: feeOf(showing, showing.milestones),
    feeContext: { configuredVatRatePct: company.configuredVatRatePct, blockAnomalies: opts.blockAnomalies ?? false },
    dualRepresentationConsent: showing.dualRepresentationConsent,
    template: tpl.check,
    companyMissing: company.missing,
    hasResponsibleUser: showing.responsibleUserId != null,
  };
  return { input, templateVersionId: tpl.version?.id ?? null, companySnapshot: company.snapshot };
}

export async function evaluateShowing(db: Db, showingId: string, opts: { blockAnomalies?: boolean } = {}): Promise<DocumentCompletenessResult> {
  return validateShowing((await buildShowingValidationInput(db, showingId, opts)).input);
}

/** Stores the latest result on a showing, so a screen can show what is still missing. */
export async function refreshShowingCompleteness(db: Db, showingId: string): Promise<DocumentCompletenessResult> {
  const result = await evaluateShowing(db, showingId);
  const showing = await db.showing.findUnique({ where: { id: showingId }, select: { status: true } });
  if (showing && (showing.status === "DRAFT" || showing.status === "READY_FOR_ISSUANCE")) {
    await db.showing.update({ where: { id: showingId }, data: { completenessResult: result as unknown as Prisma.InputJsonValue, completenessCheckedAt: new Date() } });
  }
  return result;
}

export async function recordShowingEvent(db: Db, showingId: string, type: string, summary: string, actor: Actor | null, data?: Prisma.InputJsonValue) {
  await db.showingEvent.create({ data: { showingId, type, summary, data, actorId: actor?.id ?? null, actorName: actor?.name ?? null } });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** DRAFT → READY_FOR_ISSUANCE: only when nothing blocks issuing. */
export async function markShowingReady(db: Db, showingId: string, actor: Actor) {
  const showing = await db.showing.findUnique({ where: { id: showingId }, select: { status: true } });
  if (!showing) throw new BrokerageError("SHOWING_NOT_FOUND", "Η υπόδειξη δεν βρέθηκε.");
  if (!canMoveShowing(showing.status, "READY_FOR_ISSUANCE")) throw new BrokerageError("INVALID_TRANSITION", "Η υπόδειξη δεν μπορεί να γίνει «έτοιμη» από την τρέχουσα κατάσταση.");
  const result = await evaluateShowing(db, showingId);
  if (result.status === "BLOCKED") throw new DocumentBlockedError(result);
  await db.showing.update({
    where: { id: showingId },
    data: { status: "READY_FOR_ISSUANCE", completenessResult: result as unknown as Prisma.InputJsonValue, completenessCheckedAt: new Date() },
  });
  await recordShowingEvent(db, showingId, "READY", "Η υπόδειξη είναι έτοιμη για έκδοση", actor);
  return result;
}
