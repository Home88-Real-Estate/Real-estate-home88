/**
 * Building the issuance snapshot: everything a document prints, read on the
 * server from the canonical records at the moment of issue, then frozen.
 *
 * After issue the PDF is reproduced from the snapshot alone; the contact, the
 * property and the settings are never read again for that document.
 */

import {
  calculateDuration,
  calculateFee,
  type DocumentKind,
  type DocumentLanguage,
  type DocumentSnapshot,
  type FeeTerms,
  type SnapshotFee,
  type SnapshotParty,
  type SnapshotProperty,
} from "@home88/domain";
import type { Prisma } from "@home88/database";

import { decryptField } from "../../pii";
import { loadCompanyFacts } from "../company";
import { BrokerageError } from "../errors";
import { loadOwnerFacts } from "../owners";
import { snapshotProperty } from "../showings";
import type { Db } from "../types";

const num = (v: unknown) => (v == null ? null : Number(String(v)));
const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export type IssuanceSnapshot = {
  version: 1;
  /** Title used in the PDF header. */
  title: string;
  document: DocumentSnapshot;
  /** The approved wording after merge fields were filled in. */
  clauses: string;
  issuedAt: string;
};

export type Numbering = { number: string; issuedOn: string; verificationCode: string };

/** What a percentage fee is a percentage of, where it is known at issue time. */
export function feeBase(basis: string | null | undefined, property: { listingType: string; price: number | null; monthlyRent: number | null }): number | null {
  const price = property.listingType === "RENT" ? property.monthlyRent ?? property.price : property.price;
  switch (basis) {
    case "ASKING_PRICE":
      return property.listingType === "RENT" ? null : property.price;
    case "MONTHLY_RENT":
      return price;
    case "ANNUAL_RENT":
      return price == null ? null : price * 12;
    // The final price, or the value of the contract, does not exist yet: no amount is invented.
    default:
      return null;
  }
}

function snapshotFee(terms: FeeTerms & { currency: string }, amounts: SnapshotFee["amounts"]): SnapshotFee {
  return {
    payer: terms.payer ?? null,
    method: terms.method ?? null,
    basis: terms.basis ?? null,
    percentage: terms.percentage ?? null,
    fixedAmount: terms.fixedAmount ?? null,
    currency: terms.currency,
    vatTreatment: terms.vatTreatment ?? null,
    vatRate: terms.vatRate ?? null,
    paymentTrigger: terms.paymentTrigger ?? null,
    amounts: amounts ?? null,
    milestones: (terms.milestones ?? []).map((m) => ({ sequence: m.sequence, percentage: m.percentage ?? null, fixedAmount: m.fixedAmount ?? null, trigger: m.trigger ?? null })),
  };
}

type FeeColumns = {
  feePayer: unknown; feeMethod: unknown; feeBasis: unknown; feePercentage: unknown; feeFixedAmount: unknown; feeCurrency: string | null;
  vatTreatment: unknown; vatRate: unknown; paymentTrigger: unknown;
};
const termsOf = (row: FeeColumns, milestones: Array<{ sequence: number; percentage: unknown; fixedAmount: unknown; trigger: unknown }>): FeeTerms & { currency: string } => ({
  payer: row.feePayer as FeeTerms["payer"],
  method: row.feeMethod as FeeTerms["method"],
  basis: row.feeBasis as FeeTerms["basis"],
  percentage: num(row.feePercentage),
  fixedAmount: num(row.feeFixedAmount),
  currency: row.feeCurrency ?? "EUR",
  vatTreatment: row.vatTreatment as FeeTerms["vatTreatment"],
  vatRate: num(row.vatRate),
  paymentTrigger: row.paymentTrigger as FeeTerms["paymentTrigger"],
  milestones: milestones.map((m) => ({ sequence: m.sequence, percentage: num(m.percentage), fixedAmount: num(m.fixedAmount), trigger: m.trigger as string })),
});

// ---------------------------------------------------------------------------
// Showing
// ---------------------------------------------------------------------------

