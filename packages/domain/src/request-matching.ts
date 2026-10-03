/**
 * Matching a buyer/tenant request (Ζήτηση) against properties.
 *
 * Deterministic and explainable: every criterion the request actually states
 * has a fixed weight; the score is the share of those weights the property
 * meets. Each result says which criteria matched and which did not, so the
 * agent sees why, rather than an unexplained number.
 *
 * Hard rules (a property that fails one is not a match at all): same listing
 * type, one of the requested property types (if any), on the market.
 */

import { fieldLabel } from "./property-profiles";

export type MatchRequest = {
  listingType: string;
  propertyTypes: string[];
  areas: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  minBedrooms?: number | null;
  minBathrooms?: number | null;
  minFloor?: number | null;
  minYearBuilt?: number | null;
  features: string[];
};

export type MatchProperty = {
  listingType: string;
  propertyType: string;
  status: string;
  price?: number | null;
  monthlyRent?: number | null;
  priceOnRequest?: boolean;
  area?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floor?: number | null;
  yearBuilt?: number | null;
  city?: string | null;
  areaName?: string | null;
  neighborhood?: string | null;
  region?: string | null;
  /** Boolean columns and details, by property-profile key. */
  flags: Record<string, unknown>;
};

export type MatchResult = {
  score: number;
  matched: string[];
  missing: string[];
};

/** Statuses a request is matched against. */
export const MATCHABLE_STATUSES = ["ACTIVE"] as const;

/** Weights; only criteria the request states count. */
export const MATCH_WEIGHTS = {
  area: 25,
  price: 30,
  size: 15,
  bedrooms: 10,
  bathrooms: 5,
  floor: 5,
  year: 5,
  features: 10,
} as const;

/** Greek-insensitive comparison: lower case, no accents, no final sigma. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .trim();
}

/** Within range, allowing a tolerance above the maximum (e.g. 5% on price). */
function inRange(value: number, min: number | null | undefined, max: number | null | undefined, tolerance = 0): boolean {
  if (min != null && value < min) return false;
  if (max != null && value > max * (1 + tolerance)) return false;
  return true;
}

const euro = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });

/**
 * Tunable parts of the scoring, set in Settings → Ζητήσεις. Omitted values use
 * the defaults above, so the engine never depends on settings being present.
 */
export type MatchRules = {
  weights?: Partial<Record<keyof typeof MATCH_WEIGHTS, number>>;
  /** Share above the requested maximum still counted as a price match (0.05 = 5%). */
  priceTolerance?: number;
  sizeTolerance?: number;
};

/** null = not a match (hard rule failed). */
export function scoreMatch(request: MatchRequest, property: MatchProperty, rules: MatchRules = {}): MatchResult | null {
  const W = { ...MATCH_WEIGHTS, ...rules.weights };
  const priceTolerance = rules.priceTolerance ?? 0.05;
  const sizeTolerance = rules.sizeTolerance ?? 0.1;
  if (property.listingType !== request.listingType) return null;
  if (request.propertyTypes.length > 0 && !request.propertyTypes.includes(property.propertyType)) return null;
  if (!(MATCHABLE_STATUSES as readonly string[]).includes(property.status)) return null;

  let total = 0;
  let earned = 0;
  const matched: string[] = [];
  const missing: string[] = [];
  const criterion = (weight: number, ok: boolean, label: string) => {
    if (weight <= 0) return;
    total += weight;
    if (ok) {
      earned += weight;
      matched.push(label);
    } else {
      missing.push(label);
    }
  };

  if (request.areas.length > 0) {
    const places = [property.areaName, property.neighborhood, property.city, property.region]
      .filter((v): v is string => Boolean(v))
      .map(normalizeText);
    const wanted = request.areas.map(normalizeText).filter(Boolean);
    const ok = wanted.some((area) => places.some((place) => place.includes(area) || area.includes(place)));
    criterion(W.area, ok, `Περιοχή (${request.areas.join(", ")})`);
  }

  if (request.minPrice != null || request.maxPrice != null) {
    const value = request.listingType === "RENT" ? property.monthlyRent : property.price;
    const label = `Τιμή ${request.minPrice != null ? `από ${euro.format(request.minPrice)} €` : ""}${
      request.maxPrice != null ? ` έως ${euro.format(request.maxPrice)} €` : ""
    }`.replace("  ", " ");
    // "Price on request" cannot be checked: counted as not met, never as met.
    criterion(W.price, value != null && !property.priceOnRequest && inRange(value, request.minPrice, request.maxPrice, priceTolerance), label);
  }

  if (request.minArea != null || request.maxArea != null) {
    criterion(
      W.size,
      property.area != null && inRange(property.area, request.minArea, request.maxArea, sizeTolerance),
      `Εμβαδόν ${request.minArea != null ? `από ${request.minArea}` : ""}${request.maxArea != null ? ` έως ${request.maxArea}` : ""} m²`.replace("  ", " "),
    );
  }

  if (request.minBedrooms != null) {
    criterion(W.bedrooms, (property.bedrooms ?? -1) >= request.minBedrooms, `Υπνοδωμάτια ${request.minBedrooms}+`);
  }
  if (request.minBathrooms != null) {
    criterion(W.bathrooms, (property.bathrooms ?? -1) >= request.minBathrooms, `Μπάνια ${request.minBathrooms}+`);
  }
  if (request.minFloor != null) {
    criterion(W.floor, property.floor != null && property.floor >= request.minFloor, `Όροφος ${request.minFloor}+`);
  }
  if (request.minYearBuilt != null) {
    criterion(
      W.year,
      property.yearBuilt != null && property.yearBuilt >= request.minYearBuilt,
      `Κατασκευή από ${request.minYearBuilt}`,
    );
  }

  if (request.features.length > 0) {
    const share = W.features / request.features.length;
    for (const key of request.features) {
      const value = property.flags[key];
      criterion(share, value === true || value === "true", fieldLabel(property.propertyType, key));
    }
  }

  // A request that states no criteria beyond the hard rules matches fully.
  const score = total === 0 ? 100 : Math.round((earned / total) * 100);
  return { score, matched, missing };
}

/** Features a request can ask for, by profile key (shown as checkboxes). */
export const REQUEST_FEATURES = [
  "parking", "storage", "balcony", "garden", "pool", "elevator", "furnished", "petsAllowed", "seaView",
  "airConditioning", "fireplace", "securityDoor", "newConstruction",
] as const;
