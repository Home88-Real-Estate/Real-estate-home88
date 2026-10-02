import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatePublishEligibility, feedStatus } from "./eligibility";
import { makePortalProperty } from "./test-fixtures";

test("a complete active listing is eligible", () => {
  const result = evaluatePublishEligibility(makePortalProperty());
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
});

test("a draft listing is withheld", () => {
  const result = evaluatePublishEligibility(makePortalProperty({ status: "DRAFT" }));
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.includes("status")));
});

test("price on request does not need a price", () => {
  const result = evaluatePublishEligibility(
    makePortalProperty({ price: null, priceOnRequest: true }),
  );
  assert.equal(result.eligible, true);
});

test("a listing with no photo is withheld", () => {
  const result = evaluatePublishEligibility(
    makePortalProperty({ media: [{ kind: "FLOOR_PLAN", url: "https://x/plan.pdf", alt: null, sortOrder: 0, isPrimary: false }] }),
  );
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("no photo"));
});

test("assignments can be disabled per portal", () => {
  const property = makePortalProperty({ listingType: "ASSIGNMENT" });
  assert.equal(evaluatePublishEligibility(property).eligible, true);
  assert.equal(evaluatePublishEligibility(property, { allowAssignment: false }).eligible, false);
});

test("missing title and description are reported", () => {
  const result = evaluatePublishEligibility(
    makePortalProperty({ titleEl: "", descriptionEl: "" }),
  );
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("missing title"));
  assert.ok(result.reasons.includes("missing description"));
});

test("feeds call a property under offer active and lower-case the rest", () => {
  assert.equal(feedStatus("UNDER_OFFER"), "active");
  assert.equal(feedStatus("RESERVED"), "reserved");
  assert.equal(feedStatus("ACTIVE"), "active");
});