export async function buildShowingSnapshot(db: Db, showingId: string, numbering: Numbering, template: { version: number; checksum: string }, representativeName: string | null): Promise<DocumentSnapshot> {
  const s = await db.showing.findUnique({ where: { id: showingId }, include: { properties: { orderBy: { sortOrder: "asc" } }, parties: { orderBy: { sortOrder: "asc" } }, milestones: { orderBy: { sequence: "asc" } } } });
  if (!s) throw new BrokerageError("SHOWING_NOT_FOUND", "Η υπόδειξη δεν βρέθηκε.");
  const company = await loadCompanyFacts(db, s.language);
  const terms = termsOf(s, s.milestones);

  const properties: SnapshotProperty[] = s.properties.map((p) => {
    const price = num(p.priceSnapshot);
    const base = terms.method === "PERCENTAGE" ? (terms.basis === "ASKING_PRICE" || terms.basis === "MONTHLY_RENT" || terms.basis === "ANNUAL_RENT" ? feeBase(terms.basis, { listingType: p.transactionTypeSnapshot, price: p.transactionTypeSnapshot === "RENT" ? null : price, monthlyRent: p.transactionTypeSnapshot === "RENT" ? price : null }) : null) : null;
    const amounts = calculateFee(terms, base, company.configuredVatRatePct);
    return {
      code: p.propertyCodeSnapshot,
      address: p.addressSnapshot,
      description: p.descriptionSnapshot,
      transactionType: p.transactionTypeSnapshot,
      propertyType: p.propertyTypeSnapshot,
      areaSqm: num(p.areaSnapshot),
      price,
      currency: p.currencySnapshot,
      fee: amounts ? { net: amounts.net, vat: amounts.vat, gross: amounts.gross } : null,
    };
  });
  const overall = terms.method === "FIXED_AMOUNT" ? calculateFee(terms, null, company.configuredVatRatePct) : null;
  const parties: SnapshotParty[] = s.parties.map((p) => ({
    role: p.role,
    fullName: p.fullName,
    taxId: decryptField(p.taxIdEncrypted),
    taxOffice: decryptField(p.taxOfficeEncrypted),
    idNumber: decryptField(p.idNumberEncrypted),
    address: decryptField(p.addressEncrypted),
    phone: decryptField(p.phoneEncrypted),
    email: decryptField(p.emailEncrypted),
    representativeCapacity: p.representativeCapacity,
    authorityReference: p.authorityReference,
    isSignatory: p.isSignatory,
  }));

  return {
    kind: "SHOWING",
    language: s.language as DocumentLanguage,
    number: numbering.number,
    issuedOn: numbering.issuedOn,
    verificationCode: numbering.verificationCode,
    company: company.snapshot as DocumentSnapshot["company"],
    representativeName,
    parties,
    properties,
    fee: snapshotFee(terms, overall),
    dualRepresentationConsent: s.dualRepresentationConsent,
    template,
  };
}

// ---------------------------------------------------------------------------
// Mandate
// ---------------------------------------------------------------------------

