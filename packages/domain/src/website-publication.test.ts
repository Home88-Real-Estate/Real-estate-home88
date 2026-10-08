import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backfillWebsiteState,
  isWebsiteLive,
  websiteSitemapEligible,
} from "./website-publication";

test("backfill: published + public status → PUBLISHED and live", () => {
  for (const status of ["ACTIVE", "UNDER_OFFER", "RESERVED"]) {
    const r = backfillWebsiteState(true, status);
    assert.equal(r.status, "PUBLISHED", status);
    assert.equal(r.enabled, true);
    assert.equal(r.sitemapIncluded, true);
    assert.equal(r.noIndex, false);
    assert.equal(r.visibility, "PUBLIC");
    assert.equal(r.needsReview, false);
    assert.equal(isWebsiteLive(r.status, r.enabled), true);
  }
});

test("backfill: published but non-public status → DRAFT, never an invented public page", () => {
  for (const status of ["DRAFT", "INACTIVE", "SOLD", "RENTED", "ARCHIVED", "DELETED"]) {
    const r = backfillWebsiteState(true, status);
    assert.equal(r.status, "DRAFT", status);
    assert.equal(r.enabled, true); // existing intent retained
    assert.equal(r.sitemapIncluded, false);
    assert.equal(r.noIndex, true);
    assert.equal(r.visibility, "NOINDEX");
    assert.equal(r.needsReview, true, `${status} must be flagged for review`);
    assert.equal(isWebsiteLive(r.status, r.enabled), false);
  }
});

test("backfill: not published → DRAFT and disabled", () => {
  for (const status of ["ACTIVE", "DRAFT", "SOLD", "INACTIVE"]) {
    const r = backfillWebsiteState(false, status);
    assert.equal(r.status, "DRAFT", status);
    assert.equal(r.enabled, false);
    assert.equal(r.sitemapIncluded, false);
    assert.equal(r.noIndex, true);
    assert.equal(r.visibility, "NOINDEX");
    assert.equal(r.needsReview, false);
    assert.equal(isWebsiteLive(r.status, r.enabled), false);
  }
});

test("sitemap eligibility: requires every condition; single violation excludes", () => {
  const live = { status: "PUBLISHED", enabled: true, visibility: "PUBLIC", noIndex: false, propertyStatus: "ACTIVE" };
  assert.equal(websiteSitemapEligible(live), true);

  const failures: Array<[Partial<typeof live>, string]> = [
    [{ status: "DRAFT" }, "not published"],
    [{ enabled: false }, "disabled"],
    [{ visibility: "NOINDEX" }, "not public"],
    [{ noIndex: true }, "noindexed"],
    [{ propertyStatus: "SOLD" }, "property not public"],
  ];
  for (const [patch, why] of failures) {
    assert.equal(websiteSitemapEligible({ ...live, ...patch }), false, why);
  }
});