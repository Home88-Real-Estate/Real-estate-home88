import assert from "node:assert/strict";
import { test } from "node:test";

import { estimateValuation, roundEstimate, type Comparable, type ValuationInput } from "./estimate";

const REF = 2026;

function comp(price: number, area: number, propertyType = "APARTMENT"): Comparable {
  return { price, area, propertyType };
}

function flat(perSqm: number, area = 100, propertyType = "APARTMENT"): Comparable {
  return comp(perSqm * area, area, propertyType);
}

const subject: ValuationInput = { propertyType: "APARTMENT", area: 100 };

test("refuses an implausible subject area rather than estimating", () => {
  const result = estimateValuation({ ...subject, area: 0 }, [flat(2000)]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_area");
});

test("refuses to estimate below the comparable threshold", () => {
  const result = estimateValuation(subject, [flat(2000), flat(2000), flat(2000), flat(2000)]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "insufficient_comparables");
    assert.equal(result.comparableCount, 4);
    assert.equal(result.required, 5);
  }
});

test("uses the comparable median as the base when there are no subject attributes", () => {
  const result = estimateValuation(subject, [flat(2000), flat(2000), flat(2000), flat(2000), flat(2000)]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.estimate, 200_000);
    assert.equal(result.pricePerSqm, 2000);
    assert.equal(result.comparableCount, 5);
    assert.equal(result.baseOnly, true);
    assert.deepEqual(result.adjustments, []);
  }
});

test("prefers like-for-like property types over a broader pool", () => {
  const comparables = [
    flat(2000, 100, "APARTMENT"),
    flat(2000, 100, "APARTMENT"),
    flat(2000, 100, "APARTMENT"),
    flat(2000, 100, "APARTMENT"),
    flat(2000, 100, "APARTMENT"),
    flat(10_000, 100, "SHOP"),
    flat(10_000, 100, "SHOP"),
    flat(10_000, 100, "SHOP"),
  ];
  const result = estimateValuation(subject, comparables);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.pricePerSqm, 2000);
    assert.equal(result.comparableCount, 5);
  }
});

test("drops out-of-band €/m² records as outliers", () => {
  const comparables = [
    flat(2000),
    flat(2000),
    flat(2000),
    flat(2000),
    flat(2000),
    flat(100),
    flat(100_000),
  ];
  const result = estimateValuation(subject, comparables);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.comparableCount, 5);
});

test("returns each adjustment as a line item and moves the estimate", () => {
  const result = estimateValuation(
    {
      ...subject,
      yearBuilt: REF - 30,
      condition: "NEEDS_RENOVATION",
      floor: 0,
      totalFloors: 5,
      parking: true,
      seaView: true,
    },
    [flat(2000), flat(2000), flat(2000), flat(2000), flat(2000)],
    { referenceYear: REF },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.baseOnly, false);
    assert.equal(result.adjustments.length, 5);
    assert.ok(result.estimate < 200_000);
    assert.ok(result.adjustments.some((a) => a.label === "Parking" && a.factor > 0));
    assert.ok(result.adjustments.some((a) => a.factor < 0));
  }
});

test("rounds to a quotable figure", () => {
  assert.equal(roundEstimate(300_000), 300_000);
  assert.equal(roundEstimate(123_456), 123_000);
  assert.equal(roundEstimate(48_700), 48_500);
  const result = estimateValuation(subject, [flat(3000), flat(3000), flat(3000), flat(3000), flat(3000)]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.estimate % 5000, 0);
  }
});

test("more comparables produce a tighter range", () => {
  const few = [flat(2000), flat(2050), flat(2100), flat(1950), flat(2000)];
  const many: Comparable[] = [];
  for (let i = 0; i < 40; i += 1) many.push(flat(2000 + i * 5));

  const a = estimateValuation(subject, few);
  const b = estimateValuation(subject, many);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    const spreadA = (a.high - a.low) / a.estimate;
    const spreadB = (b.high - b.low) / b.estimate;
    assert.ok(spreadB < spreadA, `expected ${spreadB} < ${spreadA}`);
  }
});
