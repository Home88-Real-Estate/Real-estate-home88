/**
 * Structured mandate terms: duration rules, extensions, conflicts between
 * exclusive mandates, and the validator that decides whether a mandate can be
 * made ready for issue.
 *
 * This complements mandate.ts (lifecycle and template rendering) without
 * changing it: the same statuses, the same types.
 */

import {
  buildCompleteness,
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
import { validateOwnership, type OwnerFact, type OwnershipOptions } from "./ownership";

export const DURATION_TYPES = ["INDEFINITE", "FIXED_TERM"] as const;
export type DurationType = (typeof DURATION_TYPES)[number];

/** Statuses in which a mandate is in play (not a draft, not finished badly). */
export const LIVE_MANDATE_STATUSES = ["ISSUED", "SENT", "VIEWED", "SIGNED"] as const;
const LIVE = new Set<string>(LIVE_MANDATE_STATUSES);

const DAY = 86_400_000;
const utcDay = (d: Date | string) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

export type Duration = { totalDays: number; months: number; days: number };

/**
 * The length of a term, calculated from its dates (inclusive of both days).
 * Duration is always derived from start and end, never typed in, so it cannot
 * disagree with them.
 */
export function calculateDuration(start: Date | string, end: Date | string): Duration | null {
  const s = utcDay(start);
  const e = utcDay(end);
  if (e < s) return null;
  const totalDays = Math.round((e - s) / DAY) + 1;
  const sd = new Date(s);
  const ed = new Date(e + DAY); // exclusive end, so a term ending on the 14th that began on the 15th is whole months
  let months = (ed.getUTCFullYear() - sd.getUTCFullYear()) * 12 + (ed.getUTCMonth() - sd.getUTCMonth());
  const anchor = () => Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth() + months, sd.getUTCDate());
  if (anchor() > ed.getTime()) months -= 1;
  const days = Math.round((ed.getTime() - anchor()) / DAY);
  return { totalDays, months, days };
}

/** The end that counts: the latest of the mandate's own end and its issued or signed extensions. */
export type ExtensionFact = { status: string; newEndDate: Date | string };
export function effectiveEndDate(end: Date | string | null | undefined, extensions: ExtensionFact[] = []): Date | null {
  let best = end ? utcDay(end) : null;
  for (const x of extensions) {
    if (x.status !== "ISSUED" && x.status !== "SIGNED") continue;
    const d = utcDay(x.newEndDate);
    if (best === null || d > best) best = d;
  }
  return best === null ? null : new Date(best);
}

// ---------------------------------------------------------------------------
// Exclusive conflicts
// ---------------------------------------------------------------------------

export type ConflictCandidate = {
  id: string;
  /** Number or reference, for the message. */
  label: string;
  type: string;
  status: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  extensions?: ExtensionFact[];
  /** A live mandate replaces this one (supersedesMandateId): it no longer competes. */
  supersededByLive?: boolean;
};

export type ConflictOverride = { conflictingMandateId: string; reason: string };

export const EXCLUSIVE_CONFLICT_MESSAGE = "Υπάρχει ενεργή αποκλειστική ανάθεση για το συγκεκριμένο ακίνητο.";

/**
 * Other exclusive mandates on the same property whose period overlaps the
 * candidate. Cancelled, declined, expired and superseded mandates are ignored;
 * issued and signed ones count until their effective end (extensions
 * included). An override recorded by a manager turns the block into a warning.
 */
export function validateExclusiveConflict(
  candidate: { id?: string | null; type: string; startsAt: Date | string | null; endsAt: Date | string | null },
  others: ConflictCandidate[],
  opts: { overrides?: ConflictOverride[]; now?: Date; expiringSoonDays?: number } = {},
): { blockingIssues: ValidationIssue[]; warnings: ValidationIssue[] } {
  const blocking: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (candidate.type !== "EXCLUSIVE_ASSIGNMENT" || !candidate.startsAt || !candidate.endsAt) return { blockingIssues: blocking, warnings };

  const start = utcDay(candidate.startsAt);
  const end = utcDay(candidate.endsAt);
  const now = utcDay(opts.now ?? new Date());
  const soon = (opts.expiringSoonDays ?? 30) * DAY;

  for (const o of others) {
    if (o.id === candidate.id || o.type !== "EXCLUSIVE_ASSIGNMENT" || !LIVE.has(o.status) || o.supersededByLive || !o.startsAt) continue;
    const oStart = utcDay(o.startsAt);
    const oEndDate = effectiveEndDate(o.endsAt, o.extensions);
    if (!oEndDate) continue;
    const oEnd = oEndDate.getTime();
    const pendingExtension = (o.extensions ?? []).some((x) => x.status === "ISSUED");

    if (oStart <= end && oEnd >= start) {
      const override = opts.overrides?.find((x) => x.conflictingMandateId === o.id);
      if (override?.reason.trim()) {
        warnings.push({ code: "EXCLUSIVE_CONFLICT_OVERRIDDEN", field: "dates", message: `${EXCLUSIVE_CONFLICT_MESSAGE} (${o.label}) — έγκριση προϊσταμένου: ${override.reason}` });
      } else {
        blocking.push({
          code: "EXCLUSIVE_CONFLICT",
          field: "dates",
          reason: pendingExtension ? "PENDING_EXTENSION" : "OVERLAP",
          message: `${EXCLUSIVE_CONFLICT_MESSAGE} (${o.label}${pendingExtension ? ", με εκκρεμή παράταση" : ""}).`,
        });
      }
    } else if (oEnd >= now && oEnd - now <= soon) {
      warnings.push({ code: "EXCLUSIVE_EXPIRING_SOON", field: "dates", message: `Η αποκλειστική ανάθεση ${o.label} λήγει σύντομα.` });
    }
  }
  return { blockingIssues: blocking, warnings };
}

