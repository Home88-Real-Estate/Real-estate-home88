/**
 * Indicative valuation engine.
 *
 * This is deliberately NOT an appraisal and must never be presented as one.
 *
 * It is built the only honest way a system with no proprietary price model can
 * be: it derives a base price per square metre from *actual comparable listings*
 * supplied by the caller (real records from the database), then applies a small,
 * disclosed set of adjustments for the subject property's own attributes.
 *
 * Two rules keep it truthful:
 *   1. With too few comparables it refuses to guess (`ok: false`) instead of
 *      inventing a number.
 *   2. Every movement from the comparable base is returned as a line item, so
 *      the UI can show exactly why the estimate differs from the market median.
 */

export const VALUATION_LIMITS = {
  /** Below this many usable comparables we refuse to estimate. */
  minComparables: 5,
  /** Plausibility band for a comparable €/m²; outside it the record is dropped. */
  minPricePerSqm: 200,
  maxPricePerSqm: 50_000,
  minComparableArea: 15,
} as const;

export type ValuationCondition =
  | "NEW_BUILD"
  | "RENOVATED"
  | "GOOD"
  | "NEEDS_RENOVATION"
  | "UNDER_CONSTRUCTION";

export interface ValuationInput {
  propertyType: string;
  /** Subject floor area in m². */
  area: number;
  city?: string | null;
  areaName?: string | null;
  condition?: ValuationCondition | null;
  yearBuilt?: number | null;
  floor?: number | null;
  totalFloors?: number | null;
  parking?: boolean | null;
  storage?: boolean | null;
  balcony?: boolean | null;
  garden?: boolean | null;
  pool?: boolean | null;
  seaView?: boolean | null;
  furnished?: boolean | null;
  hasSolar?: boolean | null;
}

export interface Comparable {
  price: number | null | undefined;
  area: number | null | undefined;
  propertyType?: string | null;
}

export interface Adjustment {
  label: string;
  /** Delta applied to the base, e.g. -0.1 for a 10% reduction. */
  factor: number;
}

export interface EstimateOptions {
  /** Injectable so tests and stored reports are deterministic. */
  referenceYear?: number;
  maxComparables?: number;
}

export type EstimateFailureReason = "insufficient_comparables" | "invalid_area";

export type ValuationEstimate =
  | {
      ok: true;
      currency: "EUR";
      low: number;
      estimate: number;
      high: number;
      pricePerSqm: number;
      comparableCount: number;
      confidence: "low" | "medium" | "high";
      adjustments: Adjustment[];
      /** True when no subject attributes were supplied and only the base rate applied. */
      baseOnly: boolean;
      referenceYear: number;
    }
  | {
      ok: false;
      reason: EstimateFailureReason;
      comparableCount: number;
      required: number;
    };

function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base] as number;
  const upper = sorted[Math.min(base + 1, sorted.length - 1)] as number;
  return lower + rest * (upper - lower);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Rounds money to a step a human would actually quote. */
export function roundEstimate(value: number): number {
  const step = value >= 200_000 ? 5_000 : value >= 50_000 ? 1_000 : 500;
  return Math.round(value / step) * step;
}

/**
 * Subject-specific deltas. Kept small and hard-capped: a property's own
 * features should nudge the market median, never double it.
 */
export function computeAdjustments(
  input: ValuationInput,
  referenceYear: number,
): Adjustment[] {
  const out: Adjustment[] = [];

  if (input.yearBuilt != null) {
    const age = referenceYear - input.yearBuilt;
    // -0.5% per year of age, floored at -20%; a brand-new building gets +5%.
    const factor = age <= 0 ? 0.05 : -Math.min(age, 40) * 0.005;
    out.push({ label: age <= 0 ? "Νέα κατασκευή" : `Ηλικία (${Math.max(age, 0)} έτη)`, factor });
  }

  const condition: ValuationCondition = input.condition ?? "GOOD";
  const conditionFactor: Record<ValuationCondition, number> = {
    NEW_BUILD: 0.06,
    UNDER_CONSTRUCTION: -0.05,
    RENOVATED: 0.03,
    GOOD: 0,
    NEEDS_RENOVATION: -0.1,
  };
  const cf = conditionFactor[condition];
  if (cf !== 0) out.push({ label: "Κατάσταση", factor: cf });

  if (input.floor != null && input.totalFloors != null && input.totalFloors > 1) {
    if (input.floor === 0) out.push({ label: "Ισόγειο", factor: -0.03 });
    else if (input.floor === input.totalFloors - 1) out.push({ label: "Τελευταίος όροφος", factor: 0.02 });
  }

  const flags: Array<[boolean | null | undefined, string, number]> = [
    [input.parking, "Parking", 0.04],
    [input.seaView, "Θέα θάλασσα", 0.08],
    [input.pool, "Πισίνα", 0.06],
    [input.garden, "Κήπος", 0.03],
    [input.furnished, "Επιπλωμένο", 0.02],
    [input.hasSolar, "Φωτοβολταϊκά", 0.02],
    [input.storage, "Αποθήκη", 0.01],
    [input.balcony, "Μπαλκόνι", 0.01],
  ];
  for (const [on, labelText, factor] of flags) {
    if (on) out.push({ label: labelText, factor });
  }

  return out;
}

