import assert from "node:assert/strict";
import { test } from "node:test";

import { NAV, normalizeListingType, resolveActiveNav } from "./nav";

/** Resolve a URL the way the header does: pathname + search params. */
function at(url: string) {
  const parsed = new URL(url, "https://home88.test");
  return resolveActiveNav(parsed.pathname, parsed.searchParams);
}

/** Exactly one of the three properties destinations may be active at once. */
function activePropertiesCount(url: string): number {
  const active = at(url);
  return NAV.filter((item) => item.key === active && ["sales", "rentals", "properties"].includes(item.key))
    .length;
}

test("TEST 1 — /properties activates properties", () => {
  assert.equal(at("/properties"), "properties");
});

test("TEST 2 — /properties?listingType=SALE activates sales", () => {
  assert.equal(at("/properties?listingType=SALE"), "sales");
});

test("TEST 3 — /properties?listingType=RENT activates rentals", () => {
  assert.equal(at("/properties?listingType=RENT"), "rentals");
});

test("TEST 4 — SALE plus unrelated filters stays sales", () => {
  assert.equal(at("/properties?listingType=SALE&area=Glyfada"), "sales");
});

test("TEST 5 — RENT plus unrelated filters stays rentals", () => {
  assert.equal(at("/properties?listingType=RENT&area=Voula"), "rentals");
});

test("TEST 6 — a non-transaction filter falls back to properties", () => {
  assert.equal(at("/properties?area=Glyfada"), "properties");
});

test("TEST 7 — /submit", () => assert.equal(at("/submit"), "submit"));
test("TEST 8 — /request", () => assert.equal(at("/request"), "request"));
test("TEST 9 — /about", () => assert.equal(at("/about"), "about"));
test("TEST 10 — /contact", () => assert.equal(at("/contact"), "contact"));

test("TEST 11 — an invalid listingType never activates sales or rentals", () => {
  assert.equal(at("/properties?listingType=LEASE"), "properties");
  assert.equal(at("/properties?listingType="), "properties");
  assert.equal(normalizeListingType("PURCHASE"), null);
  assert.equal(normalizeListingType("sale"), "SALE");
  assert.equal(normalizeListingType("rent"), "RENT");
  assert.equal(normalizeListingType(undefined), null);
});

test("TEST 12 — deep links and trailing slashes resolve correctly", () => {
  assert.equal(at("/properties?listingType=SALE&minPrice=100"), "sales");
  assert.equal(at("/properties/?listingType=RENT"), "rentals");
  assert.equal(at("/properties/"), "properties");
  assert.equal(at("/areas/glyfada"), "areas");
  assert.equal(at("/valuation"), "valuation");
  assert.equal(at("/unrecognised"), null);
});

test("TEST 14 — exactly one property destination is active per URL", () => {
  for (const url of [
    "/properties",
    "/properties?listingType=SALE",
    "/properties?listingType=RENT",
    "/properties?listingType=SALE&area=Glyfada",
    "/properties?listingType=RENT&area=Voula",
    "/properties?area=Glyfada",
  ]) {
    assert.equal(activePropertiesCount(url), 1, `expected one active item for ${url}`);
  }
});

test("nav destinations agree with their active key", () => {
  for (const item of NAV) {
    assert.equal(at(item.href), item.key, `href ${item.href} should resolve to ${item.key}`);
  }
});
