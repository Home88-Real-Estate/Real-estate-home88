import assert from "node:assert/strict";
import { test } from "node:test";

import { priceChange } from "./price-history";

// Stand-in for Prisma's Decimal, which stringifies to its value.
const decimal = (value: string) => ({ toString: () => value });

test("no change when the amounts are equal across representations", () => {
  assert.equal(
    priceChange({ price: decimal("550000.00"), monthlyRent: null }, { price: 550000, monthlyRent: null }),
    null,
  );
});

test("records a price reduction", () => {
  assert.deepEqual(
    priceChange({ price: decimal("550000"), monthlyRent: null }, { price: 520000, monthlyRent: null }),
    { fromPrice: 550000, toPrice: 520000, fromMonthlyRent: null, toMonthlyRent: null },
  );
});

test("records a rent change and a price being cleared", () => {
  assert.deepEqual(
    priceChange({ price: 1000, monthlyRent: decimal("900") }, { price: null, monthlyRent: 950 }),
    { fromPrice: 1000, toPrice: null, fromMonthlyRent: 900, toMonthlyRent: 950 },
  );
});