// ---------------------------------------------------------------------------
// Mandate validation
// ---------------------------------------------------------------------------

export const PERMISSION_FIELDS = [
  { key: "photoPermission", label: "φωτογράφηση/δημοσίευση φωτογραφιών" },
  { key: "videoPermission", label: "βίντεο" },
  { key: "floorplanPermission", label: "κάτοψη" },
  { key: "signboardPermission", label: "πινακίδα" },
  { key: "portalPublicationPermission", label: "δημοσίευση σε portals" },
  { key: "socialMediaPermission", label: "social media" },
  { key: "cooperatingBrokerPermission", label: "συνεργαζόμενους μεσίτες" },
] as const;

export type MandateValidationInput = {
  type: "SIMPLE_ASSIGNMENT" | "EXCLUSIVE_ASSIGNMENT" | "VIEWING" | string;
  language: string;
  durationType?: DurationType | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  hasProperty: boolean;
  property?: DocumentPropertyFacts | null;
  parties: PartyFacts[];
  owners?: OwnerFact[];
  ownershipOptions?: OwnershipOptions;
  fee: FeeTerms;
  feeContext?: FeeContext;
  knownDefects?: boolean | null;
  defectsDisclosureConfirmed?: boolean | null;
  defectsDescription?: string | null;
  permissions?: Partial<Record<(typeof PERMISSION_FIELDS)[number]["key"] | "brokerCooperationAllowed", boolean | null>>;
  template: TemplateCheck | null;
  companyMissing: string[];
  conflicts?: { blockingIssues: ValidationIssue[]; warnings: ValidationIssue[] };
  /** The longest exclusive term counsel approved, in months. Null/undefined: none configured. */
  maxExclusiveMonths?: number | null;
  now?: Date;
};