export async function buildMandateSnapshot(db: Db, mandateId: string, numbering: Numbering, template: { version: number; checksum: string }, representativeName: string | null): Promise<DocumentSnapshot> {
  const m = await db.mandate.findUnique({ where: { id: mandateId }, include: { parties: { orderBy: { sortOrder: "asc" } }, milestones: { orderBy: { sequence: "asc" } }, property: true } });
  if (!m) throw new BrokerageError("MANDATE_NOT_FOUND", "Η εντολή δεν βρέθηκε.");
  if (m.type !== "SIMPLE_ASSIGNMENT" && m.type !== "EXCLUSIVE_ASSIGNMENT") throw new BrokerageError("MANDATE_TYPE_UNSUPPORTED", "Το έγγραφο εκδίδεται μόνο για απλή ή αποκλειστική ανάθεση.");
  if (!m.property) throw new BrokerageError("PROPERTY_MISSING", "Δεν έχει οριστεί ακίνητο.");
  const company = await loadCompanyFacts(db, m.locale);
  const terms = termsOf(m, m.milestones);
  const p = m.property;
  const snap = snapshotProperty(p);
  const price = snap.columns.priceSnapshot;
  const base = feeBase(terms.basis, { listingType: p.listingType, price: num(p.price), monthlyRent: num(p.monthlyRent) });
  const amounts = calculateFee(terms, terms.method === "PERCENTAGE" ? base : null, company.configuredVatRatePct);

  // Capacity and share come from the property's owners, matched through the contact.
  const owners = await loadOwnerFacts(db, p.id);
  const byContact = new Map(owners.map((o) => [o.contactId, o]));
  const parties: SnapshotParty[] = m.parties.map((x) => {
    const o = x.contactId ? byContact.get(x.contactId) : undefined;
    const acts = o && (o.representativeCapacity || ["LEGAL_REPRESENTATIVE", "ATTORNEY_IN_FACT", "COMPANY_REPRESENTATIVE"].includes(String(o.capacity)));
    return {
      role: x.role,
      capacity: o ? String(o.capacity) : null,
      fullName: x.fullName,
      taxId: decryptField(x.taxIdEncrypted),
      idNumber: decryptField(x.idNumberEncrypted),
      address: decryptField(x.addressEncrypted),
      phone: decryptField(x.phoneEncrypted),
      email: decryptField(x.emailEncrypted),
      sharePercent: o?.ownershipPercentage ?? null,
      representativeCapacity: acts ? String(o!.representativeCapacity ?? o!.capacity) : null,
      isSignatory: true,
    };
  });
  // Authority references live on the owner rows; fetch them separately so the text can name them.
  const authority = await db.propertyOwner.findMany({ where: { propertyId: p.id, authorityReference: { not: null } }, select: { contactId: true, authorityReference: true } });
  const authorityBy = new Map(authority.map((a) => [a.contactId, a.authorityReference]));
  m.parties.forEach((x, i) => {
    const ref = x.contactId ? authorityBy.get(x.contactId) : null;
    if (ref) parties[i]!.authorityReference = ref;
  });

  const startDate = isoDate(m.startsAt);
  const endDate = isoDate(m.endsAt);
  const duration = m.startsAt && m.endsAt ? calculateDuration(m.startsAt, m.endsAt) : null;
  const rawExceptions = (m.terms as { exceptions?: unknown } | null)?.exceptions;
  const exceptions = Array.isArray(rawExceptions) ? rawExceptions.filter((e): e is string => typeof e === "string" && e.trim() !== "").map((e) => e.trim()) : [];

  const property: SnapshotProperty = {
    code: p.reference,
    address: snap.columns.addressSnapshot,
    description: snap.columns.descriptionSnapshot,
    transactionType: p.listingType,
    propertyType: p.propertyType,
    areaSqm: num(p.area),
    price,
    currency: "EUR",
  };
  return {
    kind: m.type,
    language: m.locale as DocumentLanguage,
    number: numbering.number,
    issuedOn: numbering.issuedOn,
    verificationCode: numbering.verificationCode,
    company: company.snapshot as DocumentSnapshot["company"],
    representativeName,
    parties,
    properties: [property],
    fee: snapshotFee(terms, amounts),
    term: { startDate, endDate: m.type === "EXCLUSIVE_ASSIGNMENT" || m.durationType === "FIXED_TERM" ? endDate : null, durationType: m.type === "EXCLUSIVE_ASSIGNMENT" ? "FIXED_TERM" : m.durationType, duration, exceptions: m.type === "EXCLUSIVE_ASSIGNMENT" ? exceptions : [] },
    permissions: {
      photoPermission: m.photoPermission, videoPermission: m.videoPermission, floorplanPermission: m.floorplanPermission, signboardPermission: m.signboardPermission,
      portalPublicationPermission: m.portalPublicationPermission, socialMediaPermission: m.socialMediaPermission, cooperatingBrokerPermission: m.cooperatingBrokerPermission,
    },
    defects: { known: m.knownDefects, description: m.defectsDescription, confirmed: m.defectsDisclosureConfirmed },
    cooperation: { brokerCooperationAllowed: m.brokerCooperationAllowed },
    dualRepresentationConsent: m.dualRepresentationConsent,
    specialTerms: m.specialTerms,
    template,
  };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export async function buildExtensionSnapshot(db: Db, extensionId: string, numbering: Numbering, template: { version: number; checksum: string }, representativeName: string | null, decryptSnapshot: (enc: string) => IssuanceSnapshot | null): Promise<DocumentSnapshot> {
  const x = await db.mandateExtension.findUnique({ where: { id: extensionId }, include: { mandate: { include: { parties: { orderBy: { sortOrder: "asc" } }, property: true } } } });
  if (!x) throw new BrokerageError("EXTENSION_NOT_FOUND", "Η παράταση δεν βρέθηκε.");
  const m = x.mandate;
  if (m.type !== "SIMPLE_ASSIGNMENT" && m.type !== "EXCLUSIVE_ASSIGNMENT") throw new BrokerageError("MANDATE_TYPE_UNSUPPORTED", "Παράταση ορίζεται για απλή ή αποκλειστική ανάθεση.");
  const company = await loadCompanyFacts(db, m.locale);

  // The addendum describes the mandate as it was issued, when its snapshot exists.
  const original = m.issuanceSnapshotEncrypted ? decryptSnapshot(m.issuanceSnapshotEncrypted) : null;
  let parties: SnapshotParty[];
  let properties: SnapshotProperty[];
  if (original) {
    parties = original.document.parties;
    properties = original.document.properties;
  } else {
    parties = m.parties.map((p) => ({ role: p.role, fullName: p.fullName, taxId: decryptField(p.taxIdEncrypted), idNumber: decryptField(p.idNumberEncrypted), address: decryptField(p.addressEncrypted), phone: decryptField(p.phoneEncrypted), email: decryptField(p.emailEncrypted), isSignatory: true }));
    properties = m.property ? [{ code: m.property.reference, address: snapshotProperty(m.property).columns.addressSnapshot, description: null, transactionType: m.property.listingType, propertyType: m.property.propertyType, currency: "EUR" }] : [];
  }
  return {
    kind: "MANDATE_EXTENSION",
    language: m.locale as DocumentLanguage,
    number: numbering.number,
    issuedOn: numbering.issuedOn,
    verificationCode: numbering.verificationCode,
    company: company.snapshot as DocumentSnapshot["company"],
    representativeName,
    parties,
    properties,
    fee: null,
    extension: {
      mandateNumber: m.number ?? m.reference,
      mandateType: m.type,
      startDate: isoDate(m.startsAt),
      previousEndDate: x.previousEndDate.toISOString().slice(0, 10),
      newEndDate: x.newEndDate.toISOString().slice(0, 10),
      reason: x.extensionReason,
    },
    template,
  };
}

export type { Prisma, DocumentKind };
