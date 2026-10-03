/**
 * Publication rules: which properties a portal should carry.
 *
 * Every portal has its own rule, and "published on the website" never implies
 * "published on a portal". Tags are matched by stable code, never by free text.
 * Thresholds and lists are data on the rule, not constants here.
 */

import type { PortalProperty } from "./types";

/**
 * Tag codes that override any portal rule. They mirror SYSTEM_PROPERTY_TAGS in
 * @home88/domain: a property the agency has said must not go to portals, or
 * only to the website, is never sent.
 */
export const PORTAL_BLOCKING_TAGS = ["DO_NOT_PUBLISH", "WEBSITE_ONLY"] as const;

export type PublicationMode = "NONE" | "ALL_WEBSITE" | "BY_TYPE" | "BY_TAG";

/** Optional narrowing applied on top of the mode. Empty or absent means "no limit". */
export type PublicationConditions = {
  listingTypes?: string[];
  propertyTypes?: string[];
  cities?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  /** Property must carry at least one of these tag codes. */
  requireAnyTag?: string[];
};

export type PublicationRule = {
  mode: PublicationMode | string;
  propertyTypes?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  conditions?: PublicationConditions | null;
};

export type RuleVerdict = { selected: boolean; reasons: string[] };

function has(list: string[] | undefined): list is string[] {
  return Array.isArray(list) && list.length > 0;
}

/** Normalises a stored JSON blob into conditions, dropping anything malformed. */
export function parseConditions(raw: unknown): PublicationConditions | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const strings = (value: unknown): string[] | undefined =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : undefined;
  const number = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    listingTypes: strings(source.listingTypes),
    propertyTypes: strings(source.propertyTypes),
    cities: strings(source.cities),
    minPrice: number(source.minPrice),
    maxPrice: number(source.maxPrice),
    minArea: number(source.minArea),
    maxArea: number(source.maxArea),
    requireAnyTag: strings(source.requireAnyTag),
  };
}

/**
 * Decides whether the rule selects a property. Returns every reason it does not,
 * so the CRM can say why a listing is not going to a given portal.
 */
export function evaluatePublicationRule(
  property: PortalProperty,
  tagCodes: readonly string[],
  rule: PublicationRule | null | undefined,
): RuleVerdict {
  const reasons: string[] = [];

  const blocked = PORTAL_BLOCKING_TAGS.filter((tag) => tagCodes.includes(tag));
  if (blocked.length > 0) reasons.push(`flag ${blocked.join(", ")}`);

  const mode = rule?.mode ?? "NONE";
  if (mode === "NONE") {
    reasons.push("no publication rule");
  } else if (mode === "BY_TYPE") {
    if (!has(rule?.propertyTypes) || !rule!.propertyTypes!.includes(property.propertyType)) {
      reasons.push(`property type ${property.propertyType.toLowerCase()} not selected`);
    }
  } else if (mode === "BY_TAG") {
    if (!has(rule?.includeTags) || !rule!.includeTags!.some((tag) => tagCodes.includes(tag))) {
      reasons.push("no included tag");
    }
  }
  const excluded = (rule?.excludeTags ?? []).filter((tag) => tagCodes.includes(tag));
  if (excluded.length > 0) reasons.push(`excluded tag ${excluded.join(", ")}`);

  const c = rule?.conditions;
  if (c && mode !== "NONE") {
    if (has(c.listingTypes) && !c.listingTypes.includes(property.listingType)) {
      reasons.push(`listing type ${property.listingType.toLowerCase()} not selected`);
    }
    if (has(c.propertyTypes) && !c.propertyTypes.includes(property.propertyType)) {
      reasons.push(`property type ${property.propertyType.toLowerCase()} not selected`);
    }
    if (has(c.cities) && !(property.city && c.cities.includes(property.city))) {
      reasons.push("city not selected");
    }
    if (has(c.requireAnyTag) && !c.requireAnyTag.some((tag) => tagCodes.includes(tag))) {
      reasons.push("required tag missing");
    }
    // A price condition cannot be judged for a property with no price; it is
    // withheld rather than waved through.
    if (c.minPrice != null && (property.price === null || property.price < c.minPrice)) {
      reasons.push("price below minimum");
    }
    if (c.maxPrice != null && (property.price === null || property.price > c.maxPrice)) {
      reasons.push("price above maximum");
    }
    if (c.minArea != null && (property.area === null || property.area < c.minArea)) {
      reasons.push("area below minimum");
    }
    if (c.maxArea != null && (property.area === null || property.area > c.maxArea)) {
      reasons.push("area above maximum");
    }
  }

  return { selected: reasons.length === 0, reasons };
}
