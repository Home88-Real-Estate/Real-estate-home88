/**
 * Commission engine.
 *
 * Pure and deterministic: the inputs are the agreed price (or monthly rent)
 * and the rules from Settings → Προμήθειες. Nothing is assumed: when a rule
 * the calculation needs is not configured, the result says which ones are
 * missing instead of guessing a rate.
 *
 * Money is computed in integer cents to avoid floating-point drift.
 *
 * Rules:
 *  - SALE: if buyer-side and/or seller-side rates are set, each side is
 *    price × its rate; otherwise the single sale rate applies (seller side).
 *  - RENT: commission = monthly rent × the configured number of months.
 *  - A minimum fee, when set, raises a lower result to it.
 *  - VAT: EXCLUSIVE adds VAT on top of the commission; INCLUSIVE means the
 *    commission already contains VAT, which is then separated out.
 *  - The agent/agency split applies to the commission net of VAT.
 */

export type CommissionRules = {
  saleCommissionPct?: number | null;
  rentCommissionMonths?: number | null;
  buyerSidePct?: number | null;
  sellerSidePct?: number | null;
  minimumFee?: number | null;
  agentSharePct?: number | null;
  agencySharePct?: number | null;
  vatMode?: "EXCLUSIVE" | "INCLUSIVE" | string | null;
  vatRatePct?: number | null;
};

export type CommissionInput = {
  type: "SALE" | "RENT";
  /** Agreed sale price (SALE) or monthly rent (RENT), in euros. */
  amount: number;
  rules: CommissionRules;
  /**
   * A per-transaction rate that replaces the configured one: a percentage for
   * SALE, a number of months for RENT. Applied by a manager, with a reason.
   */
  overrideRate?: number | null;
};

export type CommissionBreakdown = {
  basis: "PERCENT" | "MONTHS";
  /** The rate actually used (percent or months), for the record. */
  rate: number;
  buyerSide: number;
  sellerSide: number;
  /** Commission excluding VAT. */
  net: number;
  vat: number;
  /** What is invoiced: net + VAT. */
  gross: number;
  agentShare: number;
  agencyShare: number;
  minimumApplied: boolean;
};

export type CommissionResult =
  | { ok: true; breakdown: CommissionBreakdown }
  | { ok: false; missing: string[] };

const cents = (euros: number) => Math.round(euros * 100);
const euros = (c: number) => c / 100;
const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Labels match Settings → Προμήθειες, so the message tells the user what to fill in. */
export const COMMISSION_RULE_LABELS: Record<string, string> = {
  saleCommissionPct: "Πώληση (%) ή Πλευρά αγοραστή / πωλητή (%)",
  rentCommissionMonths: "Ενοικίαση (μήνες μισθώματος)",
  agentSharePct: "Ποσοστό συνεργάτη (%)",
  agencySharePct: "Ποσοστό γραφείου (%)",
  vatMode: "ΦΠΑ στις προμήθειες",
  vatRatePct: "Συντελεστής ΦΠΑ (%)",
};

export function calculateCommission(input: CommissionInput): CommissionResult {
  const r = input.rules;
  const missing: string[] = [];
  if (!(input.amount > 0)) return { ok: false, missing: ["Συμφωνημένο ποσό"] };

  let buyerC = 0;
  let sellerC = 0;
  let rate = 0;
  let basis: CommissionBreakdown["basis"] = "PERCENT";
  const base = cents(input.amount);

  if (input.type === "SALE") {
    if (has(input.overrideRate)) {
      rate = input.overrideRate;
      sellerC = Math.round((base * rate) / 100);
    } else if (has(r.buyerSidePct) || has(r.sellerSidePct)) {
      buyerC = has(r.buyerSidePct) ? Math.round((base * r.buyerSidePct) / 100) : 0;
      sellerC = has(r.sellerSidePct) ? Math.round((base * r.sellerSidePct) / 100) : 0;
      rate = (r.buyerSidePct ?? 0) + (r.sellerSidePct ?? 0);
    } else if (has(r.saleCommissionPct)) {
      rate = r.saleCommissionPct;
      sellerC = Math.round((base * rate) / 100);
    } else {
      missing.push(COMMISSION_RULE_LABELS.saleCommissionPct!);
    }
  } else {
    basis = "MONTHS";
    const months = has(input.overrideRate) ? input.overrideRate : r.rentCommissionMonths;
    if (has(months)) {
      rate = months;
      sellerC = Math.round(base * months);
    } else {
      missing.push(COMMISSION_RULE_LABELS.rentCommissionMonths!);
    }
  }

  if (!r.vatMode) missing.push(COMMISSION_RULE_LABELS.vatMode!);
  if (!has(r.vatRatePct)) missing.push(COMMISSION_RULE_LABELS.vatRatePct!);
  if (!has(r.agentSharePct)) missing.push(COMMISSION_RULE_LABELS.agentSharePct!);
  if (!has(r.agencySharePct)) missing.push(COMMISSION_RULE_LABELS.agencySharePct!);
  if (missing.length > 0) return { ok: false, missing };

  // The configured amounts are what the client pays in the stated VAT mode.
  let chargedC = buyerC + sellerC;
  let minimumApplied = false;
  if (has(r.minimumFee) && chargedC < cents(r.minimumFee)) {
    const scale = chargedC > 0 ? cents(r.minimumFee) / chargedC : 0;
    if (scale > 0) {
      buyerC = Math.round(buyerC * scale);
      sellerC = cents(r.minimumFee) - buyerC;
    } else {
      sellerC = cents(r.minimumFee);
    }
    chargedC = buyerC + sellerC;
    minimumApplied = true;
  }

  const vatRate = r.vatRatePct! / 100;
  let netC: number;
  let vatC: number;
  if (r.vatMode === "INCLUSIVE") {
    netC = Math.round(chargedC / (1 + vatRate));
    vatC = chargedC - netC;
  } else {
    netC = chargedC;
    vatC = Math.round(netC * vatRate);
  }

  const agentC = Math.round((netC * r.agentSharePct!) / 100);
  return {
    ok: true,
    breakdown: {
      basis,
      rate,
      buyerSide: euros(buyerC),
      sellerSide: euros(sellerC),
      net: euros(netC),
      vat: euros(vatC),
      gross: euros(netC + vatC),
      agentShare: euros(agentC),
      agencyShare: euros(netC - agentC),
      minimumApplied,
    },
  };
}

