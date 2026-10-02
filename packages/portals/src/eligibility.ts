import { PUBLIC_PROPERTY_STATUSES } from "@home88/domain";
import type { PortalProperty, PropertyStatus } from "./types";

/** Portals only want listings that are actually on the market right now. */
export const PUBLISHABLE_STATUSES = PUBLIC_PROPERTY_STATUSES;

/**
 * The status word written into feeds. A property under offer is still being
 * marketed, so portals are told it is active rather than given a value their
 * feed specification does not define.
 */
export function feedStatus(status: PropertyStatus): string {
  return status === "UNDER_OFFER" ? "active" : status.toLowerCase();
}

export type PublishEligibility = {
  eligible: boolean;
  /** Human-readable reasons the listing is withheld; empty when eligible. */
  reasons: string[];
};

export type EligibilityOptions = {
  /** Most portals reject a listing with no photo. */
  requirePhoto?: boolean;
  /** Some portals do not carry contract assignments. */
  allowAssignment?: boolean;
};

/**
 * Decides whether a property may be published. Returning reasons rather than a
 * bare boolean lets the CRM show an agent exactly why a listing is not going out.
 */
export function evaluatePublishEligibility(
  property: PortalProperty,
  options: EligibilityOptions = {},
): PublishEligibility {
  const requirePhoto = options.requirePhoto ?? true;
  const allowAssignment = options.allowAssignment ?? true;
  const reasons: string[] = [];

  if (!(PUBLISHABLE_STATUSES as readonly string[]).includes(property.status)) {
    reasons.push(`status is ${property.status.toLowerCase()}`);
  }
  if (property.listingType === "ASSIGNMENT" && !allowAssignment) {
    reasons.push("assignment listings are not carried");
  }
  if (property.titleEl.trim().length === 0) {
    reasons.push("missing title");
  }
  if (property.descriptionEl.trim().length === 0) {
    reasons.push("missing description");
  }
  if (!property.priceOnRequest && (property.price === null || property.price <= 0)) {
    reasons.push("missing price");
  }
  if (requirePhoto && !property.media.some((item) => item.kind === "PHOTO" && item.url.length > 0)) {
    reasons.push("no photo");
  }

  return { eligible: reasons.length === 0, reasons };
}
