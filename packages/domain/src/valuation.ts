/**
 * Seller / owner pipeline and comparative market valuation.
 *
 * Pure and deterministic. The valuation is a comparative-market estimate built
 * only from the comparables the agent selects: price per m² of each, adjusted
 * by the agent's own percentage, then summarised as a median with an
 * interquartile range. Nothing is assumed: no discount from asking to sale
 * price, no area premiums, no rounding policy. Those are the agent's
 * adjustments, recorded per comparable with a reason.
 */

// ---------------------------------------------------------------------------
// Seller / owner pipeline
// ---------------------------------------------------------------------------

export const SELLER_STAGES = ["NEW", "CONTACTED", "VALUATION", "PROPOSAL", "MANDATE", "LISTED", "LOST"] as const;
export type SellerStage = (typeof SELLER_STAGES)[number];

export const SELLER_STAGE_LABELS: Record<SellerStage, string> = {
  NEW: "Νέος ιδιοκτήτης",
  CONTACTED: "Επικοινωνία",
  VALUATION: "Εκτίμηση",
  PROPOSAL: "Πρόταση",
  MANDATE: "Ανάθεση",
  LISTED: "Καταχωρήθηκε",
  LOST: "Χάθηκε",
};

/** The open stages, in pipeline order. */
export const SELLER_OPEN_STAGES: SellerStage[] = ["NEW", "CONTACTED", "VALUATION", "PROPOSAL", "MANDATE"];

/**
 * Open stages can move to any other open stage (forwards or back), to LOST,
 * or to LISTED. LISTED is final; LOST can be reopened as NEW.
 */
export function canMoveSeller(from: string, to: string): boolean {
  if (from === to) return false;
  if (from === "LISTED") return false;
  if (from === "LOST") return to === "NEW";
  if (!SELLER_OPEN_STAGES.includes(from as SellerStage)) return false;
  return (SELLER_STAGES as readonly string[]).includes(to);
}

export function nextSellerStages(from: string): SellerStage[] {
  return SELLER_STAGES.filter((s) => canMoveSeller(from, s));
}

export const SELLER_MOTIVATIONS = [
  { value: "RELOCATION", label: "Μετακόμιση" },
  { value: "UPGRADE", label: "Αναβάθμιση κατοικίας" },
  { value: "DOWNSIZE", label: "Μικρότερη κατοικία" },
  { value: "INHERITANCE", label: "Κληρονομιά" },
  { value: "INVESTMENT", label: "Ρευστοποίηση επένδυσης" },
  { value: "FINANCIAL", label: "Οικονομικοί λόγοι" },
  { value: "OTHER", label: "Άλλο" },
] as const;

export const SELLER_TIMEFRAMES = [
  { value: "NOW", label: "Άμεσα" },
  { value: "3M", label: "Έως 3 μήνες" },
  { value: "6M", label: "Έως 6 μήνες" },
  { value: "12M", label: "Έως 12 μήνες" },
  { value: "EXPLORING", label: "Διερευνά" },
] as const;

// ---------------------------------------------------------------------------
// Comparables
// ---------------------------------------------------------------------------

export const COMPARABLE_KINDS = ["SOLD", "RENTED", "ASKING", "EXTERNAL"] as const;
export type ComparableKind = (typeof COMPARABLE_KINDS)[number];
export const COMPARABLE_KIND_LABELS: Record<ComparableKind, string> = {
  SOLD: "Πωλήθηκε (συναλλαγή)",
  RENTED: "Μισθώθηκε (συναλλαγή)",
  ASKING: "Ζητούμενη τιμή",
  EXTERNAL: "Εξωτερική πηγή",
};

export type ComparableSubject = {
  area: number | null;
  city?: string | null;
  areaName?: string | null;
  bedrooms?: number | null;
  floor?: number | null;
  yearBuilt?: number | null;
  condition?: string | null;
};

export type ComparableCandidate = ComparableSubject & { price: number | null };

/**
 * How closely a candidate resembles the subject, 0–100. Used only to rank
 * the search results the agent chooses from; it never changes a value.
 * Location dominates, then size, then layout, age, floor and condition.
 */
