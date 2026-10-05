/**
 * HOME88 comparable valuation engine — V1 ("COMPARABLES").
 *
 * Deterministic and auditable: the same subject, the same candidate
 * observations, the same reference date and the same configuration always
 * give the same result, and every number in the result can be traced back to
 * the observations and the configuration that produced it.
 *
 * What it does:
 *   1. Keeps only candidates that can be compared at all (same property-type
 *      family, plausible size, plausible €/m², not too old).
 *   2. Scores each one for similarity (location, type, size, condition, year,
 *      floor, rooms, features) with configurable weights, and keeps the
 *      breakdown.
 *   3. Searches the subject's own area first and widens to the city and then
 *      the region only while there are not enough good comparables, recording
 *      how far it went.
 *   4. Removes €/m² outliers (IQR) so one abnormal listing cannot move the
 *      result.
 *   5. Weights each comparable by similarity × recency × source (a recorded
 *      transaction counts more than an asking price) and takes the weighted
 *      median €/m²; the range is the weighted inter-quartile range.
 *   6. Rates confidence from how many, how similar, how close, how recent and
 *      how consistent the comparables are.
 *
 * What it deliberately does NOT do:
 *   - Apply universal "sea view = +8%" style adjustments. Without calibrated
 *     data such percentages are invented; V1 instead lets similar properties
 *     (same features, same condition) carry more weight.
 *   - Assume an asking-to-sale discount or a market growth rate.
 *   - Return a number when the data is too thin: it returns INSUFFICIENT_DATA.
 */

export const ENGINE_VERSION = "HV1.0.0";

