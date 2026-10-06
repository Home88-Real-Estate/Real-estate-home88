/**
 * Structured fee terms for showings and mandates: validation, a deterministic
 * calculation and the "does this fee look wrong" check.
 *
 * No rate is assumed anywhere. A VAT rate comes from the document or from
 * Settings → Προμήθειες; if neither exists the fee is reported as incomplete.
 * Money is calculated in integer cents.
 */

import { buildCompleteness, type DocumentCompletenessResult, type ValidationIssue } from "./document-validation";

export const FEE_PAYERS = ["OWNER", "BUYER", "TENANT", "LANDLORD", "BOTH_PARTIES", "OTHER"] as const;
export const FEE_METHODS = ["PERCENTAGE", "FIXED_AMOUNT", "CUSTOM", "NEGOTIATED_LATER"] as const;
export const FEE_BASES = ["ASKING_PRICE", "FINAL_SALE_PRICE", "MONTHLY_RENT", "ANNUAL_RENT", "CONTRACT_VALUE", "OTHER"] as const;
export const VAT_TREATMENTS = ["PLUS_VAT", "VAT_INCLUDED", "VAT_EXEMPT", "NOT_APPLICABLE"] as const;
export const PAYMENT_TRIGGERS = ["RESERVATION", "PRELIMINARY_AGREEMENT", "FINAL_CONTRACT", "LEASE_SIGNING", "INSTALLMENTS", "CUSTOM"] as const;

export type FeePayer = (typeof FEE_PAYERS)[number];
export type FeeMethod = (typeof FEE_METHODS)[number];
export type FeeBasis = (typeof FEE_BASES)[number];
export type VatTreatment = (typeof VAT_TREATMENTS)[number];
export type PaymentTrigger = (typeof PAYMENT_TRIGGERS)[number];

export type PaymentMilestoneInput = {
  sequence: number;
  /** Exactly one of percentage / fixedAmount. */
  percentage?: number | null;
  fixedAmount?: number | null;
  trigger?: string | null;
};

export type FeeTerms = {
  payer?: FeePayer | null;
  method?: FeeMethod | null;
  basis?: FeeBasis | null;
  percentage?: number | null;
  fixedAmount?: number | null;
  currency?: string | null;
  vatTreatment?: VatTreatment | null;
  vatRate?: number | null;
  paymentTrigger?: PaymentTrigger | null;
  milestones?: PaymentMilestoneInput[];
  /** A person accepted a COMMISSION_ANOMALY warning, and why. */
  anomalyOverrideReason?: string | null;
};

export type FeeContext = {
  /** The asking price (or the monthly rent for a rental), in euros. */
  propertyPrice?: number | null;
  /** The VAT rate configured in Settings → Προμήθειες, in percent. */
  configuredVatRatePct?: number | null;
  /** When false, anomalies are warnings; when true they block until acknowledged with a reason. */
  blockAnomalies?: boolean;
  thresholds?: Partial<AnomalyThresholds>;
};

/**
 * Heuristics for "this looks like a data-entry mistake". They only ever raise
 * a warning (or, if the office chooses, require an acknowledgement); they are
 * not business rules, so they are configurable.
 */
export type AnomalyThresholds = {
  /** A percentage above this is suspicious. */
  maxPercentage: number;
  /** A fixed fee above this share of the price (0–1) is suspicious. */
  maxShareOfPrice: number;
  /** A fixed fee below this many euros, on a price of at least `minPriceForSmallFee`, may be a percentage typed as an amount. */
  minPlausibleFixedFee: number;
  minPriceForSmallFee: number;
};

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  maxPercentage: 10,
  maxShareOfPrice: 0.1,
  minPlausibleFixedFee: 50,
  minPriceForSmallFee: 1000,
};

const cents = (euros: number) => Math.round(euros * 100);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const present = (v: unknown) => v !== null && v !== undefined;

// ---------------------------------------------------------------------------
// Payment milestones
// ---------------------------------------------------------------------------