export function estimateValuation(
  input: ValuationInput,
  comparables: Comparable[],
  options: EstimateOptions = {},
): ValuationEstimate {
  if (!Number.isFinite(input.area) || input.area < VALUATION_LIMITS.minComparableArea) {
    return {
      ok: false,
      reason: "invalid_area",
      comparableCount: 0,
      required: VALUATION_LIMITS.minComparables,
    };
  }

  const referenceYear = options.referenceYear ?? new Date().getUTCFullYear();
  const maxComparables = options.maxComparables ?? 40;

  const usable = (rows: Comparable[]): number[] =>
    rows
      .map((c) => {
        const price = Number(c.price);
        const area = Number(c.area);
        if (!Number.isFinite(price) || !Number.isFinite(area)) return null;
        if (area < VALUATION_LIMITS.minComparableArea || price <= 0) return null;
        const perSqm = price / area;
        if (perSqm < VALUATION_LIMITS.minPricePerSqm || perSqm > VALUATION_LIMITS.maxPricePerSqm) return null;
        return perSqm;
      })
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);

  // Prefer genuine like-for-like comparables; only broaden to all types when
  // there is not enough of them to stand on their own.
  const sameType = comparables.filter((c) => c.propertyType === input.propertyType);
  let rates = usable(sameType);
  if (rates.length < VALUATION_LIMITS.minComparables) {
    rates = usable(comparables);
  }

  if (rates.length < VALUATION_LIMITS.minComparables) {
    return {
      ok: false,
      reason: "insufficient_comparables",
      comparableCount: rates.length,
      required: VALUATION_LIMITS.minComparables,
    };
  }

  if (rates.length > maxComparables) {
    const drop = (rates.length - maxComparables) / 2;
    rates = rates.slice(Math.floor(drop), rates.length - Math.ceil(drop));
  }

  const basePerSqm = median(rates);
  const q1 = quantile(rates, 0.25);
  const q3 = quantile(rates, 0.75);
  const dispersion = basePerSqm > 0 ? (q3 - q1) / basePerSqm : 0;

  const adjustments = computeAdjustments(input, referenceYear);
  const rawFactor = adjustments.reduce((sum, a) => sum + a.factor, 0);
  const totalFactor = clamp(rawFactor, -0.3, 0.3);
  const adjustedPerSqm = basePerSqm * (1 + totalFactor);
  const estimate = adjustedPerSqm * input.area;

  // Uncertainty shrinks as comparables accumulate and as they agree with one
  // another. Capped so the range never looks more precise than it is.
  let spread = clamp(0.15 - 0.02 * Math.log(rates.length), 0.06, 0.15);
  spread = clamp(spread + Math.min(dispersion, 0.2) * 0.3, 0.05, 0.18);

  const confidence: "low" | "medium" | "high" =
    rates.length >= 20 && dispersion < 0.2 && totalFactor === rawFactor
      ? "high"
      : rates.length >= 8 && dispersion < 0.35
        ? "medium"
        : "low";

  return {
    ok: true,
    currency: "EUR",
    low: roundEstimate(estimate * (1 - spread)),
    estimate: roundEstimate(estimate),
    high: roundEstimate(estimate * (1 + spread)),
    pricePerSqm: Math.round(adjustedPerSqm),
    comparableCount: rates.length,
    confidence,
    adjustments,
    baseOnly: adjustments.length === 0,
    referenceYear,
  };
}
