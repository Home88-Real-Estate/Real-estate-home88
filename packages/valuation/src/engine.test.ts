import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_CONFIG, normalizePlace, rateConfidence, runComparableEngine, similarity, weightedQuantile, type Candidate, type Subject } from "./engine";

const REF = new Date("2026-10-01T00:00:00Z");
const subject: Subject = {
  propertyType: "APARTMENT",
  areaSqm: 100,
  location: { region: "Αττική", city: "Γλυφάδα", area: "Άνω Γλυφάδα" },
  condition: "GOOD",
  yearBuilt: 2005,
  floor: 2,
  bedrooms: 2,
  features: { parking: true, storage: true, elevator: true },
};

let seq = 0;
function comp(over: Partial<Candidate> & { ppsqm?: number } = {}): Candidate {
  seq += 1;
  const areaSqm = over.areaSqm ?? 100;
  const ppsqm = over.ppsqm ?? 4000;
  return {
    id: over.id ?? `c${String(seq).padStart(3, "0")}`,
    source: "HOME88",
    observationType: "ASKING",
    propertyType: "APARTMENT",
    areaSqm,
    price: over.price ?? ppsqm * areaSqm,
    location: { region: "Αττική", city: "Γλυφάδα", area: "Άνω Γλυφάδα" },
    condition: "GOOD",
    yearBuilt: 2005,
    floor: 2,
    bedrooms: 2,
    features: { parking: true, storage: true, elevator: true },
    observedAt: "2026-08-01",
    ...over,
  };
}

const sameArea = (ppsqms: number[]) => ppsqms.map((p) => comp({ ppsqm: p }));

test("place names match regardless of case, accents and final sigma", () => {
  assert.equal(normalizePlace("ΓΛΥΦΑΔΑ"), normalizePlace("Γλυφάδα"));
  assert.equal(normalizePlace(" Άνω  Γλυφάδα "), "ανω γλυφαδα");
  assert.equal(normalizePlace("Βούλας"), normalizePlace("βουλασ"));
});

test("same property in the same neighbourhood: tight range around the market rate", () => {
  const r = runComparableEngine(subject, sameArea([3900, 3950, 4000, 4000, 4050, 4100, 3980, 4020, 4010, 3990]), { referenceDate: REF });
  assert.equal(r.status, "OK");
  if (r.status !== "OK") return;
  assert.equal(r.pricePerSqm, 4000);
  assert.equal(r.midpoint, 400_000);
  assert.ok(r.low < r.midpoint && r.high > r.midpoint);
  assert.equal(r.scope, "AREA");
  assert.equal(r.comparableCount, 10);
});

test("no comparables / too few comparables: INSUFFICIENT_DATA, never a number", () => {
  const none = runComparableEngine(subject, [], { referenceDate: REF });
  assert.equal(none.status, "INSUFFICIENT_DATA");
  const few = runComparableEngine(subject, sameArea([4000, 4100, 3900]), { referenceDate: REF });
  assert.equal(few.status, "INSUFFICIENT_DATA");
  if (few.status === "INSUFFICIENT_DATA") assert.equal(few.reason, "not_enough_comparables");
});

test("invalid subject area is refused", () => {
  const r = runComparableEngine({ ...subject, areaSqm: 0 }, sameArea([4000, 4000, 4000, 4000, 4000]), { referenceDate: REF });
  assert.equal(r.status, "INSUFFICIENT_DATA");
  if (r.status === "INSUFFICIENT_DATA") assert.equal(r.reason, "invalid_subject");
});

test("one abnormal listing does not move the result (IQR outlier screen)", () => {
  const base = [3100, 3250, 3400, 3450, 3520, 3600];
  const clean = runComparableEngine(subject, sameArea(base), { referenceDate: REF });
  const dirty = runComparableEngine(subject, sameArea([...base, 8900]), { referenceDate: REF });
  assert.equal(clean.status, "OK");
  assert.equal(dirty.status, "OK");
  if (clean.status !== "OK" || dirty.status !== "OK") return;
  assert.equal(dirty.outliersRemoved, 1);
  assert.equal(dirty.pricePerSqm, clean.pricePerSqm);
  assert.ok(dirty.comparables.some((c) => c.outlier && c.pricePerSqm === 8900));
});

test("a different property-type family is never used", () => {
  const shops = Array.from({ length: 8 }, () => comp({ propertyType: "SHOP", ppsqm: 9000 }));
  const r = runComparableEngine(subject, shops, { referenceDate: REF });
  assert.equal(r.status, "INSUFFICIENT_DATA");
  // ... but a studio is in the apartment family and still counts, at lower similarity.
  const sim = similarity(subject, comp({ propertyType: "STUDIO" }), "AREA");
  assert.ok(sim && sim.breakdown.type === 0.5);
});

test("sizes outside 50%–200% of the subject are not comparable", () => {
  const tiny = Array.from({ length: 6 }, () => comp({ areaSqm: 40, ppsqm: 4000 }));
  const huge = Array.from({ length: 6 }, () => comp({ areaSqm: 250, ppsqm: 4000 }));
  assert.equal(runComparableEngine(subject, [...tiny, ...huge], { referenceDate: REF }).status, "INSUFFICIENT_DATA");
});

