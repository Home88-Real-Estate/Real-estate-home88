import assert from "node:assert/strict";
import { test } from "node:test";

import { canPublishWebsite } from "./permissions";
import {
  backfillWebsiteState,
  evaluateWebsiteReadiness,
  FORBIDDEN_PUBLIC_FIELDS,
  isPublicMedia,
  isWebsiteLive,
  legacyPublishedFlag,
  LIVE_WEBSITE_STATUSES,
  publicWebsiteView,
  publicWebsiteWhere,
  PUBLIC_PROPERTY_FIELDS,
  websiteActionsFor,
  websiteSitemapEligible,
  websiteStateForProperty,
  websiteStateForTags,
  type WebsiteReadinessInput,
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

test("live means selected and PUBLISHED, OUTDATED or UPDATE_PENDING; the legacy flag follows it", () => {
  for (const status of LIVE_WEBSITE_STATUSES) {
    assert.equal(isWebsiteLive(status, true), true, status);
    assert.equal(isWebsiteLive(status, false), false, `${status} but not selected`);
    assert.equal(legacyPublishedFlag(status, true), true);
  }
  for (const status of ["DRAFT", "READY", "VALIDATION_FAILED", "UNPUBLISHED", "SOLD", "RENTED", "ARCHIVED", "FAILED", "PAUSED"]) {
    assert.equal(isWebsiteLive(status, true), false, status);
    assert.equal(legacyPublishedFlag(status, true), false, status);
  }
  assert.equal(websiteSitemapEligible({ status: "OUTDATED", enabled: true, visibility: "PUBLIC", noIndex: false, propertyStatus: "ACTIVE" }), true, "stale but live stays in the sitemap");
  assert.equal(websiteSitemapEligible({ status: "PUBLISHED", enabled: true, visibility: "PUBLIC", noIndex: false, propertyStatus: "ACTIVE", tagCodes: ["DO_NOT_PUBLISH"] }), false);
});

test("the public where clause: one rule for lists, detail, sitemap and enquiries", () => {
  const detail = publicWebsiteWhere();
  assert.deepEqual(detail.status.in, ["ACTIVE", "UNDER_OFFER", "RESERVED"]);
  assert.equal(detail.websitePublication.is.enabled, true);
  assert.deepEqual(detail.websitePublication.is.status.in, ["PUBLISHED", "OUTDATED", "UPDATE_PENDING"]);
  assert.deepEqual(detail.websitePublication.is.visibility, { in: ["PUBLIC", "NOINDEX"] }, "a direct link still works for NOINDEX");
  assert.deepEqual(detail.tagAssignments.none.tag.code.in, ["DO_NOT_PUBLISH", "PORTAL_ONLY"]);
  assert.equal(publicWebsiteWhere({ listed: true }).websitePublication.is.visibility, "PUBLIC", "lists need PUBLIC");
  // WEBSITE_ONLY restricts portals, never the website.
  assert.ok(!detail.tagAssignments.none.tag.code.in.includes("WEBSITE_ONLY"));
});

test("approved media only: approved or published, usable, never a document", () => {
  assert.equal(isPublicMedia({ status: "approved", kind: "PHOTO" }), true);
  assert.equal(isPublicMedia({ status: "published", lifecycle: "AVAILABLE", kind: "FLOOR_PLAN" }), true);
  assert.equal(isPublicMedia({ status: "pending_review", kind: "PHOTO" }), false);
  assert.equal(isPublicMedia({ status: "rejected", kind: "PHOTO" }), false);
  for (const lifecycle of ["UPLOADING", "PROCESSING", "QUARANTINED", "REJECTED", "DELETED"]) {
    assert.equal(isPublicMedia({ status: "approved", lifecycle, kind: "PHOTO" }), false, lifecycle);
  }
  assert.equal(isPublicMedia({ status: "approved", kind: "DOCUMENT" }), false, "a legal file is never public");
});

test("the public view is an allow-list, deterministic, and approved media only", () => {
  const property = { reference: "H88-1", titleEl: "Τίτλος", price: { toString: () => "250000.00" }, ownerId: "o1", internalNotes: "secret", commissionRatePct: "3", address: "Οδός 1", details: { x: 1 } };
  const media = [
    { id: "m2", status: "approved", kind: "PHOTO", isPrimary: false, sortOrder: 1, storageKey: "private/key-2" },
    { id: "m1", status: "approved", kind: "PHOTO", isPrimary: true, sortOrder: 5, storageKey: "private/key-1" },
    { id: "m3", status: "pending_review", kind: "PHOTO", isPrimary: false, sortOrder: 0 },
    { id: "m4", status: "approved", lifecycle: "QUARANTINED", kind: "PHOTO", isPrimary: false, sortOrder: 0 },
    { id: "m5", status: "approved", kind: "DOCUMENT", isPrimary: false, sortOrder: 0 },
  ];
  const view = publicWebsiteView(property, media);
  assert.deepEqual(Object.keys(view.fields).sort(), [...PUBLIC_PROPERTY_FIELDS].sort());
  assert.equal(view.fields.price, "250000.00", "decimals are exact strings");
  for (const key of FORBIDDEN_PUBLIC_FIELDS) assert.ok(!(key in view.fields), `${key} must never be public`);
  assert.ok(!JSON.stringify(view).includes("secret") && !JSON.stringify(view).includes("private/key"), "no private data, no storage keys");
  assert.deepEqual(view.media.map((m) => m.id), ["m1", "m2"], "primary first, then order; unapproved, quarantined and documents are out");
  assert.equal(JSON.stringify(publicWebsiteView(property, media)), JSON.stringify(view), "deterministic");
  for (const key of PUBLIC_PROPERTY_FIELDS) assert.ok(!(FORBIDDEN_PUBLIC_FIELDS as readonly string[]).includes(key), `${key} is on both lists`);
});

const ready: WebsiteReadinessInput = {
  propertyStatus: "ACTIVE", tagCodes: [], listingType: "SALE", titleEl: "Τίτλος", titleEn: "Title", descriptionEl: "Περιγραφή", descriptionEn: "Description",
  price: 250000, monthlyRent: null, priceOnRequest: false, energyClass: "B", publicPhotoCount: 3,
};

test("readiness: a complete property is READY with nothing to say", () => {
  assert.deepEqual(evaluateWebsiteReadiness(ready), { outcome: "READY", blockers: [], warnings: [] });
});

test("readiness: status, tags, text and price block; photos and English only warn by default", () => {
  assert.equal(evaluateWebsiteReadiness({ ...ready, propertyStatus: "SOLD" }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, propertyStatus: "DRAFT" }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, tagCodes: ["DO_NOT_PUBLISH"] }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, tagCodes: ["PORTAL_ONLY"] }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, tagCodes: ["WEBSITE_ONLY"] }).outcome, "READY", "WEBSITE_ONLY is a website tag");
  assert.equal(evaluateWebsiteReadiness({ ...ready, titleEl: " " }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, descriptionEl: null }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, price: 0 }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, price: 0, priceOnRequest: true }).outcome, "READY");
  assert.equal(evaluateWebsiteReadiness({ ...ready, listingType: "RENT", price: 250000, monthlyRent: null }).outcome, "BLOCKED", "a rental is priced by rent");
  assert.equal(evaluateWebsiteReadiness({ ...ready, listingType: "RENT", monthlyRent: 900 }).outcome, "READY");
  const bare = evaluateWebsiteReadiness({ ...ready, publicPhotoCount: 0, titleEn: null, energyClass: "NOT_AVAILABLE" });
  assert.equal(bare.outcome, "READY");
  assert.equal(bare.warnings.length, 3);
});

