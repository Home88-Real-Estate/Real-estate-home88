import assert from "node:assert/strict";
import { test } from "node:test";

import { canMoveSeller, comparableSimilarity, daysBetween, nextSellerStages, valuate } from "./valuation";

test("valuation refuses without area or comparables", () => {
  const r = valuate(null, []);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.missing.length, 2);
  const excluded = valuate(90, [{ price: 200000, area: 100, included: false }]);
  assert.equal(excluded.ok, false);
});

test("valuation: median, min–max range below four comparables, adjustments", () => {
  const r = valuate(100, [
    { price: 200000, area: 100 }, // 2000/m²
    { price: 330000, area: 150 }, // 2200/m²
    { price: 180000, area: 100, adjustmentPct: 10 }, // 1800 → 1980/m²
  ]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.adjustedPerSqm, [2000, 2200, 1980]);
    assert.equal(r.medianPerSqm, 2000);
    assert.equal(r.lowPerSqm, 1980);
    assert.equal(r.highPerSqm, 2200);
    assert.equal(r.estimate, 200000);
    assert.equal(r.low, 198000);
    assert.equal(r.high, 220000);
    assert.equal(r.confidence, "MEDIUM");
  }
});

test("valuation: interquartile range from four comparables, outlier does not stretch it, adjustment capped", () => {
  const r = valuate(80, [
    { price: 160000, area: 80 }, // 2000
    { price: 168000, area: 80 }, // 2100
    { price: 176000, area: 80 }, // 2200
    { price: 400000, area: 80 }, // 5000 outlier
    { price: 100000, area: 100, adjustmentPct: 90 }, // 1000 → capped +50% → 1500
  ]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.count, 5);
    assert.equal(r.adjustedPerSqm[4], 1500);
    assert.equal(r.medianPerSqm, 2100);
    assert.equal(r.lowPerSqm, 2000);
    assert.equal(r.highPerSqm, 2200);
    assert.equal(r.estimate, 168000);
    assert.equal(r.confidence, "LOW", "wide dispersion");
  }
  const tight = valuate(100, [1990, 2000, 2010, 2020, 1980].map((p) => ({ price: p * 100, area: 100 })));
  assert.ok(tight.ok && tight.confidence === "HIGH");
});

test("comparable similarity ranks location and size first", () => {
  const subject = { area: 100, city: "Αθήνα", areaName: "Κουκάκι", bedrooms: 2, yearBuilt: 1990, floor: 2, condition: "GOOD" };
  const same = comparableSimilarity(subject, { ...subject, price: 1 });
  const otherArea = comparableSimilarity(subject, { ...subject, areaName: "Παγκράτι", price: 1 });
  const bigger = comparableSimilarity(subject, { ...subject, area: 110, price: 1 });
  const muchBigger = comparableSimilarity(subject, { ...subject, area: 150, price: 1 });
  assert.equal(same, 100);
  assert.ok(otherArea < same && otherArea >= 70);
  assert.ok(bigger < same && bigger > otherArea);
  assert.ok(muchBigger < otherArea, "location outweighs a large size gap");
  assert.equal(comparableSimilarity({ area: null }, { area: 80, price: 1 }), 0);
});

test("seller pipeline moves and day counts", () => {
  assert.ok(canMoveSeller("NEW", "VALUATION"));
  assert.ok(canMoveSeller("PROPOSAL", "CONTACTED"));
  assert.ok(canMoveSeller("MANDATE", "LISTED"));
  assert.ok(canMoveSeller("VALUATION", "LOST"));
  assert.ok(canMoveSeller("LOST", "NEW"));
  assert.ok(!canMoveSeller("LOST", "LISTED"));
  assert.ok(!canMoveSeller("LISTED", "NEW"));
  assert.deepEqual(nextSellerStages("LISTED"), []);
  assert.equal(daysBetween("2026-01-01T00:00:00Z", "2026-01-31T12:00:00Z"), 30);
  assert.equal(daysBetween("2026-02-01", "2026-01-01"), 0);
});
