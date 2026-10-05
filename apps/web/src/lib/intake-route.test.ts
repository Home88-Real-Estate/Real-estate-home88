import assert from "node:assert/strict";
import { test } from "node:test";

import { IntakeValidationError, type IntakeOutcome } from "@home88/intake";
import { contactSchema } from "@home88/validation";

import { handleIntake, type IntakeRoute } from "./intake-route";

const adult = { dateOfBirth: "1985-06-15", ageAffirmation: true };
const valid = { firstName: "Μαρία", email: "maria@example.com", message: "Γεια σας", ...adult, consent: { necessary: true } };

let counter = 0;
const request = (body: unknown, ip = `198.51.100.${++counter}`) =>
  new Request("http://web.test/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function route(run: IntakeRoute<ReturnType<typeof contactSchema.parse>>["run"], limit = { points: 100, durationSeconds: 60 }, name = `t${Math.random()}`): IntakeRoute<ReturnType<typeof contactSchema.parse>> {
  return { name, limit, schema: contactSchema, run };
}

const created = (reference = "H88-000001"): IntakeOutcome => ({ status: "created", reference });
const service = {} as never;
const withService = { getService: () => service };

test("a valid submission returns 201 and only a public reference", async () => {
  const res = await handleIntake(request(valid), route(async () => created("SUB-2026-000123")), withService);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true, reference: "SUB-2026-000123" });
});

test("a replayed submission is a 200 with the same reference", async () => {
  const res = await handleIntake(request(valid), route(async () => ({ status: "replayed", reference: "H88-000009" })), withService);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).reference, "H88-000009");
});

test("the honeypot and the time trap are accepted silently and never reach the service", async () => {
  let called = 0;
  const r = route(async () => (called++, created()));
  const trapped = await handleIntake(request({ ...valid, hpl: "http://spam.example" }), r, withService);
  assert.equal(trapped.status, 200);
  assert.deepEqual(await trapped.json(), { ok: true, reference: null });
  const fast = await handleIntake(request({ ...valid, hpt: String(Date.now()) }), r, withService);
  assert.deepEqual(await fast.json(), { ok: true, reference: null });
  assert.equal(called, 0);
});

test("invalid input is a 400 with field errors, and the service is not called", async () => {
  let called = 0;
  const res = await handleIntake(request({ ...valid, email: "not-an-email" }), route(async () => (called++, created())), withService);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).fields.email);
  assert.equal(called, 0);
});

test("malformed JSON and oversized bodies are rejected", async () => {
  assert.equal((await handleIntake(request("{nope"), route(async () => created()), withService)).status, 400);
  const big = await handleIntake(request({ ...valid, message: "x".repeat(70_000) }), route(async () => created()), withService);
  assert.equal(big.status, 400);
});

test("rate limiting answers 429 with Retry-After, per IP", async () => {
  const name = "ratelimited";
  const r = route(async () => created(), { points: 2, durationSeconds: 60 }, name);
  const ip = "203.0.113.77";
  assert.equal((await handleIntake(request(valid, ip), r, withService)).status, 201);
  assert.equal((await handleIntake(request(valid, ip), r, withService)).status, 201);
  const blocked = await handleIntake(request(valid, ip), r, withService);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await handleIntake(request(valid, "203.0.113.78"), r, withService)).status, 201, "another visitor is unaffected");
});

test("an unexpected failure shows the visitor a generic message and leaks nothing", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => logged.push(a.join(" "));
  try {
    const secret = 'duplicate key value violates unique constraint "leads_pkey" at postgresql://user:pw@db.internal:5432/h88';
    const res = await handleIntake(request(valid), route(async () => { throw new Error(secret); }), withService);
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!/postgres|constraint|leads_pkey|db\.internal|user:pw|Error:/i.test(text), text);
    assert.match(text, /δεν ολοκληρώθηκε/);
    assert.ok(!logged.join("\n").includes("pw@"), "the log has the error class, never the message or payload");
  } finally {
    console.error = original;
  }
});

test("a service-side validation problem becomes a 400 with its fields", async () => {
  const res = await handleIntake(request(valid), route(async () => { throw new IntakeValidationError({ propertyReference: ["Το ακίνητο δεν βρέθηκε."] }); }), withService);
  assert.equal(res.status, 400);
  assert.deepEqual((await res.json()).fields, { propertyReference: ["Το ακίνητο δεν βρέθηκε."] });
});

test("an age-gate refusal gives the standard message without the reason", async () => {
  const res = await handleIntake(request(valid), route(async () => ({ status: "refused", reason: "underage" })), withService);
  assert.equal(res.status, 400);
  assert.ok(!(await res.text()).includes("underage"));
});

test("without a database the visitor gets a 503, not a stack trace", async () => {
  const res = await handleIntake(request(valid), route(async () => created()), { getService: () => null });
  assert.equal(res.status, 503);
});

test("upload counts are reported, never storage keys", async () => {
  const res = await handleIntake(request(valid), route(async () => ({ status: "created", reference: "SUB-2026-000001", uploads: { accepted: 4, quarantined: 1, rejected: 0, skipped: 0 } })), withService);
  assert.deepEqual(await res.json(), { ok: true, reference: "SUB-2026-000001", uploads: { received: 5 } });
});
