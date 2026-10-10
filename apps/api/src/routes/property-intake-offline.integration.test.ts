/**
 * Property intake, offline drafts and location: a draft started on a device
 * without signal syncs exactly once, however often the sync is retried, and
 * the property's public coordinates follow the visibility the agent chose.
 * Real API and Postgres; no AI is involved. Runs only with TEST_DATABASE_URL set.
 */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("property intake: offline drafts sync once; location visibility", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_Property_Intake;
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { setIntakeAi } = await import("../lib/property-intake/ai");
  setIntakeAi(null);

  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: "AGENT" as never, passwordHash: hash } });
  const [agent, other] = await Promise.all([mk("offagent"), mk("offagent2")]);
  const login = async (email: string) => {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };
  const [agentC, otherC] = await Promise.all([login(agent.email), login(other.email)]);
  const call = async (cookie: string, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) };
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };
  const edit = (cookie: string, id: string, e: object, revision?: number) => call(cookie, "POST", `/property-intake/sessions/${id}/edit`, { edit: e, revision });

  // === A retried start returns the same draft ===============================
  const ref = randomUUID();
  const first = await call(agentC, "POST", "/property-intake/sessions", { language: "el", clientRef: ref });
  assert.equal(first.status, 201);
  const again = await call(agentC, "POST", "/property-intake/sessions", { language: "el", clientRef: ref });
  assert.equal(again.body.session.id, first.body.session.id, "the same device draft is one session");
  assert.equal(await db().propertyIntakeSession.count({ where: { userId: agent.id, state: { path: ["clientRef"], equals: ref } } }), 1);
  const otherSame = await call(otherC, "POST", "/property-intake/sessions", { language: "el", clientRef: ref });
  assert.notEqual(otherSame.body.session.id, first.body.session.id, "another agent never receives this agent's draft");
  const plain = await call(agentC, "POST", "/property-intake/sessions", { language: "el" });
  assert.notEqual(plain.body.session.id, first.body.session.id, "without a device id every start is a new draft");
  assert.equal((await call(agentC, "POST", "/property-intake/sessions", { clientRef: "short" })).status, 422);
  assert.equal((await call(agentC, "POST", "/property-intake/sessions", { clientRef: "x".repeat(20) + "'; drop" })).status, 422);

  // === Location ==============================================================
  const id = first.body.session.id as string;
  assert.equal(first.body.session.location, null);
  for (const bad of [
    { type: "location", lat: 95, lng: 23, source: "gps", visibility: "exact" },
    { type: "location", lat: 37.9, lng: 23.7, source: "satellite", visibility: "exact" },
    { type: "location", lat: 37.9, lng: 23.7, source: "gps", visibility: "everyone" },
    { type: "location", lat: 37.9, source: "gps", visibility: "exact" },
    { type: "location", lat: 0, lng: 0, source: "manual", visibility: "exact" },
  ]) assert.equal((await edit(agentC, id, bad)).status, 422, JSON.stringify(bad));

  let r = await edit(agentC, id, { type: "location", lat: 37.8654321, lng: 23.7543219, accuracy: 12.4, source: "gps", visibility: "approximate" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.session.location.lat, 37.8654321);
  assert.equal(r.body.session.location.accuracy, 12);
  assert.deepEqual(r.body.session.location.public, { latitude: 37.865, longitude: 23.755 }, "approximate snaps to the ~500 m grid");
  assert.equal((await edit(otherC, id, { type: "location", clear: true })).status, 404, "another agent cannot touch it");

  // Saved with each visibility: the property carries only what may be public.
  const ready = async (visibility: string | null) => {
    const s = (await call(agentC, "POST", "/property-intake/sessions", { language: "el", clientRef: randomUUID() })).body.session;
    for (const [key, value] of [["listingType", "SALE"], ["propertyType", "APARTMENT"], ["areaName", "Γλυφάδα"], ["city", "Αθήνα"], ["area", 80], ["price", 250000], ["titleEl", "Διαμέρισμα 80 τ.μ. Γλυφάδα"], ["descriptionEl", "Διαμέρισμα προς πώληση στη Γλυφάδα."]] as const) {
      assert.equal((await edit(agentC, s.id, { type: "set", key, value })).status, 200, key);
    }
    if (visibility) assert.equal((await edit(agentC, s.id, { type: "location", lat: 37.8654321, lng: 23.7543219, source: "map", visibility })).status, 200);
    const created = await call(agentC, "POST", `/property-intake/sessions/${s.id}/create`, {});
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const p = await db().property.findUniqueOrThrow({ where: { id: created.body.property.id }, select: { latitude: true, longitude: true } });
    const kept = await db().propertyIntakeSession.findUniqueOrThrow({ where: { id: s.id } });
    return { lat: p.latitude == null ? null : Number(p.latitude), lng: p.longitude == null ? null : Number(p.longitude), sessionLat: (kept.state as any).location?.lat ?? null };
  };
  assert.deepEqual(await ready("exact"), { lat: 37.8654321, lng: 23.7543219, sessionLat: 37.8654321 });
  assert.deepEqual(await ready("approximate"), { lat: 37.865, lng: 23.755, sessionLat: 37.8654321 }, "the exact point stays in the session only");
  assert.deepEqual(await ready("private"), { lat: null, lng: null, sessionLat: 37.8654321 }, "private: nothing public, the office keeps the point");
  assert.deepEqual(await ready(null), { lat: null, lng: null, sessionLat: null });

  r = await edit(agentC, id, { type: "location", clear: true });
  assert.equal(r.body.session.location, null, "it can be removed");
});
