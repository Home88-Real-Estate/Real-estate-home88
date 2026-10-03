import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CORE_FIELDS,
  CORE_FLAGS,
  DETAIL_FIELDS,
  LISTING_PROFILES,
  PROPERTY_PROFILES,
  completeness,
  normalizeForProfile,
  requiredIssues,
} from "./property-profiles";

test("every profile references only defined fields", () => {
  for (const [type, profile] of Object.entries(PROPERTY_PROFILES)) {
    for (const key of profile.core) assert.ok(key in CORE_FIELDS, `${type}: core ${key}`);
    for (const key of profile.details) assert.ok(key in DETAIL_FIELDS, `${type}: detail ${key}`);
    for (const key of profile.features) assert.ok(key in CORE_FLAGS || DETAIL_FIELDS[key]?.kind === "bool", `${type}: feature ${key}`);
    for (const key of [...profile.required, ...profile.recommended]) {
      assert.ok(key in CORE_FIELDS || key in DETAIL_FIELDS, `${type}: required/recommended ${key}`);
    }
  }
  for (const [listing, profile] of Object.entries(LISTING_PROFILES)) {
    for (const key of profile.details) assert.ok(key in DETAIL_FIELDS, `${listing}: ${key}`);
  }
});

test("land never carries residential fields", () => {
  const { values } = normalizeForProfile({
    propertyType: "PLOT",
    listingType: "SALE",
    bedrooms: 5,
    bathrooms: 2,
    floor: 3,
    heating: "INDIVIDUAL",
    energyClass: "A",
    furnished: true,
    balcony: true,
    seaView: true,
    area: 1200,
    details: { buildingCoefficient: "0,4", frontage: "25", rooms: 48 },
  });
  assert.equal(values.bedrooms, null);
  assert.equal(values.bathrooms, null);
  assert.equal(values.floor, null);
  assert.equal(values.heating, "NOT_AVAILABLE");
  assert.equal(values.energyClass, "NOT_AVAILABLE");
  assert.equal(values.furnished, false);
  assert.equal(values.balcony, false);
  assert.equal(values.seaView, true, "sea view applies to land");
  assert.equal(values.area, 1200);
  assert.deepEqual(values.details, { buildingCoefficient: 0.4, frontage: 25 }, "hotel rooms dropped, numbers coerced");
});

test("parking: 5 bedrooms are ignored, parking type is required when active", () => {
  const { values } = normalizeForProfile({ propertyType: "PARKING", listingType: "SALE", bedrooms: 5, status: "ACTIVE", price: 15000 });
  assert.equal(values.bedrooms, null);
  const issues = requiredIssues(values);
  assert.deepEqual(issues.map((i) => i.path), ["details.parkingType"]);
});

test("drafts can be incomplete; active listings cannot", () => {
  const base = { propertyType: "APARTMENT", listingType: "SALE", details: {} };
  assert.deepEqual(requiredIssues({ ...base, status: "DRAFT" }), []);
  const paths = requiredIssues({ ...base, status: "ACTIVE" }).map((i) => i.path);
  assert.deepEqual(paths.sort(), ["area", "price"]);
  assert.deepEqual(requiredIssues({ ...base, status: "ACTIVE", area: "95", priceOnRequest: true }), []);
});

test("listing type decides the price field and its details", () => {
  const rent = normalizeForProfile({
    propertyType: "APARTMENT",
    listingType: "RENT",
    price: 300000,
    monthlyRent: 900,
    details: { deposit: "1800", valuation: "999" },
  }).values;
  assert.equal(rent.price, null);
  assert.equal(rent.monthlyRent, 900);
  assert.deepEqual(rent.details, { deposit: 1800 });
  assert.deepEqual(requiredIssues({ ...rent, status: "ACTIVE", area: 80 }), []);

  const sale = normalizeForProfile({ propertyType: "APARTMENT", listingType: "SALE", price: 300000, monthlyRent: 900 }).values;
  assert.equal(sale.monthlyRent, null);
});

test("invalid detail values are reported on their field", () => {
  const { issues } = normalizeForProfile({
    propertyType: "HOTEL",
    listingType: "ASSIGNMENT",
    details: { rooms: "πολλά", starRating: "7", assignmentEnd: "31/12/2026" },
  });
  assert.deepEqual(issues.map((i) => i.path).sort(), ["details.assignmentEnd", "details.rooms", "details.starRating"]);
});

test("condition must suit the type; land has none", () => {
  assert.equal(normalizeForProfile({ propertyType: "LAND", listingType: "SALE", condition: "RENOVATED" }).values.condition, "GOOD");
  const parking = normalizeForProfile({ propertyType: "PARKING", listingType: "SALE", condition: "RENOVATED" });
  assert.deepEqual(parking.issues.map((i) => i.path), ["condition"]);
});

test("completeness names what is missing, per type", () => {
  const hotel = completeness({ propertyType: "HOTEL", listingType: "SALE", titleEl: "Ξενοδοχείο", details: { rooms: 48 } });
  assert.ok(hotel.percent > 0 && hotel.percent < 100);
  assert.ok(hotel.missing.includes("Κλίνες"));
  assert.ok(!hotel.missing.includes("Υπνοδωμάτια"), "hotels have no bedrooms requirement");
});
