import assert from "node:assert/strict";
import { test } from "node:test";

// This file runs in its own process: the API is deliberately left without a
// database URL so it cannot start.
delete process.env.DATABASE_URL;

const { apiReadiness, handleApiRequest } = await import("../handler");

test("an API that cannot start answers a controlled 503, not an exception", async () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  try {
    const response = await handleApiRequest(
      new Request("http://crm.test/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "someone@example.com" }),
      }),
    );
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "api_unavailable");
    assert.match(body.error.message, /προσωρινά διαθέσιμη/);
  } finally {
    console.error = original;
  }
  // The log names the variable to fix.
  assert.ok(errors.some((line) => String(line).includes("DATABASE_URL (missing)")), String(errors));
});

test("readiness names the missing variable and nothing else", async () => {
  const readiness = await apiReadiness();
  assert.equal(readiness.status, "unavailable");
  assert.equal(readiness.api, "down");
  assert.deepEqual(readiness.configuration, [{ variable: "DATABASE_URL", problem: "missing" }]);
});