export type ObservationType = "TRANSACTION" | "ASKING";
export type LocationTier = "AREA" | "CITY" | "REGION";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type ConditionCode = "NEW_BUILD" | "RENOVATED" | "GOOD" | "NEEDS_RENOVATION" | "UNDER_CONSTRUCTION";
export const FEATURE_KEYS = ["parking", "storage", "balcony", "garden", "pool", "seaView", "elevator"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type Location = { region?: string | null; city?: string | null; area?: string | null };

export interface Subject {
  propertyType: string;
  areaSqm: number;
  location: Location;
  condition?: ConditionCode | null;
  yearBuilt?: number | null;
  floor?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  features?: Partial<Record<FeatureKey, boolean | null>>;
}

export interface Candidate extends Omit<Subject, "condition"> {
  /** Stable id within its source, used for ordering ties and the snapshot. */
  id: string;
  /** Where the observation came from (HOME88, MAMA, a licensed feed, ...). */
  source: string;
  observationType: ObservationType;
  price: number;
  condition?: string | null;
  /** Contract date for transactions, last-seen/updated date for listings. */
  observedAt: Date | string;
}

export type DimensionKey = "location" | "type" | "size" | "condition" | "year" | "floor" | "rooms" | "features";

export interface EngineConfig {
  methodologyVersion: string;
  /** Similarity weights; normalised over the dimensions known on both sides. */
  weights: Record<DimensionKey, number>;
  /** Types that may be compared with each other. A type may sit in several families. */
  typeFamilies: string[][];
  locationScore: Record<LocationTier, number>;
  /** A comparable must be within this size ratio of the subject (e.g. 0.5 → 50%–200%). */
  minSizeRatio: number;
  /** Plausible €/m² per family key (first type of the family) or "default". */
  pricePerSqmBounds: Record<string, [number, number]>;
  maxAgeMonths: number;
  /** Recency weight halves every this many months. */
  recencyHalfLifeMonths: number;
  sourceWeight: Record<ObservationType, number>;
  minSimilarity: number;
  strongSimilarity: number;
  minComparables: number;
  /** Widen beyond a tier while fewer than this many strong comparables were found. */
  widenBelowStrong: number;
  maxComparables: number;
  iqrK: number;
  /** An outlier must also sit at least this share away from the median (tight data has a tiny IQR). */
  minOutlierDistance: number;
  /** The range is never narrower than ±this share of the midpoint. */
  minHalfWidth: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  methodologyVersion: "COMP-2026-10",
  weights: { location: 30, type: 20, size: 15, condition: 10, year: 5, floor: 5, rooms: 5, features: 10 },
  typeFamilies: [
    ["APARTMENT", "STUDIO", "MAISONETTE"],
    ["HOUSE", "VILLA", "MAISONETTE"],
    ["LAND", "PLOT"],
    ["OFFICE"],
    ["SHOP"],
    ["WAREHOUSE", "INDUSTRIAL"],
    ["BUILDING"],
    ["HOTEL"],
    ["PARKING"],
  ],
  locationScore: { AREA: 1, CITY: 0.55, REGION: 0.25 },
  minSizeRatio: 0.5,
  pricePerSqmBounds: { default: [200, 50_000], LAND: [1, 20_000], PARKING: [100, 30_000] },
  maxAgeMonths: 60,
  recencyHalfLifeMonths: 18,
  sourceWeight: { TRANSACTION: 1, ASKING: 0.8 },
  minSimilarity: 0.6,
  strongSimilarity: 0.8,
  minComparables: 5,
  widenBelowStrong: 8,
  maxComparables: 40,
  iqrK: 1.5,
  minOutlierDistance: 0.2,
  minHalfWidth: 0.05,
};

export interface ScoredComparable {
  id: string;
  source: string;
  observationType: ObservationType;
  tier: LocationTier;
  price: number;
  areaSqm: number;
  pricePerSqm: number;
  similarity: number;
  breakdown: Partial<Record<DimensionKey, number>>;
  recency: number;
  weight: number;
  ageMonths: number;
  outlier: boolean;
  rank: number;
}

export type EngineResult =
  | {
      status: "OK";
      engineVersion: string;
      methodologyVersion: string;
      midpoint: number;
      low: number;
      high: number;
      pricePerSqm: number;
      pricePerSqmLow: number;
      pricePerSqmHigh: number;
      confidence: Confidence;
      confidenceReasons: string[];
      comparableCount: number;
      strongComparableCount: number;
      transactionCount: number;
      askingCount: number;
      scope: LocationTier;
      tierCounts: Record<LocationTier, number>;
      outliersRemoved: number;
      sizeRange: [number, number];
      comparables: ScoredComparable[];
    }
  | {
      status: "INSUFFICIENT_DATA";
      engineVersion: string;
      methodologyVersion: string;
      reason: "invalid_subject" | "not_enough_comparables";
      comparableCount: number;
      required: number;
      scope: LocationTier | null;
    };

/** Lower-case, accent-free, single-spaced, so "Γλυφάδα", "ΓΛΥΦΑΔΑ" and "γλυφαδα " match. */
export function normalizePlace(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tierOf(subject: Location, c: Location): LocationTier | null {
  const sr = normalizePlace(subject.region), sc = normalizePlace(subject.city), sa = normalizePlace(subject.area);
  const cr = normalizePlace(c.region), cc = normalizePlace(c.city), ca = normalizePlace(c.area);
  if (sc && cc && sc === cc) return sa && ca && sa === ca ? "AREA" : "CITY";
  // An area name on its own (no city on one side) still identifies the place.
  if (!sc && sa && ca && sa === ca) return "AREA";
  if (sr && cr && sr === cr) return "REGION";
  return null;
}

function familiesOf(type: string, config: EngineConfig): string[][] {
  return config.typeFamilies.filter((f) => f.includes(type));
}

function typeScore(subject: string, candidate: string, config: EngineConfig): number | null {
  if (subject === candidate) return 1;
  return familiesOf(subject, config).some((f) => f.includes(candidate)) ? 0.5 : null;
}

function boundsFor(type: string, config: EngineConfig): [number, number] {
  const family = familiesOf(type, config)[0];
  const key = family?.[0] ?? type;
  return config.pricePerSqmBounds[key] ?? config.pricePerSqmBounds.default ?? [0, Number.POSITIVE_INFINITY];
}

const CONDITION_RANK: Record<string, number> = { NEEDS_RENOVATION: 0, UNDER_CONSTRUCTION: 1, GOOD: 1, RENOVATED: 2, NEW_BUILD: 3 };
const linear = (diff: number, span: number) => Math.max(0, 1 - Math.abs(diff) / span);
const known = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

/** Similarity in [0, 1] and the per-dimension scores it was built from. */
export function similarity(
  subject: Subject,
  candidate: Candidate,
  tier: LocationTier,
  config: EngineConfig = DEFAULT_CONFIG,
): { score: number; breakdown: Partial<Record<DimensionKey, number>> } | null {
  const ts = typeScore(subject.propertyType, candidate.propertyType, config);
  if (ts == null) return null;
  const parts: Partial<Record<DimensionKey, number>> = {
    location: config.locationScore[tier],
    type: ts,
    size: linear(candidate.areaSqm / subject.areaSqm - 1, 1 - config.minSizeRatio),
  };
  const sc = subject.condition ? CONDITION_RANK[subject.condition] : undefined;
  const cc = candidate.condition ? CONDITION_RANK[candidate.condition] : undefined;
  if (sc != null && cc != null) parts.condition = linear(sc - cc, 3);
  if (known(subject.yearBuilt) && known(candidate.yearBuilt)) parts.year = linear(subject.yearBuilt - candidate.yearBuilt, 40);
  if (known(subject.floor) && known(candidate.floor)) parts.floor = linear(subject.floor - candidate.floor, 5);
  if (known(subject.bedrooms) && known(candidate.bedrooms)) parts.rooms = linear(subject.bedrooms - candidate.bedrooms, 3);
  const shared = FEATURE_KEYS.filter((k) => subject.features?.[k] != null && candidate.features?.[k] != null);
  if (shared.length > 0) {
    parts.features = shared.filter((k) => Boolean(subject.features?.[k]) === Boolean(candidate.features?.[k])).length / shared.length;
  }
  let sum = 0;
  let weight = 0;
  for (const [key, value] of Object.entries(parts) as Array<[DimensionKey, number]>) {
    sum += config.weights[key] * value;
    weight += config.weights[key];
  }
  // Dimensions unknown on either side are not counted, but a comparable we
  // know little about cannot score as highly as one that matches on everything.
  const total = Object.values(config.weights).reduce((a, b) => a + b, 0);
  const completeness = weight / total;
  const score = weight > 0 ? (sum / weight) * (0.75 + 0.25 * completeness) : 0;
  return { score: Math.round(score * 1000) / 1000, breakdown: parts };
}

/** Weighted quantile over values sorted ascending (q in [0, 1]). */
export function weightedQuantile(values: Array<{ v: number; w: number }>, q: number): number {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, x) => s + x.w, 0);
  if (sorted.length === 0 || total <= 0) return Number.NaN;
  const target = q * total;
  let acc = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i]!;
    const next = acc + item.w;
    if (next >= target) {
      // Interpolate across a boundary that falls exactly between two values.
      if (next === target && i + 1 < sorted.length && q > 0 && q < 1) return (item.v + sorted[i + 1]!.v) / 2;
      return item.v;
    }
    acc = next;
  }
  return sorted[sorted.length - 1]!.v;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const lower = sorted[base]!;
  const upper = sorted[Math.min(base + 1, sorted.length - 1)]!;
  return lower + (pos - base) * (upper - lower);
}

