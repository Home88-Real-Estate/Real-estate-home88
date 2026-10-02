import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allNavLinks,
  isNavItemActive,
  isNavLinkActive,
  NAV,
  normalizeListingType,
  resolveActiveNav,
} from "./nav";

/** Resolve a URL the way the header does: pathname + search params. */
function at(url: string) {
  const parsed = new URL(url, "https://home88.test");
  return resolveActiveNav(parsed.pathname, parsed.searchParams);
}

/** Exactly one top-level item may be highlighted at once. */
function activeTopLevelCount(url: string): number {
  const parsed = new URL(url, "https://home88.test");
  const active = resolveActiveNav(parsed.pathname, parsed.searchParams);
  return NAV.filter((item) => isNavItemActive(item, active)).length;
}

test("TEST 1 — / activates home", () => {
  assert.equal(at("/"), "home");
});

test("TEST 2 — /properties activates properties", () => {
  assert.equal(at("/properties"), "properties");
});

test("TEST 3 — /properties?listingType=SALE activates sales", () => {
  assert.equal(at("/properties?listingType=SALE"), "sales");
});

test("TEST 4 — /properties?listingType=RENT activates rentals", () => {
  assert.equal(at("/properties?listingType=RENT"), "rentals");
});

test("TEST 5 — a propertyType filter stays on properties", () => {
  assert.equal(at("/properties?propertyType=APARTMENT"), "properties");
  assert.equal(at("/properties?propertyType=SHOP"), "properties");
});

test("TEST 6 — SALE/RENT plus unrelated filters keep the transaction", () => {
  assert.equal(at("/properties?listingType=SALE&area=Glyfada"), "sales");
  assert.equal(at("/properties?listingType=RENT&area=Voula"), "rentals");
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

test("TEST 13 — exactly one top-level item is highlighted per URL", () => {
  for (const url of [
    "/",
    "/properties",
    "/properties?listingType=SALE",
    "/properties?listingType=RENT",
    "/properties?propertyType=SHOP",
    "/properties?listingType=SALE&area=Glyfada",
    "/submit",
    "/request",
    "/about",
    "/contact",
  ]) {
    assert.equal(activeTopLevelCount(url), 1, `expected one active item for ${url}`);
  }
});

test("TEST 14 — the Ακίνητα parent covers sale, rent and generic properties", () => {
  const properties = NAV.find((item) => item.key === "properties");
  assert.ok(properties, "Ακίνητα item exists");
  assert.equal(isNavItemActive(properties!, "properties"), true);
  assert.equal(isNavItemActive(properties!, "sales"), true);
  assert.equal(isNavItemActive(properties!, "rentals"), true);
  assert.equal(isNavItemActive(properties!, "home"), false);
});

test("TEST 15 — mega-menu leaves highlight only on their exact filter", () => {
  const sale = { href: "/properties?listingType=SALE", label: "Προς πώληση", key: "sales" } as const;
  const shop = { href: "/properties?propertyType=SHOP", label: "Επαγγελματικοί χώροι", key: "properties" } as const;

  const saleUrl = new URL("/properties?listingType=SALE&area=Glyfada", "https://home88.test");
  assert.equal(isNavLinkActive(sale, saleUrl.pathname, saleUrl.searchParams), true);
  assert.equal(isNavLinkActive(shop, saleUrl.pathname, saleUrl.searchParams), false);

  const shopUrl = new URL("/properties?propertyType=SHOP", "https://home88.test");
  assert.equal(isNavLinkActive(shop, shopUrl.pathname, shopUrl.searchParams), true);
});

test("nav destinations agree with their active key", () => {
  for (const item of allNavLinks()) {
    assert.equal(at(item.href), item.key, `href ${item.href} should resolve to ${item.key}`);
  }
});
