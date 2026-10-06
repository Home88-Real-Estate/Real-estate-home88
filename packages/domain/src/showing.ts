/**
 * Showings (Υπόδειξη Ακινήτου): the legal record of an introduction of one or
 * more properties to a client. A Viewing is the appointment; a Showing is the
 * document, with its own number, lifecycle and frozen snapshots.
 */

import {
  mergeCompleteness,
  validateCompanyFacts,
  validateParties,
  validateTemplateCheck,
  type DocumentCompletenessResult,
  type PartyFacts,
  type DocumentPropertyFacts,
  type TemplateCheck,
  type ValidationIssue,
} from "./document-validation";
import { validateCommission, type FeeContext, type FeeTerms } from "./fees";

export const SHOWING_TEMPLATE_TYPE = "SHOWING";

export const SHOWING_STATUSES = ["DRAFT", "READY_FOR_ISSUANCE", "ISSUED", "SENT", "VIEWED", "SIGNED", "DECLINED", "EXPIRED", "CANCELLED"] as const;
export type ShowingStatus = (typeof SHOWING_STATUSES)[number];

export const SHOWING_PARTY_ROLES = ["BUYER", "TENANT", "JOINT_BUYER", "SPOUSE", "COMPANY_REPRESENTATIVE", "ATTORNEY_IN_FACT", "AUTHORIZED_REPRESENTATIVE", "OTHER"] as const;
export type ShowingPartyRole = (typeof SHOWING_PARTY_ROLES)[number];

/** Same paths the database trigger allows. */
const NEXT: Record<ShowingStatus, ShowingStatus[]> = {
  DRAFT: ["READY_FOR_ISSUANCE", "CANCELLED"],
  READY_FOR_ISSUANCE: ["DRAFT", "ISSUED", "CANCELLED"],
  ISSUED: ["SENT", "SIGNED", "CANCELLED"],
  SENT: ["VIEWED", "SIGNED", "DECLINED", "EXPIRED", "CANCELLED"],
  VIEWED: ["SIGNED", "DECLINED", "EXPIRED", "CANCELLED"],
  SIGNED: [],
  DECLINED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canMoveShowing(from: string, to: string): boolean {
  return (NEXT[from as ShowingStatus] ?? []).includes(to as ShowingStatus);
}

/** Editable while it is still a draft; frozen from the moment it is issued. */
export function isShowingEditable(status: string): boolean {
  return status === "DRAFT" || status === "READY_FOR_ISSUANCE";
}

export const SHOWING_STATUS_LABELS: Record<ShowingStatus, string> = {
  DRAFT: "Πρόχειρη",
  READY_FOR_ISSUANCE: "Έτοιμη για έκδοση",
  ISSUED: "Εκδόθηκε",
  SENT: "Στάλθηκε",
  VIEWED: "Ανοίχτηκε",
  SIGNED: "Υπογράφηκε",
  DECLINED: "Απορρίφθηκε",
  EXPIRED: "Έληξε",
  CANCELLED: "Ακυρώθηκε",
};

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

export const SHOWING_NUMBER_PREFIX = "ΥΠ";
export const SHOWING_NUMBER_PATTERN = /^ΥΠ-(\d{4})-(\d{6})$/;

/** ΥΠ-2026-000251. The sequence restarts each year. */
export function formatShowingNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new RangeError("invalid showing year");
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999_999) throw new RangeError("invalid showing sequence");
  return `${SHOWING_NUMBER_PREFIX}-${year}-${String(sequence).padStart(6, "0")}`;
}

export function parseShowingNumber(value: string): { year: number; sequence: number } | null {
  const m = SHOWING_NUMBER_PATTERN.exec(value);
  return m ? { year: Number(m[1]), sequence: Number(m[2]) } : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ShowingValidationInput = {
  language: string;
  parties: PartyFacts[];
  properties: DocumentPropertyFacts[];
  /** False when the showing records no fee (then no fee fields are required). */
  feeApplicable?: boolean;
  fee: FeeTerms;
  feeContext?: FeeContext;
  /** The chosen template asks for the dual-representation consent. */
  templateRequiresDualConsent?: boolean;
  dualRepresentationConsent?: boolean | null;
  template: TemplateCheck | null;
  companyMissing: string[];
  hasResponsibleUser?: boolean;
};

/**
 * What stops a showing from being made ready or issued, and what deserves a look.
 * A draft may stay incomplete: `draftSaveable` is false only for impossible values.
 */
export function validateShowing(input: ShowingValidationInput): DocumentCompletenessResult {
  const blocking: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (input.properties.length === 0) {
    blocking.push({ code: "PROPERTY_MISSING", field: "properties", message: "Προσθέστε τουλάχιστον ένα ακίνητο." });
  }
  const seen = new Set<string>();
  input.properties.forEach((p, i) => {
    const who = p.code ?? `ακίνητο ${i + 1}`;
    if (p.propertyId) {
      if (seen.has(p.propertyId)) blocking.push({ code: "PROPERTY_DUPLICATE", field: `properties[${i}]`, integrity: true, message: `Το ${who} υπάρχει δύο φορές.` });
      seen.add(p.propertyId);
    }
    if (p.hasSnapshot === false) blocking.push({ code: "PROPERTY_SNAPSHOT_MISSING", field: `properties[${i}]`, message: `Λείπει το στιγμιότυπο στοιχείων του ${who}.` });
    if (!p.hasAddress) blocking.push({ code: "PROPERTY_ADDRESS_MISSING", field: `properties[${i}].address`, message: `Λείπει η διεύθυνση του ${who}.` });
    if (p.price == null) warnings.push({ code: "PROPERTY_PRICE_MISSING", field: `properties[${i}].price`, message: `Το ${who} δεν έχει τιμή.` });
    if (p.offMarket) warnings.push({ code: "PROPERTY_OFF_MARKET", field: `properties[${i}]`, message: `Το ${who} δεν είναι πλέον διαθέσιμο.` });
  });

  const parts: Array<{ blockingIssues: ValidationIssue[]; warnings: ValidationIssue[] }> = [{ blockingIssues: blocking, warnings }];
  parts.push(validateParties(input.parties, "πελάτης"));

  if (input.feeApplicable !== false) {
    // A fee on a showing is measured against the single listed price, when there is one.
    const price = input.properties.length === 1 ? input.properties[0]?.price ?? null : null;
    parts.push(validateCommission(input.fee, { propertyPrice: price, ...(input.feeContext ?? {}) }, { requireComplete: true }));
  }

  if (input.templateRequiresDualConsent && input.dualRepresentationConsent == null) {
    blocking.push({ code: "DUAL_REPRESENTATION_UNANSWERED", field: "dualRepresentationConsent", message: "Απαντήστε για τη συναίνεση ενέργειας και για τον αντισυμβαλλόμενο." });
  }

  parts.push(validateTemplateCheck(input.template, { type: SHOWING_TEMPLATE_TYPE, locale: input.language }));
  parts.push(validateCompanyFacts(input.companyMissing));
  if (input.hasResponsibleUser === false) warnings.push({ code: "RESPONSIBLE_USER_MISSING", field: "responsibleUser", message: "Δεν έχει οριστεί υπεύθυνος συνεργάτης." });

  return mergeCompleteness(...parts);
}