/** Rounds money to a step a person would quote. */
export function roundMoney(value: number): number {
  const step = value >= 200_000 ? 5_000 : value >= 50_000 ? 1_000 : 500;
  return Math.round(value / step) * step;
}

export function runComparableEngine(
  subject: Subject,
  candidates: Candidate[],
  options: { referenceDate: Date; config?: EngineConfig },
): EngineResult {
  const config = options.config ?? DEFAULT_CONFIG;
  const meta = { engineVersion: ENGINE_VERSION, methodologyVersion: config.methodologyVersion };
  if (!(subject.areaSqm >= 10) || !subject.propertyType) {
    return { status: "INSUFFICIENT_DATA", ...meta, reason: "invalid_subject", comparableCount: 0, required: config.minComparables, scope: null };
  }

  const [minPpsqm, maxPpsqm] = boundsFor(subject.propertyType, config);
  const scored: Omit<ScoredComparable, "outlier" | "rank">[] = [];
  for (const c of candidates) {
    if (!(c.price > 0) || !(c.areaSqm > 0)) continue;
    const ratio = c.areaSqm / subject.areaSqm;
    if (ratio < config.minSizeRatio || ratio > 1 / config.minSizeRatio) continue;
    const ppsqm = c.price / c.areaSqm;
    if (ppsqm < minPpsqm || ppsqm > maxPpsqm) continue;
    const observed = new Date(c.observedAt);
    if (Number.isNaN(observed.getTime())) continue;
    const age = Math.max(0, monthsBetween(observed, options.referenceDate));
    if (age > config.maxAgeMonths) continue;
    const tier = tierOf(subject.location, c.location);
    if (!tier) continue;
    const sim = similarity(subject, c, tier, config);
    if (!sim || sim.score < config.minSimilarity) continue;
    const recency = Math.pow(0.5, age / config.recencyHalfLifeMonths);
    scored.push({
      id: c.id,
      source: c.source,
      observationType: c.observationType,
      tier,
      price: c.price,
      areaSqm: c.areaSqm,
      pricePerSqm: ppsqm,
      similarity: sim.score,
      breakdown: sim.breakdown,
      recency: Math.round(recency * 1000) / 1000,
      weight: sim.score * recency * config.sourceWeight[c.observationType],
      ageMonths: Math.round(age * 10) / 10,
    });
  }

  const tierCounts: Record<LocationTier, number> = { AREA: 0, CITY: 0, REGION: 0 };
  for (const s of scored) tierCounts[s.tier] += 1;

  // Widen geography only while there are too few strong comparables.
  const order: LocationTier[] = ["AREA", "CITY", "REGION"];
  let scope: LocationTier = "AREA";
  let pool: typeof scored = [];
  for (const tier of order) {
    scope = tier;
    pool = scored.filter((s) => order.indexOf(s.tier) <= order.indexOf(tier));
    const strong = pool.filter((s) => s.similarity >= config.strongSimilarity).length;
    if (strong >= config.widenBelowStrong) break;
  }

  // Best first; ties broken by id so the order (and the result) is stable.
  pool.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  pool = pool.slice(0, config.maxComparables);

  // Robust outlier screen on €/m² (needs enough points to define quartiles).
  const rates = pool.map((p) => p.pricePerSqm).sort((a, b) => a - b);
  let low = Number.NEGATIVE_INFINITY;
  let high = Number.POSITIVE_INFINITY;
  if (rates.length >= 4) {
    const q1 = quantile(rates, 0.25);
    const q3 = quantile(rates, 0.75);
    const iqr = q3 - q1;
    const med = quantile(rates, 0.5);
    low = Math.min(q1 - config.iqrK * iqr, med * (1 - config.minOutlierDistance));
    high = Math.max(q3 + config.iqrK * iqr, med * (1 + config.minOutlierDistance));
  }
  const ranked: ScoredComparable[] = pool.map((p, i) => ({ ...p, outlier: p.pricePerSqm < low || p.pricePerSqm > high, rank: i + 1 }));
  const used = ranked.filter((r) => !r.outlier);

  if (used.length < config.minComparables) {
    return { status: "INSUFFICIENT_DATA", ...meta, reason: "not_enough_comparables", comparableCount: used.length, required: config.minComparables, scope };
  }

  const values = used.map((u) => ({ v: u.pricePerSqm, w: u.weight }));
  const mid = weightedQuantile(values, 0.5);
  let q25 = weightedQuantile(values, 0.25);
  let q75 = weightedQuantile(values, 0.75);
  q25 = Math.min(q25, mid * (1 - config.minHalfWidth));
  q75 = Math.max(q75, mid * (1 + config.minHalfWidth));

  const strongCount = used.filter((u) => u.similarity >= config.strongSimilarity).length;
  const dispersion = (weightedQuantile(values, 0.75) - weightedQuantile(values, 0.25)) / mid;
  const medianAge = quantile(used.map((u) => u.ageMonths).sort((a, b) => a - b), 0.5);
  const conf = rateConfidence({ count: used.length, strong: strongCount, dispersion, scope, medianAge });

  return {
    status: "OK",
    ...meta,
    midpoint: roundMoney(mid * subject.areaSqm),
    low: roundMoney(q25 * subject.areaSqm),
    high: roundMoney(q75 * subject.areaSqm),
    pricePerSqm: Math.round(mid),
    pricePerSqmLow: Math.round(q25),
    pricePerSqmHigh: Math.round(q75),
    confidence: conf.level,
    confidenceReasons: conf.reasons,
    comparableCount: used.length,
    strongComparableCount: strongCount,
    transactionCount: used.filter((u) => u.observationType === "TRANSACTION").length,
    askingCount: used.filter((u) => u.observationType === "ASKING").length,
    scope,
    tierCounts,
    outliersRemoved: ranked.length - used.length,
    sizeRange: [Math.min(...used.map((u) => u.areaSqm)), Math.max(...used.map((u) => u.areaSqm))],
    comparables: ranked,
  };
}

