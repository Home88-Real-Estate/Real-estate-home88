import assert from "node:assert/strict";
import { test } from "node:test";

import { CONTACT_TABS, qs } from "./contacts";

test("modules that do not exist yet are in the registry but marked not ready", () => {
  const ready = CONTACT_TABS.filter((t) => t.ready).map((t) => t.label);
  assert.deepEqual(ready, ["Στοιχεία", "Ακίνητα", "Ζητήσεις", "Υποδείξεις", "Υπενθυμίσεις", "Ιστορικό", "Εντολές", "Έγγραφα"]);
  assert.deepEqual(CONTACT_TABS.filter((t) => !t.ready).map((t) => t.key), ["calls", "relations"]);
  assert.equal(new Set(CONTACT_TABS.map((t) => t.key)).size, CONTACT_TABS.length);
});

test("query strings drop empty values and encode the rest", () => {
  assert.equal(qs({ q: "", role: undefined, page: 2 }), "?page=2");
  assert.equal(qs({ q: "Μαρία Π" }), `?${new URLSearchParams({ q: "Μαρία Π" })}`);
  assert.equal(qs({}), "");
});
