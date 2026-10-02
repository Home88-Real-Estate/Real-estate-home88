import assert from "node:assert/strict";
import { test } from "node:test";

// The API validates its environment at boot; health and validation paths do
// not touch the database, so a placeholder URL is enough here.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";

const { handleApiRequest } = await import("../handler");

test("health answers through the in-process adapter, on both paths", async () => {
  for (const path of ["/health", "/api/health"]) {
    const response = await handleApiRequest(new Request(`http://crm.test${path}`));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string };
    assert.equal(body.status, "ok");
  }
});

test("request bodies and API errors pass through unchanged", async () => {
  const response = await handleApiRequest(
    new Request("http://crm.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    }),
  );
  assert.ok(response.status >= 400 && response.status < 500, `status ${response.status}`);
  const body = (await response.json()) as { error: { code: string } };
  assert.ok(body.error.code);
});

test("unknown routes are a JSON 404, and the CSRF origin check still runs", async () => {
  const missing = await handleApiRequest(new Request("http://crm.test/api/nope"));
  assert.equal(missing.status, 404);

  const foreign = await handleApiRequest(
    new Request("http://crm.test/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }),
  );
  assert.equal(foreign.status, 403);
});