export function validatePaymentMilestones(
  milestones: PaymentMilestoneInput[] | undefined,
  opts: { feeMethod?: FeeMethod | null; fixedFee?: number | null } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const list = milestones ?? [];
  if (list.length === 0) return issues;

  const seen = new Set<number>();
  for (const m of list) {
    if (!Number.isInteger(m.sequence) || m.sequence < 1) {
      issues.push({ code: "MILESTONE_SEQUENCE_INVALID", field: "milestones", integrity: true, message: "Η σειρά της δόσης πρέπει να είναι θετικός ακέραιος." });
    } else if (seen.has(m.sequence)) {
      issues.push({ code: "MILESTONE_SEQUENCE_DUPLICATE", field: "milestones", integrity: true, message: `Διπλή σειρά δόσης: ${m.sequence}.` });
    }
    seen.add(m.sequence);

    const hasPct = present(m.percentage);
    const hasAmt = present(m.fixedAmount);
    if (hasPct === hasAmt) {
      issues.push({ code: "MILESTONE_AMOUNT_AMBIGUOUS", field: "milestones", integrity: true, message: `Η δόση ${m.sequence} πρέπει να έχει είτε ποσοστό είτε ποσό, όχι και τα δύο ή κανένα.` });
      continue;
    }
    if (hasPct && !(finite(m.percentage) && m.percentage > 0 && m.percentage <= 100)) {
      issues.push({ code: "MILESTONE_PERCENTAGE_INVALID", field: "milestones", integrity: true, message: `Το ποσοστό της δόσης ${m.sequence} πρέπει να είναι από 0 έως 100.` });
    }
    if (hasAmt && !(finite(m.fixedAmount) && m.fixedAmount > 0)) {
      issues.push({ code: "MILESTONE_FIXED_AMOUNT_INVALID", field: "milestones", integrity: true, message: `Το ποσό της δόσης ${m.sequence} πρέπει να είναι θετικό.` });
    }
  }
  if (issues.length > 0) return issues;

  const pct = list.filter((m) => present(m.percentage));
  const amt = list.filter((m) => present(m.fixedAmount));
  if (pct.length > 0 && amt.length > 0) {
    issues.push({ code: "MILESTONE_MIXED", field: "milestones", message: "Οι δόσεις πρέπει να είναι όλες ποσοστά ή όλες ποσά." });
  } else if (pct.length > 0) {
    // Scaled to 1/10 000 of a percent so the sum is exact.
    const total = pct.reduce((s, m) => s + Math.round((m.percentage as number) * 10_000), 0);
    if (total !== 1_000_000) {
      issues.push({ code: "MILESTONE_PERCENTAGE_TOTAL", field: "milestones", message: `Τα ποσοστά των δόσεων αθροίζουν ${total / 10_000}% αντί για 100%.` });
    }
  } else if (opts.feeMethod === "FIXED_AMOUNT" && finite(opts.fixedFee)) {
    const total = amt.reduce((s, m) => s + cents(m.fixedAmount as number), 0);
    if (total !== cents(opts.fixedFee)) {
      issues.push({ code: "MILESTONE_AMOUNT_TOTAL", field: "milestones", message: "Τα ποσά των δόσεων δεν αθροίζουν στην αμοιβή." });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

export type FeeAmounts = { net: number; vat: number; gross: number; currency: string };

/**
 * The fee in euros, net / VAT / gross, or null when it cannot be known: the
 * method is custom or negotiated later, an amount, base or VAT rate is missing.
 *
 * `baseAmount` is whatever the fee is a percentage of (asking price, final
 * price, annual rent…); for a fixed fee it is not needed.
 */
export function calculateFee(terms: FeeTerms, baseAmount?: number | null, configuredVatRatePct?: number | null): FeeAmounts | null {
  let feeCents: number;
  if (terms.method === "FIXED_AMOUNT") {
    if (!finite(terms.fixedAmount) || terms.fixedAmount < 0) return null;
    feeCents = cents(terms.fixedAmount);
  } else if (terms.method === "PERCENTAGE") {
    if (!finite(terms.percentage) || !finite(baseAmount) || terms.percentage < 0 || terms.percentage > 100 || baseAmount < 0) return null;
    // percentage to 4 decimals, applied to whole cents.
    feeCents = Math.round((cents(baseAmount) * Math.round(terms.percentage * 10_000)) / 1_000_000);
  } else {
    return null;
  }
  const currency = terms.currency ?? "EUR";
  const vatRate = terms.vatRate ?? configuredVatRatePct ?? null;

  switch (terms.vatTreatment) {
    case "PLUS_VAT": {
      if (!finite(vatRate)) return null;
      const vat = Math.round((feeCents * Math.round(vatRate * 100)) / 10_000);
      return { net: feeCents / 100, vat: vat / 100, gross: (feeCents + vat) / 100, currency };
    }
    case "VAT_INCLUDED": {
      if (!finite(vatRate)) return null;
      const net = Math.round((feeCents * 10_000) / (10_000 + Math.round(vatRate * 100)));
      return { net: net / 100, vat: (feeCents - net) / 100, gross: feeCents / 100, currency };
    }
    case "VAT_EXEMPT":
    case "NOT_APPLICABLE":
      return { net: feeCents / 100, vat: 0, gross: feeCents / 100, currency };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

export const COMMISSION_ANOMALY = "COMMISSION_ANOMALY";
export type CommissionAnomalyReason =
  | "EQUALS_PRICE"
  | "EXCEEDS_THRESHOLD"
  | "ZERO_WITH_SCHEDULE"
  | "PERCENTAGE_LOOKS_LIKE_AMOUNT"
  | "AMOUNT_LOOKS_LIKE_PERCENTAGE";

/** Suspicious fee values. Never changes anything: it only reports. */
export function detectCommissionAnomalies(terms: FeeTerms, ctx: FeeContext = {}): ValidationIssue[] {
  const t: AnomalyThresholds = { ...DEFAULT_ANOMALY_THRESHOLDS, ...(ctx.thresholds ?? {}) };
  const out: ValidationIssue[] = [];
  const add = (reason: CommissionAnomalyReason, message: string) => out.push({ code: COMMISSION_ANOMALY, reason, field: "fee", message });
  const price = finite(ctx.propertyPrice) && ctx.propertyPrice > 0 ? ctx.propertyPrice : null;

  if (terms.method === "FIXED_AMOUNT" && finite(terms.fixedAmount)) {
    const fee = terms.fixedAmount;
    if (price !== null && cents(fee) === cents(price)) {
      add("EQUALS_PRICE", "Ελέγξτε την αμοιβή: το ποσό ισούται με την τιμή του ακινήτου.");
    } else if (price !== null && fee > price * t.maxShareOfPrice) {
      add("EXCEEDS_THRESHOLD", `Ελέγξτε την αμοιβή: ξεπερνά το ${Math.round(t.maxShareOfPrice * 100)}% της τιμής του ακινήτου.`);
    }
    if (fee > 0 && fee < t.minPlausibleFixedFee && price !== null && price >= t.minPriceForSmallFee) {
      add("AMOUNT_LOOKS_LIKE_PERCENTAGE", "Ελέγξτε την αμοιβή: το ποσό είναι πολύ μικρό και ίσως είναι ποσοστό.");
    }
  }
  if (terms.method === "PERCENTAGE" && finite(terms.percentage)) {
    const pct = terms.percentage;
    if (pct > 100) {
      add("PERCENTAGE_LOOKS_LIKE_AMOUNT", "Ελέγξτε την αμοιβή: το ποσοστό ξεπερνά το 100% και ίσως είναι ποσό σε ευρώ.");
    } else if (pct === 100) {
      add("EQUALS_PRICE", "Ελέγξτε την αμοιβή: το ποσοστό 100% ισούται με την τιμή του ακινήτου.");
    } else if (pct > t.maxPercentage) {
      add("EXCEEDS_THRESHOLD", `Ελέγξτε την αμοιβή: το ποσοστό ξεπερνά το ${t.maxPercentage}%.`);
    }
  }
  const zero = (terms.method === "PERCENTAGE" && terms.percentage === 0) || (terms.method === "FIXED_AMOUNT" && terms.fixedAmount === 0);
  if (zero && (present(terms.paymentTrigger) || (terms.milestones?.length ?? 0) > 0)) {
    add("ZERO_WITH_SCHEDULE", "Ελέγξτε την αμοιβή: είναι μηδενική αλλά ορίζεται χρονοδιάγραμμα πληρωμής.");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Whether the fee terms are valid and, with `requireComplete`, complete enough
 * to issue a document. Impossible values always block (and are marked
 * `integrity`); missing values block only when completeness is required.
 */
export function validateCommission(terms: FeeTerms, ctx: FeeContext = {}, opts: { requireComplete?: boolean } = {}): DocumentCompletenessResult {
  const complete = opts.requireComplete ?? true;
  const blocking: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const missing = (code: string, field: string, message: string) => {
    if (complete) blocking.push({ code, field, message });
  };

  if (!terms.payer) missing("FEE_PAYER_MISSING", "feePayer", "Επιλέξτε ποιος καταβάλλει την αμοιβή.");
  if (!terms.method) missing("FEE_METHOD_MISSING", "feeMethod", "Επιλέξτε τρόπο υπολογισμού της αμοιβής.");
  if (!terms.currency) missing("FEE_CURRENCY_MISSING", "feeCurrency", "Λείπει το νόμισμα της αμοιβής.");
  else if (!/^[A-Z]{3}$/.test(terms.currency)) blocking.push({ code: "FEE_CURRENCY_INVALID", field: "feeCurrency", integrity: true, message: "Μη έγκυρο νόμισμα." });
  if (!terms.vatTreatment) missing("VAT_TREATMENT_MISSING", "vatTreatment", "Επιλέξτε τον τρόπο αντιμετώπισης του ΦΠΑ.");

  if (terms.method === "PERCENTAGE" || terms.method === "FIXED_AMOUNT") {
    if (!terms.basis && terms.method === "PERCENTAGE") missing("FEE_BASIS_MISSING", "feeBasis", "Επιλέξτε επί ποίου ποσού υπολογίζεται το ποσοστό.");
  }

  if (finite(terms.percentage) && (terms.percentage < 0 || terms.percentage > 100)) {
    blocking.push({ code: "FEE_PERCENTAGE_INVALID", field: "feePercentage", integrity: true, message: "Το ποσοστό αμοιβής πρέπει να είναι από 0 έως 100." });
  }
  if (finite(terms.fixedAmount) && terms.fixedAmount < 0) {
    blocking.push({ code: "FEE_FIXED_AMOUNT_INVALID", field: "feeFixedAmount", integrity: true, message: "Το ποσό της αμοιβής δεν μπορεί να είναι αρνητικό." });
  }
  if (terms.method === "PERCENTAGE") {
    if (!finite(terms.percentage)) missing("FEE_PERCENTAGE_MISSING", "feePercentage", "Συμπληρώστε το ποσοστό της αμοιβής.");
    if (present(terms.fixedAmount)) blocking.push({ code: "FEE_METHOD_AMBIGUOUS", field: "feeFixedAmount", integrity: true, message: "Έχει οριστεί ποσοστό και σταθερό ποσό ταυτόχρονα." });
  }
  if (terms.method === "FIXED_AMOUNT") {
    if (!finite(terms.fixedAmount)) missing("FEE_FIXED_AMOUNT_MISSING", "feeFixedAmount", "Συμπληρώστε το ποσό της αμοιβής.");
    if (present(terms.percentage)) blocking.push({ code: "FEE_METHOD_AMBIGUOUS", field: "feePercentage", integrity: true, message: "Έχει οριστεί ποσοστό και σταθερό ποσό ταυτόχρονα." });
  }

  // VAT: a rate only where VAT applies; where it applies, one must be known (document or Settings).
  const vatApplies = terms.vatTreatment === "PLUS_VAT" || terms.vatTreatment === "VAT_INCLUDED";
  if (present(terms.vatRate)) {
    if (!(finite(terms.vatRate) && terms.vatRate >= 0 && terms.vatRate <= 100)) {
      blocking.push({ code: "VAT_RATE_INVALID", field: "vatRate", integrity: true, message: "Ο συντελεστής ΦΠΑ πρέπει να είναι από 0 έως 100." });
    } else if (terms.vatTreatment && !vatApplies) {
      blocking.push({ code: "VAT_RATE_NOT_APPLICABLE", field: "vatRate", integrity: true, message: "Έχει οριστεί συντελεστής ΦΠΑ ενώ ο ΦΠΑ δεν εφαρμόζεται." });
    }
  }
  if (vatApplies && !finite(terms.vatRate) && !finite(ctx.configuredVatRatePct)) {
    missing("VAT_RATE_UNCONFIGURED", "vatRate", "Δεν έχει οριστεί συντελεστής ΦΠΑ (έγγραφο ή Ρυθμίσεις → Προμήθειες).");
  }

  blocking.push(...validatePaymentMilestones(terms.milestones, { feeMethod: terms.method, fixedFee: terms.fixedAmount }));

  // Anomalies: a warning, or a block until someone acknowledges with a reason.
  const anomalies = detectCommissionAnomalies(terms, ctx);
  const acknowledged = typeof terms.anomalyOverrideReason === "string" && terms.anomalyOverrideReason.trim().length > 0;
  for (const a of anomalies) {
    if (ctx.blockAnomalies && !acknowledged) blocking.push(a);
    else warnings.push(acknowledged ? { ...a, message: `${a.message} (έχει γίνει αποδοχή με αιτιολογία)` } : a);
  }
  return buildCompleteness(blocking, warnings);
}