/**
 * Points for quantity, similarity, proximity, agreement and freshness. HIGH
 * needs all of them to be good; any one weak dimension caps the rating.
 */
export function rateConfidence(input: { count: number; strong: number; dispersion: number; scope: LocationTier; medianAge: number }): {
  level: Confidence;
  reasons: string[];
} {
  const reasons: string[] = [];
  let points = 0;
  if (input.count >= 15) points += 2;
  else if (input.count >= 8) points += 1;
  else reasons.push("Λίγα συγκρίσιμα στοιχεία");
  if (input.strong >= 8) points += 2;
  else if (input.strong >= 3) points += 1;
  else reasons.push("Λίγα στοιχεία υψηλής ομοιότητας");
  if (input.scope === "AREA") points += 2;
  else if (input.scope === "CITY") {
    points += 1;
    reasons.push("Η αναζήτηση επεκτάθηκε στην ευρύτερη πόλη");
  } else reasons.push("Η αναζήτηση επεκτάθηκε στην περιφέρεια");
  if (input.dispersion < 0.15) points += 2;
  else if (input.dispersion < 0.3) points += 1;
  else reasons.push("Μεγάλη διασπορά τιμών");
  if (input.medianAge <= 12) points += 1;
  else reasons.push("Τα στοιχεία δεν είναι πρόσφατα");
  const level: Confidence = points >= 8 ? "HIGH" : points >= 5 ? "MEDIUM" : "LOW";
  return { level, reasons };
}
