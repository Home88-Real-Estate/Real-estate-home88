import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allNavLinks,
  isNavItemActive,
  isNavLinkActive,
  NAV,
  normalizeListingType,
  PROPERTY_MENU,
  resolveActiveNav,
} from "./nav";

const BASE = "https://home88.test";

/** Resolve a URL the way the header does: pathname + search params. */
function resolve(url: string) {
  const parsed = new URL(url, BASE);
  return { parsed, active: resolveActiveNav(parsed.pathname, parsed.searchParams) };
}

function at(url: string) {
  return resolve(url).active;
}

function topLevel(key: string) {
  const item = NAV.find((entry) => entry.key === key);
  assert.ok(item, `top-level item "${key}" exists`);
  return item!;
}

/** Which dropdown destination is highlighted for a URL. */
function menuState(url: string) {
  const { parsed } = resolve(url);
  return {
    heading: isNavLinkActive(PROPERTY_MENU.heading, parsed.pathname, parsed.searchParams),
    sale: isNavLinkActive(PROPERTY_MENU.links[0]!, parsed.pathname, parsed.searchParams),
    rent: isNavLinkActive(PROPERTY_MENU.links[1]!, parsed.pathname, parsed.searchParams),
  };
}

function propertiesActive(url: string): boolean {
  return isNavItemActive(topLevel("properties"), at(url));
}

test("TEST 1 — /properties: ΑΚΙΝΗΤΑ active, ΑΝΑΖΗΤΗΣΗ selected", () => {
  assert.equal(propertiesActive("/properties"), true);
  assert.deepEqual(menuState("/properties"), { heading: true, sale: false, rent: false });
});

test("TEST 2 — /properties?listingType=SALE: ΠΡΟΣ ΠΩΛΗΣΗ active", () => {
  assert.equal(propertiesActive("/properties?listingType=SALE"), true);
  assert.deepEqual(menuState("/properties?listingType=SALE"), {
    heading: false,
    sale: true,
    rent: false,
  });
});

test("TEST 3 — /properties?listingType=RENT: ΠΡΟΣ ΕΝΟΙΚΙΑΣΗ active", () => {
  assert.equal(propertiesActive("/properties?listingType=RENT"), true);
  assert.deepEqual(menuState("/properties?listingType=RENT"), {
    heading: false,
    sale: false,
    rent: true,
  });
});

test("TEST 4 — extra filters keep ΠΡΟΣ ΠΩΛΗΣΗ active", () => {
  assert.equal(propertiesActive("/properties?listingType=SALE&area=Glyfada"), true);
  assert.deepEqual(menuState("/properties?listingType=SALE&area=Glyfada"), {
    heading: false,
    sale: true,
    rent: false,
  });
});

test("TEST 5 — extra filters keep ΠΡΟΣ ΕΝΟΙΚΙΑΣΗ active", () => {
  assert.equal(propertiesActive("/properties?listingType=RENT&minPrice=1000&area=Voula"), true);
  assert.equal(menuState("/properties?listingType=RENT&minPrice=1000&area=Voula").rent, true);
});

test("TEST 6 — /submit: ΑΝΑΘΕΣΗ active, ΑΚΙΝΗΤΑ inactive", () => {
  assert.equal(isNavItemActive(topLevel("submit"), at("/submit")), true);
  assert.equal(propertiesActive("/submit"), false);
});

test("TEST 7 — /request: ΖΗΤΗΣΗ active, ΑΚΙΝΗΤΑ inactive", () => {
  assert.equal(isNavItemActive(topLevel("request"), at("/request")), true);
  assert.equal(propertiesActive("/request"), false);
});

test("remaining top-level routes resolve to themselves", () => {
  assert.equal(at("/"), "home");
  assert.equal(at("/about"), "about");
  assert.equal(at("/contact"), "contact");
  assert.equal(at("/areas/glyfada"), "areas");
  assert.equal(at("/valuation"), "valuation");
  assert.equal(at("/unrecognised"), null);
});

test("only one top-level item is highlighted per URL", () => {
  for (const url of [
    "/",
    "/properties",
    "/properties?listingType=SALE",
    "/properties?listingType=RENT",
    "/properties?listingType=SALE&area=Glyfada",
    "/submit",
    "/request",
    "/about",
    "/contact",
  ]) {
    const { active } = resolve(url);
    const count = NAV.filter((item) => isNavItemActive(item, active)).length;
    assert.equal(count, 1, `expected one active item for ${url}`);
  }
});

test("Πωλήσεις and Ενοικιάσεις are not top-level items", () => {
  assert.equal(NAV.some((item) => item.key === "sales" || item.key === "rentals"), false);
  assert.equal(PROPERTY_MENU.links[0]!.key, "sales");
  assert.equal(PROPERTY_MENU.links[1]!.key, "rentals");
});

test("invalid listingType never activates a transaction", () => {
  assert.equal(at("/properties?listingType=LEASE"), "properties");
  assert.equal(at("/properties?listingType="), "properties");
  assert.equal(normalizeListingType("PURCHASE"), null);
  assert.equal(normalizeListingType("sale"), "SALE");
  assert.equal(normalizeListingType("rent"), "RENT");
  assert.equal(normalizeListingType(undefined), null);
});

test("nav destinations agree with their active key", () => {
  for (const item of allNavLinks()) {
    assert.equal(at(item.href), item.key, `href ${item.href} should resolve to ${item.key}`);
  }
});