test("readiness: the office's own publication settings are enforced when set", () => {
  assert.equal(evaluateWebsiteReadiness({ ...ready, publicPhotoCount: 1, rules: { minPhotosToPublish: 3 } }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, publicPhotoCount: 3, rules: { minPhotosToPublish: 3 } }).outcome, "READY");
  assert.equal(evaluateWebsiteReadiness({ ...ready, descriptionEn: null, rules: { requireEnglishDescription: true } }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, energyClass: "NOT_AVAILABLE", rules: { requireEnergyClass: true } }).outcome, "BLOCKED");
  assert.equal(evaluateWebsiteReadiness({ ...ready, publicPhotoCount: 0, rules: { minPhotosToPublish: 0, requireEnglishDescription: false, requireEnergyClass: false } }).outcome, "READY");
});

test("lifecycle: a sold property comes down, keeps its selection and returns on reopen", () => {
  const live = { status: "PUBLISHED", enabled: true };
  assert.deepEqual(websiteStateForProperty(live, "SOLD", false), { status: "SOLD", enabled: true, reason: "property_sold" });
  assert.deepEqual(websiteStateForProperty(live, "RENTED", false), { status: "RENTED", enabled: true, reason: "property_rented" });
  assert.equal(websiteStateForProperty({ status: "UNPUBLISHED", enabled: false }, "SOLD", false), null, "nothing to take down");
  assert.deepEqual(websiteStateForProperty({ status: "SOLD", enabled: true }, "ACTIVE", false), { status: "PUBLISHED", enabled: true, reason: "property_reopened" });
  assert.equal(websiteStateForProperty({ status: "SOLD", enabled: true }, "ACTIVE", true), null, "a blocking tag stops the restore");
  assert.equal(websiteStateForProperty({ status: "SOLD", enabled: true }, "INACTIVE", false), null, "reopened to a non-public status stays down");
  assert.equal(websiteStateForProperty({ status: "UNPUBLISHED", enabled: false }, "ACTIVE", false), null, "an unpublished page is never restored");
  assert.deepEqual(websiteStateForProperty({ status: "DRAFT", enabled: true }, "ACTIVE", false), { status: "PUBLISHED", enabled: true, reason: "property_reopened" }, "a backfilled selection returns as it always did");
  assert.equal(websiteStateForProperty({ status: "DRAFT", enabled: false }, "ACTIVE", false), null);
});

