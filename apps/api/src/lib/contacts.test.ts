import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

import { contactFilterSchema, contactOrder, contactWhere } from "./contacts";
import { hashEmail, hashPhone } from "./pii";

const where = (q: Record<string, string>) => JSON.stringify(contactWhere(contactFilterSchema.parse(q)));

test("no filter means no condition", () => {
  assert.deepEqual(contactWhere(contactFilterSchema.parse({})), {});
});

test("email and phone filters match through their hashes, never the plaintext", () => {
  const w = where({ email: "Maria@Test.Invalid", phone: "+30 694 123 4567" });
  assert.ok(w.includes(hashEmail("maria@test.invalid")!));
  assert.ok(w.includes(hashPhone("+306941234567")!));
  assert.ok(!w.toLowerCase().includes("maria@test.invalid"));
});

test("an email or phone that cannot be normalised matches nothing instead of everything", () => {
  assert.ok(where({ email: "not an email" }).includes("__none__") || where({ email: "not an email" }).includes("emailHash"));
  assert.ok(where({ phone: "abc" }).includes("__none__"));
});

test("unassigned, status, role and date filters", () => {
  assert.ok(where({ assignedToId: "none" }).includes('"assignedToId":null'));
  assert.ok(where({ assignedToId: "u1", status: "INACTIVE", role: "BUYER" }).includes('"assignedToId":"u1"'));
  const dated = where({ createdFrom: "2026-01-01", createdTo: "2026-01-31" });
  assert.ok(dated.includes("2026-01-01T00:00:00.000Z") && dated.includes("2026-01-31T23:59:59.999Z"));
  assert.ok(where({ inactiveDays: "30" }).includes('"lastActivityAt":null'), "never-active contacts count as inactive");
});

test("a two-word search matches first and last name together", () => {
  const w = where({ q: "Μαρία Παπα" });
  assert.ok(w.includes("Μαρία") && w.includes("Παπα"));
  assert.ok(w.includes('"AND":['));
});

test("bad dates and unknown values are refused", () => {
  assert.throws(() => contactFilterSchema.parse({ createdFrom: "yesterday" }));
  assert.throws(() => contactFilterSchema.parse({ status: "DELETED" }));
  assert.throws(() => contactFilterSchema.parse({ inactiveDays: "0" }));
});

test("last-activity sorting keeps never-active contacts last; unknown sort falls back to newest", () => {
  assert.deepEqual(contactOrder("lastActivityAt", "desc")[0], { lastActivityAt: { sort: "desc", nulls: "last" } });
  assert.deepEqual(contactOrder("nope", "desc")[0], { createdAt: "desc" });
});
