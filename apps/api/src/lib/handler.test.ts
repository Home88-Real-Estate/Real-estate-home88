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

test("forgot-password: malformed email is a validation error, not a crash", async () => {
  const response = await handleApiRequest(
    new Request("http://crm.test/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    }),
  );
  assert.ok(response.status === 400 || response.status === 422, `status ${response.status}`);
});

test("forgot-password: an unreachable database is a controlled 503", async () => {
  const response = await handleApiRequest(
    new Request("http://crm.test/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ email: "someone@example.com" }),
    }),
  );
  assert.equal(response.status, 503);
  const body = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "database_unavailable");
  assert.ok(!JSON.stringify(body).includes("127.0.0.1"), "no connection details leak");
});

test("database diagnosis names the cause without secrets", async () => {
  const { diagnoseDatabaseError, describeDatabaseUrl } = await import("../handler");
  assert.match(diagnoseDatabaseError({ errorCode: "P1000", message: "x" }).reason, /password/);
  assert.match(diagnoseDatabaseError({ message: "FATAL: Tenant or user not found" }).reason, /postgres\.<project-ref>/);
  assert.match(diagnoseDatabaseError({ errorCode: "P1013" }).reason, /percent-encoded/);

  const target = describeDatabaseUrl(
    "postgresql://postgres.abc:s3cretPass@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true",
  );
  assert.equal(target.user, "postgres.abc");
  assert.equal(target.host, "aws-0-eu-west-2.pooler.supabase.com");
  assert.equal(target.port, "6543");
  assert.equal(target.pgbouncer, true);
  assert.ok(!JSON.stringify(target).includes("s3cretPass"), "password never shown");

  const broken = describeDatabaseUrl("postgresql://postgres.abc:pa?ss#@host:6543/postgres");
  assert.ok(!JSON.stringify(broken).includes("pa?ss"), "password never shown");
});

test("reminders, viewings and requests require a signed-in user", async () => {
  for (const [method, path] of [
    ["GET", "/api/tasks"],
    ["POST", "/api/tasks"],
    ["GET", "/api/viewings?from=2026-10-01&to=2026-10-08"],
    ["POST", "/api/viewings"],
    ["GET", "/api/requests"],
    ["POST", "/api/requests"],
    ["GET", "/api/properties/x/matching-requests"],
  ] as const) {
    const response = await handleApiRequest(
      new Request(`http://crm.test${path}`, {
        method,
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        ...(method === "POST" ? { body: "{}" } : {}),
      }),
    );
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("settings routes require a session and never answer anonymously", async () => {
  for (const [method, path] of [
    ["GET", "/api/settings"],
    ["GET", "/api/settings/sections/email"],
    ["PUT", "/api/settings/sections/email"],
    ["GET", "/api/settings/permissions"],
    ["PUT", "/api/settings/permissions"],
    ["GET", "/api/settings/audit"],
    ["GET", "/api/settings/portals/SPITOGATOS"],
    ["POST", "/api/settings/email/test"],
  ] as const) {
    const response = await handleApiRequest(
      new Request(`http://crm.test${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify({ values: {}, secrets: { smtpPassword: "x" } }),
      }),
    );
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});