export function comparableSimilarity(subject: ComparableSubject, c: ComparableCandidate): number {
  const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  let score = 0;
  // Location: 35
  if (eq(subject.areaName, c.areaName)) score += 35;
  else if (eq(subject.city, c.city)) score += 15;
  // Size: 30, linear to zero at a 50% difference
  if (subject.area && c.area) score += 30 * Math.max(0, 1 - Math.abs(c.area - subject.area) / subject.area / 0.5);
  // Bedrooms: 12
  if (subject.bedrooms != null && c.bedrooms != null) score += 12 * Math.max(0, 1 - Math.abs(c.bedrooms - subject.bedrooms) / 3);
  // Age: 10, linear to zero at 30 years apart
  if (subject.yearBuilt && c.yearBuilt) score += 10 * Math.max(0, 1 - Math.abs(c.yearBuilt - subject.yearBuilt) / 30);
  // Floor: 7
  if (subject.floor != null && c.floor != null) score += 7 * Math.max(0, 1 - Math.abs(c.floor - subject.floor) / 5);
  // Condition: 6
  if (eq(subject.condition, c.condition)) score += 6;
  return Math.round(score);
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

export type ValuationComparableInput = {
  price: number;
  area: number;
  /** Agent's adjustment for differences from the subject, in percent (−50…+50). */
  adjustmentPct?: number | null;
  included?: boolean;
};

export type ValuationResult =
  | {
      ok: true;
      count: number;
      /** Adjusted € per m² of each included comparable, in input order. */
      adjustedPerSqm: number[];
      medianPerSqm: number;
      lowPerSqm: number;
      highPerSqm: number;
      meanPerSqm: number;
      /** Coefficient of variation of the adjusted €/m² (spread ÷ mean). */
      dispersion: number;
      estimate: number;
      low: number;
      high: number;
      confidence: "HIGH" | "MEDIUM" | "LOW";
    }
  | { ok: false; missing: string[] };

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Linear-interpolated percentile of a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/**
 * Comparative-market estimate. With fewer than four comparables the range is
 * the min–max of the adjusted €/m²; with four or more it is the
 * interquartile range, so a single outlier does not stretch it.
 */
export function valuate(subjectArea: number | null | undefined, comparables: ValuationComparableInput[]): ValuationResult {
  const missing: string[] = [];
  if (!(typeof subjectArea === "number" && subjectArea > 0)) missing.push("Εμβαδόν ακινήτου (m²)");
  const used = comparables.filter((c) => c.included !== false && c.price > 0 && c.area > 0);
  if (used.length === 0) missing.push("Τουλάχιστον ένα συγκριτικό με τιμή και εμβαδόν");
  if (missing.length > 0) return { ok: false, missing };

  const adjusted = used.map((c) => {
    const adj = Math.max(-50, Math.min(50, c.adjustmentPct ?? 0));
    return round2((c.price / c.area) * (1 + adj / 100));
  });
  const sorted = [...adjusted].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const wide = sorted.length < 4;
  const low = wide ? sorted[0]! : percentile(sorted, 0.25);
  const high = wide ? sorted[sorted.length - 1]! : percentile(sorted, 0.75);
  const mean = adjusted.reduce((s, v) => s + v, 0) / adjusted.length;
  const variance = adjusted.reduce((s, v) => s + (v - mean) ** 2, 0) / adjusted.length;
  const dispersion = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const n = adjusted.length;
  const confidence = n >= 5 && dispersion <= 0.15 ? "HIGH" : n >= 3 && dispersion <= 0.25 ? "MEDIUM" : "LOW";
  const area = subjectArea!;

  return {
    ok: true,
    count: n,
    adjustedPerSqm: adjusted,
    medianPerSqm: round2(median),
    lowPerSqm: round2(low),
    highPerSqm: round2(high),
    meanPerSqm: round2(mean),
    dispersion: Math.round(dispersion * 1000) / 1000,
    estimate: Math.round(median * area),
    low: Math.round(low * area),
    high: Math.round(high * area),
    confidence,
  };
}

export const VALUATION_CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "Υψηλή",
  MEDIUM: "Μέτρια",
  LOW: "Χαμηλή",
};

export const VALUATION_STATUSES = ["DRAFT", "FINAL"] as const;
export const VALUATION_STATUS_LABELS: Record<string, string> = { DRAFT: "Πρόχειρη", FINAL: "Οριστική" };

// ---------------------------------------------------------------------------
// Owner report
// ---------------------------------------------------------------------------

/** Whole days between two dates (never negative). */
export function daysBetween(from: Date | string, to: Date | string = new Date()): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
