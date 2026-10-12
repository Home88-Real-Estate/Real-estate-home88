/**
 * An account whose id is a UUID (created outside the app, as the production administrator was) can save the
 * assistant's draft and be chosen as a property's agent. Real API and Postgres; runs only with TEST_DATABASE_URL.
 */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("property intake: a UUID account saves its draft as a property", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");

  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const id = randomUUID();
  const user = await db().user.create({ data: { id, email: `uuidadmin-${run}@test.invalid`, firstName: "U", lastName: "Test", role: "SUPER_ADMIN" as never, passwordHash: hashPassword(password, 10) } });
  const login = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password }) }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, text, body: (text ? JSON.parse(text) : null) as any };
  };

  const session = (await call("POST", "/property-intake/sessions", { language: "el" })).body.session;
  const set = (key: string, value: unknown) => call("POST", `/property-intake/sessions/${session.id}/edit`, { edit: { type: "set", key, value } });
  for (const [k, v] of [["listingType", "SALE"], ["propertyType", "APARTMENT"], ["price", 280000], ["area", 85], ["areaName", "Σητεία"], ["bedrooms", 2], ["titleEl", "Διαμέρισμα 85 τ.μ. στη Σητεία"], ["descriptionEl", "Διαμέρισμα 85 τ.μ. με δύο υπνοδωμάτια."]] as const) {
    const r = await set(k, v);
    assert.equal(r.status, 200, `${k}: ${r.text}`);
  }
  const before = (await call("GET", `/property-intake/sessions/${session.id}`)).body.session;
  assert.equal(before.review.ready, true, JSON.stringify(before.review.blockers));
  const created = await call("POST", `/property-intake/sessions/${session.id}/create`, { revision: before.revision });
  assert.equal(created.status, 201, created.text);
  const property = await db().property.findUniqueOrThrow({ where: { id: created.body.property.id } });
  assert.equal(property.agentId, id, "the UUID account is the agent");
  assert.equal(property.status, "DRAFT");

  // The regular form accepts the same account as agent.
  const form = await call("POST", "/properties", { listingType: "SALE", propertyType: "APARTMENT", titleEl: "Δοκιμή", descriptionEl: "Περιγραφή", price: 100000, area: 50, status: "DRAFT", agentId: id });
  assert.ok([200, 201].includes(form.status), form.text);
});