export function validateMandate(input: MandateValidationInput): DocumentCompletenessResult {
  const blocking: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const isAssignment = input.type === "SIMPLE_ASSIGNMENT" || input.type === "EXCLUSIVE_ASSIGNMENT";

  if (!["SIMPLE_ASSIGNMENT", "EXCLUSIVE_ASSIGNMENT", "VIEWING"].includes(input.type)) {
    blocking.push({ code: "MANDATE_TYPE_MISSING", field: "type", message: "Επιλέξτε τύπο εντολής (απλή ή αποκλειστική)." });
  }
  if (!input.hasProperty) blocking.push({ code: "PROPERTY_MISSING", field: "property", message: "Δεν έχει οριστεί ακίνητο." });

  // Dates and duration.
  if (isAssignment) {
    const start = input.startDate ? new Date(input.startDate) : null;
    const end = input.endDate ? new Date(input.endDate) : null;
    if (!start || Number.isNaN(start.getTime())) {
      blocking.push({ code: "START_DATE_MISSING", field: "startDate", message: "Συμπληρώστε την ημερομηνία έναρξης." });
    }
    if (input.type === "EXCLUSIVE_ASSIGNMENT") {
      if (!end || Number.isNaN(end.getTime())) blocking.push({ code: "END_DATE_MISSING", field: "endDate", message: "Η αποκλειστική ανάθεση απαιτεί ημερομηνία λήξης." });
      if (input.durationType !== "FIXED_TERM") {
        blocking.push({ code: "EXCLUSIVE_DURATION_INVALID", field: "durationType", message: "Η αποκλειστική ανάθεση είναι πάντα ορισμένου χρόνου." });
      }
    } else {
      if (!input.durationType) blocking.push({ code: "DURATION_TYPE_MISSING", field: "durationType", message: "Επιλέξτε διάρκεια (αορίστου ή ορισμένου χρόνου)." });
      if (input.durationType === "FIXED_TERM" && (!end || Number.isNaN(end.getTime()))) {
        blocking.push({ code: "END_DATE_MISSING", field: "endDate", message: "Η ανάθεση ορισμένου χρόνου απαιτεί ημερομηνία λήξης." });
      }
      if (input.durationType === "INDEFINITE" && end) {
        blocking.push({ code: "INDEFINITE_WITH_END_DATE", field: "endDate", integrity: true, message: "Η ανάθεση αορίστου χρόνου δεν έχει ημερομηνία λήξης." });
      }
    }
    if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const d = calculateDuration(start, end);
      if (!d) {
        blocking.push({ code: "END_BEFORE_START", field: "endDate", integrity: true, message: "Η λήξη δεν μπορεί να είναι πριν από την έναρξη." });
      } else if (input.type === "EXCLUSIVE_ASSIGNMENT") {
        const max = input.maxExclusiveMonths;
        if (typeof max === "number" && max > 0) {
          if (d.months > max || (d.months === max && d.days > 0)) {
            blocking.push({ code: "EXCLUSIVE_TOO_LONG", field: "endDate", message: `Η διάρκεια ξεπερνά το επιτρεπόμενο μέγιστο (${max} μήνες).` });
          }
        } else {
          warnings.push({ code: "EXCLUSIVE_MAX_NOT_CONFIGURED", field: "endDate", message: "Δεν έχει οριστεί μέγιστη διάρκεια αποκλειστικής ανάθεσης στις Ρυθμίσεις· δεν ελέγχεται." });
        }
      }
    }
  }

  // Property facts.
  if (input.property) {
    if (!input.property.hasAddress) blocking.push({ code: "PROPERTY_ADDRESS_MISSING", field: "property.address", message: "Λείπει η διεύθυνση του ακινήτου." });
    if (input.property.price == null) warnings.push({ code: "PROPERTY_PRICE_MISSING", field: "property.price", message: "Το ακίνητο δεν έχει τιμή." });
    if (input.property.offMarket) warnings.push({ code: "PROPERTY_OFF_MARKET", field: "property", message: "Το ακίνητο δεν είναι πλέον διαθέσιμο (πωλήθηκε/μισθώθηκε/αποσύρθηκε)." });
  }

  // Owners and signatories.
  const parts: Array<{ blockingIssues: ValidationIssue[]; warnings: ValidationIssue[] }> = [{ blockingIssues: blocking, warnings }];
  if (input.owners) parts.push(validateOwnership(input.owners, { on: input.now, ...(input.ownershipOptions ?? {}) }));
  parts.push(validateParties(input.parties, input.type === "VIEWING" ? "ενδιαφερόμενος" : "εντολέας"));

  // Fee.
  parts.push(validateCommission(input.fee, { propertyPrice: input.property?.price, ...(input.feeContext ?? {}) }, { requireComplete: true }));

  if (isAssignment) {
    // Declarations that must be answered, not defaulted.
    if (input.knownDefects == null) {
      blocking.push({ code: "DEFECTS_UNANSWERED", field: "knownDefects", message: "Απαντήστε αν το ακίνητο έχει γνωστά ελαττώματα." });
    } else if (input.knownDefects === true && !input.defectsDescription?.trim()) {
      blocking.push({ code: "DEFECTS_DESCRIPTION_MISSING", field: "defectsDescription", message: "Περιγράψτε τα γνωστά ελαττώματα." });
    }
    if (input.defectsDisclosureConfirmed !== true) {
      blocking.push({ code: "DEFECTS_DISCLOSURE_UNCONFIRMED", field: "defectsDisclosureConfirmed", message: "Λείπει η δήλωση του εντολέα για τα ελαττώματα του ακινήτου." });
    }
    for (const f of PERMISSION_FIELDS) {
      const v = input.permissions?.[f.key];
      if (v == null) blocking.push({ code: "PERMISSION_UNANSWERED", field: f.key, message: `Απαντήστε για την άδεια: ${f.label}.` });
      else if (v === false && (f.key === "photoPermission" || f.key === "portalPublicationPermission")) {
        warnings.push({ code: "PERMISSION_NOT_GRANTED", field: f.key, message: `Δεν έχει δοθεί άδεια: ${f.label}.` });
      }
    }
    if (input.permissions?.brokerCooperationAllowed == null) {
      blocking.push({ code: "PERMISSION_UNANSWERED", field: "brokerCooperationAllowed", message: "Απαντήστε για τη συνεργασία με άλλους μεσίτες." });
    }
  }

  parts.push(validateTemplateCheck(input.template, { type: input.type, locale: input.language }));
  parts.push(validateCompanyFacts(input.companyMissing));
  if (input.conflicts) parts.push(input.conflicts);

  return mergeCompleteness(...parts);
}

export { buildCompleteness };