test("geography widens only when needed, and the result says so", () => {
  const sameCity = Array.from({ length: 10 }, (_, i) => comp({ ppsqm: 3600 + i * 10, location: { region: "Αττική", city: "Γλυφάδα", area: "Κάτω Γλυφάδα" } }));
  const near = sameArea([4000, 4010, 3990, 4020, 3980, 4005, 3995, 4015, 3985]); // 9 strong in the same area
  const local = runComparableEngine(subject, [...near, ...sameCity], { referenceDate: REF });
  assert.equal(local.status, "OK");
  if (local.status === "OK") {
    assert.equal(local.scope, "AREA");
    assert.ok(local.comparables.every((c) => c.tier === "AREA"), "city comparables not pulled in when the area suffices");
    assert.equal(local.tierCounts.CITY, 10);
  }
  const widened = runComparableEngine(subject, [...near.slice(0, 2), ...sameCity], { referenceDate: REF });
  assert.equal(widened.status, "OK");
  if (widened.status === "OK") {
    assert.equal(widened.scope, "CITY");
    assert.ok(widened.confidenceReasons.some((r) => r.includes("πόλη")));
  }
  const otherCity = Array.from({ length: 10 }, () => comp({ location: { region: "Θεσσαλονίκη", city: "Καλαμαριά", area: "Κέντρο" } }));
  assert.equal(runComparableEngine(subject, otherCity, { referenceDate: REF }).status, "INSUFFICIENT_DATA");
});

test("recent and recorded transactions weigh more than old asking prices", () => {
  const fresh = comp({ observedAt: "2026-09-01", observationType: "TRANSACTION" });
  const old = comp({ observedAt: "2024-09-01" });
  const r = runComparableEngine(subject, [old, fresh, ...sameArea([4000, 4000, 4000, 4000])], { referenceDate: REF });
  assert.equal(r.status, "OK");
  if (r.status !== "OK") return;
  const w = (id: string) => r.comparables.find((c) => c.id === id)!.weight;
  assert.ok(w(fresh.id) > w(old.id));
  assert.equal(r.transactionCount, 1);
  // Older than five years is not used at all.
  const ancient = runComparableEngine(subject, Array.from({ length: 6 }, () => comp({ observedAt: "2019-01-01" })), { referenceDate: REF });
  assert.equal(ancient.status, "INSUFFICIENT_DATA");
});

test("missing optional fields still work, with lower similarity than a full match", () => {
  const bare: Subject = { propertyType: "APARTMENT", areaSqm: 100, location: { city: "Γλυφάδα", area: "Άνω Γλυφάδα" } };
  const r = runComparableEngine(bare, sameArea([4000, 4100, 3900, 4050, 3950]), { referenceDate: REF });
  assert.equal(r.status, "OK");
  const full = similarity(subject, comp(), "AREA")!;
  const partial = similarity(subject, comp({ condition: null, yearBuilt: null, floor: null, bedrooms: null, features: {} }), "AREA")!;
  assert.ok(full.score > partial.score);
  assert.equal(full.score, 1);
});

test("invalid prices and areas are ignored", () => {
  const junk = [comp({ price: 0 }), comp({ areaSqm: 0 }), comp({ ppsqm: 50 }), comp({ ppsqm: 90_000 })];
  assert.equal(runComparableEngine(subject, junk, { referenceDate: REF }).status, "INSUFFICIENT_DATA");
});

test("same input + same data + same version → identical result (order independent)", () => {
  const data = sameArea([3900, 3950, 4000, 4000, 4050, 4100, 3980, 4020, 4010, 3990, 4500, 3700]);
  const a = runComparableEngine(subject, data, { referenceDate: REF });
  const b = runComparableEngine(subject, [...data].reverse(), { referenceDate: REF });
  assert.deepEqual(a, b);
  assert.equal(a.engineVersion, "HV1.0.0");
  assert.equal(a.methodologyVersion, DEFAULT_CONFIG.methodologyVersion);
});

test("confidence: many close, consistent, recent comparables → HIGH; few/wide/dispersed → LOW", () => {
  assert.equal(rateConfidence({ count: 20, strong: 12, dispersion: 0.05, scope: "AREA", medianAge: 3 }).level, "HIGH");
  assert.equal(rateConfidence({ count: 9, strong: 4, dispersion: 0.2, scope: "CITY", medianAge: 6 }).level, "MEDIUM");
  assert.equal(rateConfidence({ count: 5, strong: 1, dispersion: 0.4, scope: "REGION", medianAge: 30 }).level, "LOW");
});

test("weighted median follows the weights", () => {
  assert.equal(weightedQuantile([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 10, w: 5 }], 0.5), 10);
  assert.equal(weightedQuantile([{ v: 1, w: 1 }, { v: 3, w: 1 }], 0.5), 2);
});

test("the range is never presented narrower than ±5%", () => {
  const r = runComparableEngine(subject, sameArea([4000, 4000, 4000, 4000, 4000, 4000]), { referenceDate: REF });
  assert.equal(r.status, "OK");
  if (r.status === "OK") {
    assert.equal(r.low, 380_000);
    assert.equal(r.high, 420_000);
  }
});