// ---------------------------------------------------------------------------
// Transaction and offer lifecycle
// ---------------------------------------------------------------------------

export const TRANSACTION_STATUSES = ["NEGOTIATION", "AGREEMENT", "CONTRACT", "CLOSED", "CANCELLED"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  NEGOTIATION: "Διαπραγμάτευση",
  AGREEMENT: "Συμφωνία",
  CONTRACT: "Συμβόλαιο",
  CLOSED: "Ολοκληρώθηκε",
  CANCELLED: "Ακυρώθηκε",
};

/** Allowed moves; CLOSED and CANCELLED are final. */
const NEXT: Record<TransactionStatus, TransactionStatus[]> = {
  NEGOTIATION: ["AGREEMENT", "CANCELLED"],
  AGREEMENT: ["CONTRACT", "CLOSED", "NEGOTIATION", "CANCELLED"],
  CONTRACT: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canMoveTransaction(from: string, to: string): boolean {
  return (NEXT[from as TransactionStatus] ?? []).includes(to as TransactionStatus);
}

export function nextTransactionStatuses(from: string): TransactionStatus[] {
  return NEXT[from as TransactionStatus] ?? [];
}

export const OFFER_PARTIES = ["BUYER", "SELLER"] as const;
export const OFFER_PARTY_LABELS: Record<string, string> = { BUYER: "Αγοραστής / Μισθωτής", SELLER: "Ιδιοκτήτης" };

export const OFFER_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Ανοιχτή",
  COUNTERED: "Αντιπροσφορά",
  ACCEPTED: "Αποδεκτή",
  REJECTED: "Απορρίφθηκε",
  WITHDRAWN: "Ανακλήθηκε",
  EXPIRED: "Έληξε",
};

export const FINANCING_OPTIONS = [
  { value: "CASH", label: "Μετρητά" },
  { value: "MORTGAGE", label: "Δάνειο" },
  { value: "MIXED", label: "Μικτή" },
  { value: "UNKNOWN", label: "Άγνωστο" },
] as const;

export const COMMISSION_STATUSES = ["EXPECTED", "INVOICED", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;
export const COMMISSION_STATUS_LABELS: Record<string, string> = {
  EXPECTED: "Αναμένεται",
  INVOICED: "Τιμολογήθηκε",
  PARTIALLY_PAID: "Μερικώς εξοφλήθηκε",
  PAID: "Εξοφλήθηκε",
  OVERDUE: "Ληξιπρόθεσμη",
  CANCELLED: "Ακυρώθηκε",
};

/** OVERDUE is derived, never stored: invoiced or partly paid and past its due date. */
export function commissionDisplayStatus(status: string, dueDate: Date | string | null, now = new Date()): string {
  if ((status === "INVOICED" || status === "PARTIALLY_PAID") && dueDate && new Date(dueDate) < now) return "OVERDUE";
  return status;
}

export const CHECKLIST_STATUSES = ["REQUESTED", "RECEIVED", "VERIFIED", "REJECTED", "EXPIRED", "NOT_REQUIRED"] as const;
export const CHECKLIST_STATUS_LABELS: Record<string, string> = {
  REQUESTED: "Ζητήθηκε",
  RECEIVED: "Παραλήφθηκε",
  VERIFIED: "Ελέγχθηκε",
  REJECTED: "Απορρίφθηκε",
  EXPIRED: "Έληξε",
  NOT_REQUIRED: "Δεν απαιτείται",
};
