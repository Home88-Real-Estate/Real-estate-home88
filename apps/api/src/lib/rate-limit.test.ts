import assert from "node:assert/strict";
import { test } from "node:test";
import { consume, resetRateLimits } from "./rate-limit";

test("a bucket allows up to its budget then blocks with a retry hint", () => {
  resetRateLimits();
  const rule = { points: 3, durationSeconds: 900 };

  assert.equal(consume("k", rule).allowed, true);
  assert.equal(consume("k", rule).allowed, true);
  assert.equal(consume("k", rule).allowed, true);

  const blocked = consume("k", rule);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  resetRateLimits();
});

test("keys are independent", () => {
  resetRateLimits();
  const rule = { points: 1, durationSeconds: 900 };
  assert.equal(consume("a", rule).allowed, true);
  assert.equal(consume("a", rule).allowed, false);
  assert.equal(consume("b", rule).allowed, true);
  resetRateLimits();
});