test("lifecycle: archived or deleted clears the selection; INACTIVE and moves between public statuses change nothing", () => {
  const live = { status: "PUBLISHED", enabled: true };
  for (const to of ["ARCHIVED", "DELETED"]) {
    assert.deepEqual(websiteStateForProperty(live, to, false), { status: "ARCHIVED", enabled: false, reason: `property_${to.toLowerCase()}` });
  }
  assert.equal(websiteStateForProperty({ status: "ARCHIVED", enabled: false }, "DELETED", false), null);
  assert.equal(websiteStateForProperty(live, "INACTIVE", false), null);
  assert.equal(websiteStateForProperty(live, "UNDER_OFFER", false), null);
  assert.equal(websiteStateForProperty(live, "RESERVED", false), null);
});

test("lifecycle: a blocking tag takes a live page down; WEBSITE_ONLY and other tags do not", () => {
  const live = { status: "PUBLISHED", enabled: true };
  assert.deepEqual(websiteStateForTags(live, ["DO_NOT_PUBLISH"]), { status: "UNPUBLISHED", enabled: false, reason: "tag_do_not_publish" });
  assert.deepEqual(websiteStateForTags(live, ["PORTAL_ONLY"]), { status: "UNPUBLISHED", enabled: false, reason: "tag_portal_only" });
  assert.equal(websiteStateForTags(live, ["WEBSITE_ONLY", "FEATURED"]), null);
  assert.equal(websiteStateForTags({ status: "DRAFT", enabled: false }, ["DO_NOT_PUBLISH"]), null);
});

test("the panel's website actions follow the state", () => {
  assert.deepEqual(websiteActionsFor("DRAFT", false), { validate: true, preview: true, publish: true, update: false, unpublish: false });
  assert.deepEqual(websiteActionsFor("PUBLISHED", true), { validate: true, preview: true, publish: false, update: true, unpublish: true });
  assert.deepEqual(websiteActionsFor("OUTDATED", true), { validate: true, preview: true, publish: false, update: true, unpublish: true });
  assert.equal(websiteActionsFor("UNPUBLISHED", false).publish, true);
  assert.equal(websiteActionsFor("FAILED", false).unpublish, true);
});

test("who may publish to the website: own listings for agents, any for managers, the office for marketing", () => {
  const mine = { agentId: "a1", createdById: "x" };
  const theirs = { agentId: "a2", createdById: "x" };
  assert.equal(canPublishWebsite({ id: "a1", role: "AGENT" }, mine), true);
  assert.equal(canPublishWebsite({ id: "a1", role: "AGENT" }, theirs), false);
  assert.equal(canPublishWebsite({ id: "a1", role: "AGENT" }, { agentId: null, createdById: "a1" }), true, "the creator counts");
  assert.equal(canPublishWebsite({ id: "m1", role: "MANAGER" }, theirs), true);
  assert.equal(canPublishWebsite({ id: "ad", role: "ADMIN" }, theirs), true);
  assert.equal(canPublishWebsite({ id: "mk", role: "MARKETING" }, theirs), true);
  assert.equal(canPublishWebsite({ id: "v1", role: "VIEWER" }, mine), false);
  assert.equal(canPublishWebsite({ id: "a1", role: "NOBODY" }, mine), false);
});
