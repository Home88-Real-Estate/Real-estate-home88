import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateCommission, canMoveTransaction, commissionDisplayStatus } from "./commission";

const RULES = { saleCommissionPct: 2, rentCommissionMonths: 1, agentSharePct: 40, agencySharePct: 60, vatMode: "EXCLUSIVE", vatRatePct: 24 } as const;

test("no configured rules: reports what is missing, never guesses a rate", () => {
  const r = calculateCommission({ type: "SALE", amount: 300000, rules: {} });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.missing.length, 5);
    assert.ok(r.missing.some((m) => m.includes("Πώληση")));
  }
});

test("sale, VAT on top, agent/agency split on the net", () => {
  const r = calculateCommission({ type: "SALE", amount: 465000, rules: RULES });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.breakdown.net, 9300);
    assert.equal(r.breakdown.vat, 2232);
    assert.equal(r.breakdown.gross, 11532);
    assert.equal(r.breakdown.agentShare, 3720);
    assert.equal(r.breakdown.agencyShare, 5580);
  }
});

test("both sides, VAT included, minimum fee, rental months, override", () => {
  const sides = calculateCommission({ type: "SALE", amount: 200000, rules: { ...RULES, buyerSidePct: 1, sellerSidePct: 2, vatMode: "INCLUSIVE" } });
  assert.ok(sides.ok);
  if (sides.ok) {
    assert.equal(sides.breakdown.buyerSide, 2000);
    assert.equal(sides.breakdown.sellerSide, 4000);
    assert.equal(sides.breakdown.gross, 6000);
    assert.equal(sides.breakdown.net + sides.breakdown.vat, 6000);
    assert.equal(sides.breakdown.net, 4838.71);
  }
  const min = calculateCommission({ type: "SALE", amount: 20000, rules: { ...RULES, minimumFee: 1000 } });
  assert.ok(min.ok && min.breakdown.minimumApplied && min.breakdown.net === 1000);
  const rent = calculateCommission({ type: "RENT", amount: 1250, rules: RULES });
  assert.ok(rent.ok && rent.breakdown.net === 1250 && rent.breakdown.basis === "MONTHS");
  const over = calculateCommission({ type: "SALE", amount: 100000, rules: RULES, overrideRate: 1.5 });
  assert.ok(over.ok && over.breakdown.net === 1500 && over.breakdown.rate === 1.5);
});

test("transaction moves and derived overdue status", () => {
  assert.equal(canMoveTransaction("NEGOTIATION", "AGREEMENT"), true);
  assert.equal(canMoveTransaction("NEGOTIATION", "CLOSED"), false);
  assert.equal(canMoveTransaction("CLOSED", "CANCELLED"), false);
  assert.equal(commissionDisplayStatus("INVOICED", "2026-01-01", new Date("2026-10-03")), "OVERDUE");
  assert.equal(commissionDisplayStatus("PAID", "2026-01-01", new Date("2026-10-03")), "PAID");
});
