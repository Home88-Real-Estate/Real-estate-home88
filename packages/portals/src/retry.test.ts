import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyError,
  decideRetry,
  DEFAULT_RETRY_POLICY,
  isRetryDue,
  normaliseErrorCode,
  retryPolicyFromSettings,
} from "./index";

const NOW = new Date("2026-10-03T12:00:00Z");

test("timeouts, rate limits and server errors are transient; the rest are permanent", () => {
  for (const code of ["REMOTE_TIMEOUT", "RATE_LIMITED", "REMOTE_SERVER_ERROR"]) assert.equal(classifyError(code), "TRANSIENT", code);
  for (const code of ["AUTH_FAILED", "INVALID_CREDENTIALS", "MISSING_REQUIRED_FIELD", "UNSUPPORTED_PROPERTY_TYPE", "INVALID_PRICE", "INVALID_LOCATION", "IMAGE_UNAVAILABLE", "PORTAL_REJECTED", "TRANSPORT_UNAVAILABLE"]) {
    assert.equal(classifyError(code), "PERMANENT", code);
  }
});

test("unknown or missing codes are retried, but only within the attempt budget", () => {
  assert.equal(classifyError("SOMETHING_NEW"), "TRANSIENT");
  assert.equal(classifyError(null), "TRANSIENT");
  assert.equal(decideRetry({ attempts: DEFAULT_RETRY_POLICY.maxAttempts, errorCode: "SOMETHING_NEW", now: NOW }).action, "DEAD_LETTER");
});

test("the legacy lowercase transport code maps onto the taxonomy", () => {
  assert.equal(normaliseErrorCode("api_transport_unavailable"), "TRANSPORT_UNAVAILABLE");
  assert.equal(classifyError("api_transport_unavailable"), "PERMANENT");
});

test("a permanent error is parked immediately, never retried", () => {
  const d = decideRetry({ attempts: 1, errorCode: "PORTAL_REJECTED", now: NOW });
  assert.equal(d.action, "DEAD_LETTER");
  assert.equal(d.nextRetryAt, null);
});

test("transient failures back off exponentially up to a cap", () => {
  const policy = { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 5000 };
  const delays = [1, 2, 3, 4, 5].map((attempts) => {
    const d = decideRetry({ attempts, errorCode: "RATE_LIMITED", policy, now: NOW });
    assert.equal(d.action, "RETRY");
    return d.delayMs;
  });
  assert.deepEqual(delays, [1000, 2000, 4000, 5000, 5000]);
  const first = decideRetry({ attempts: 1, errorCode: "REMOTE_TIMEOUT", policy, now: NOW });
  assert.equal(first.action === "RETRY" && first.nextRetryAt.getTime(), NOW.getTime() + 1000);
});

test("a transient failure is dead-lettered when the budget is spent", () => {
  const policy = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000 };
  assert.equal(decideRetry({ attempts: 2, errorCode: "REMOTE_TIMEOUT", policy, now: NOW }).action, "RETRY");
  const last = decideRetry({ attempts: 3, errorCode: "REMOTE_TIMEOUT", policy, now: NOW });
  assert.equal(last.action, "DEAD_LETTER");
  assert.match(last.reason, /3 attempts/);
});

test("retry timing is respected and parked listings are never due", () => {
  assert.equal(isRetryDue({ needsReview: false, nextRetryAt: null, now: NOW }), true);
  assert.equal(isRetryDue({ needsReview: false, nextRetryAt: new Date(NOW.getTime() + 1), now: NOW }), false);
  assert.equal(isRetryDue({ needsReview: false, nextRetryAt: NOW, now: NOW }), true);
  assert.equal(isRetryDue({ needsReview: true, nextRetryAt: null, now: NOW }), false);
});

test("retry limits are configurable and sanitised", () => {
  const p = retryPolicyFromSettings({ retry: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 100 } });
  assert.equal(p.maxAttempts, 2);
  assert.equal(p.baseDelayMs, 500);
  assert.equal(p.maxDelayMs, 500, "cap never below the base delay");
  assert.deepEqual(retryPolicyFromSettings({ retry: { maxAttempts: -1, baseDelayMs: "x" } }), DEFAULT_RETRY_POLICY);
  assert.deepEqual(retryPolicyFromSettings(null), DEFAULT_RETRY_POLICY);
});
