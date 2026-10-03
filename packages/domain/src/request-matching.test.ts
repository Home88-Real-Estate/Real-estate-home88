import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeText, scoreMatch, type MatchProperty, type MatchRequest } from "./request-matching";

const request: MatchRequest = {
  listingType: "SALE",
  propertyTypes: ["APARTMENT", "MAISONETTE"],
  areas: ["Γλυφάδα"],
  minPrice: 300000,
  maxPrice: 450000,
  minArea: 90,
  maxArea: null,
  minBedrooms: 2,
  minBathrooms: null,
  minFloor: null,
  minYearBuilt: null,
  features: ["parking", "storage"],
};

const property: MatchProperty = {
  listingType: "SALE",
  propertyType: "APARTMENT",
  status: "ACTIVE",
  price: 420000,
  area: 105,
  bedrooms: 3,
  areaName: "ΓΛΥΦΑΔΑ",
  city: "Αθήνα",
  flags: { parking: true, storage: false },
};

test("hard rules: listing type, property type, on the market", () => {
  assert.equal(scoreMatch(request, { ...property, listingType: "RENT" }), null);
  assert.equal(scoreMatch(request, { ...property, propertyType: "OFFICE" }), null);
  assert.equal(scoreMatch(request, { ...property, status: "SOLD" }), null);
  assert.ok(scoreMatch({ ...request, propertyTypes: [] }, { ...property, propertyType: "VILLA" }), "no types = any type");
});

test("score is the weighted share of stated criteria, with reasons", () => {
  const result = scoreMatch(request, property)!;
  // area 25 + price 30 + size 15 + bedrooms 10 + parking 5 = 85 of 90
  assert.equal(result.score, Math.round((85 / 90) * 100));
  assert.ok(result.missing.includes("Αποθήκη"));
  assert.ok(result.matched.some((m) => m.startsWith("Περιοχή")));
});

test("area names match without accents or case", () => {
  assert.equal(normalizeText("Γλυφάδα"), normalizeText("ΓΛΥΦΑΔΑ"));
  assert.equal(normalizeText("Βουλιαγμένης"), "βουλιαγμενησ");
  const voula = scoreMatch({ ...request, areas: ["βουλα"] }, { ...property, areaName: "Βούλα" })!;
  assert.ok(voula.matched.some((m) => m.startsWith("Περιοχή")));
});

test("price allows 5% above the maximum; price on request never counts as met", () => {
  assert.ok(scoreMatch(request, { ...property, price: 470000 })!.matched.some((m) => m.startsWith("Τιμή")));
  assert.ok(scoreMatch(request, { ...property, price: 480000 })!.missing.some((m) => m.startsWith("Τιμή")));
  assert.ok(scoreMatch(request, { ...property, priceOnRequest: true })!.missing.some((m) => m.startsWith("Τιμή")));
});

test("rent requests compare monthly rent", () => {
  const rent = scoreMatch(
    { ...request, listingType: "RENT", minPrice: null, maxPrice: 1200, areas: [], features: [], minArea: null, minBedrooms: null },
    { ...property, listingType: "RENT", price: null, monthlyRent: 1100 },
  )!;
  assert.equal(rent.score, 100);
});

test("a request with no criteria matches fully", () => {
  const bare: MatchRequest = { listingType: "SALE", propertyTypes: [], areas: [], features: [] };
  assert.deepEqual(scoreMatch(bare, property), { score: 100, matched: [], missing: [] });
});
