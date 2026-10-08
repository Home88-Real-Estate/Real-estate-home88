/**
 * Website publication rules (PR 1 of Website Publication).
 *
 * WebsitePublication.status is the authoritative website state going forward;
 * Property.publishedOnWebsite becomes a derived compatibility field that the
 * publication service (PR 2) synchronizes from it. Nothing ever writes both.
 *
 * These pure functions are the tested source of truth for two machines that
 * must not drift:
 *   - backfillWebsiteState() — how an existing Property row maps onto a
 *     WebsitePublication. The migration in packages/database mirrors it.
 *   - websiteSitemapEligible() — "public and indexable". Sitemap inclusion is
 *     server-derived and never trusted from the UI.
 */

import { isPublicStatus } from "./property-lifecycle";

/** A property is live on the public website when its publication is PUBLISHED and enabled. */
export function isWebsiteLive(status: string, enabled: boolean): boolean {
  return status === "PUBLISHED" && enabled;
}

/**
 * The backfill rule: map a legacy Property row onto a WebsitePublication.
 *
 * - published AND public property status → PUBLISHED (the page stays live).
 * - published but NOT a public property status → DRAFT with enabled retained:
 *   do NOT invent a public page the current system considers non-public. Such
 *   rows are flagged needsReview, never silently published.
 * - not published → DRAFT, disabled.
 */
export function backfillWebsiteState(publishedOnWebsite: boolean, propertyStatus: string) {
  const publicEligible = publishedOnWebsite && isPublicStatus(propertyStatus);
  return {
    status: publicEligible ? "PUBLISHED" : "DRAFT",
    enabled: publishedOnWebsite,
    noIndex: !publicEligible,
    sitemapIncluded: publicEligible,
    visibility: publicEligible ? "PUBLIC" : "NOINDEX",
    needsReview: publishedOnWebsite && !isPublicStatus(propertyStatus),
  };
}

/** Server-derived sitemap inclusion. Every input must be satisfied. */
export function websiteSitemapEligible(input: {
  status: string;
  enabled: boolean;
  visibility: string;
  noIndex: boolean;
  propertyStatus: string;
}): boolean {
  return (
    input.status === "PUBLISHED" &&
    input.enabled &&
    input.visibility === "PUBLIC" &&
    !input.noIndex &&
    isPublicStatus(input.propertyStatus)
  );
}