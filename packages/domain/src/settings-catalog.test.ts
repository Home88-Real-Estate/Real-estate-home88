import assert from "node:assert/strict";
import { test } from "node:test";

import {
  childLevel,
  DEFAULT_SETTINGS_GRANTS,
  portalStatus,
  RESERVED_PERMISSIONS,
  SETTINGS_PERMISSIONS,
  SETTINGS_SECTIONS,
  slugify,
  subscriptionCountdown,
} from "./settings-catalog";
import { scoreMatch } from "./request-matching";

test("catalogue: unique keys, secrets have a scope, business values have no defaults", () => {
  const keys = new Set<string>();
  for (const s of SETTINGS_SECTIONS) {
    assert.ok(!keys.has(s.key), `duplicate section ${s.key}`);
    keys.add(s.key);
    const fields = new Set<string>();
    for (const f of s.fields) {
      assert.ok(!fields.has(f.key), `duplicate field ${s.key}.${f.key}`);
      fields.add(f.key);
      if (f.type === "secret") assert.ok(s.secretScope, `${s.key} has secrets but no scope`);
      if (f.type === "select" || f.type === "multiselect") assert.ok(f.options && f.options.length > 0, `${s.key}.${f.key} needs options`);
    }
  }
  assert.equal(keys.size, 21);
  // Nothing HOME88 must supply is pre-filled.
  for (const key of ["company", "legal", "commissions", "privacy", "subscription", "automation"]) {
    const section = SETTINGS_SECTIONS.find((s) => s.key === key)!;
    for (const f of section.fields) {
      if (f.type === "boolean" || f.type === "multiselect") continue;
      assert.equal(f.default, undefined, `${key}.${f.key} must not have a default`);
    }
  }
  const requests = SETTINGS_SECTIONS.find((s) => s.key === "requests")!;
  assert.equal(requests.fields.find((f) => f.key === "minMatchScore")!.default, 40);
});

test("permissions: agents get nothing by default; reserved permissions are never default grants", () => {
  assert.deepEqual(DEFAULT_SETTINGS_GRANTS.AGENT, []);
  assert.deepEqual(DEFAULT_SETTINGS_GRANTS.VIEWER, []);
  const all = new Set(SETTINGS_PERMISSIONS.map((p) => p.code));
  for (const [role, grants] of Object.entries(DEFAULT_SETTINGS_GRANTS)) {
    for (const g of grants) {
      assert.ok(all.has(g), `${role} grants unknown ${g}`);
      assert.ok(!RESERVED_PERMISSIONS.has(g), `${role} must not hold reserved ${g}`);
    }
  }
});

test("subscription countdown is computed from the real expiry, in Athens time", () => {
  const now = new Date("2026-10-03T09:31:00Z"); // 12:31 Athens
  const c = subscriptionCountdown("2026-11-21", now)!;
  assert.equal(c.expired, false);
  // To 23:59:59 on 21/11 in Athens; the hour gained when clocks go back on
  // 25/10 is counted, as real elapsed time.
  assert.equal(c.days, 49);
  assert.equal(c.hours, 12);
  assert.equal(c.minutes, 28);
  assert.equal(subscriptionCountdown("2026-10-01", now)!.expired, true);
  assert.equal(subscriptionCountdown(null, now), null);
});

test("portal status only reads 'connected' after a real success; a newer error wins", () => {
  assert.equal(portalStatus({ configured: false, enabled: true }), "NOT_CONFIGURED");
  assert.equal(portalStatus({ configured: true, enabled: false }), "DISABLED");
  assert.equal(portalStatus({ configured: true, enabled: true }), "CONFIGURED");
  assert.equal(portalStatus({ configured: true, enabled: true, lastSuccessAt: "2026-10-01" }), "CONNECTED");
  assert.equal(portalStatus({ configured: true, enabled: true, lastSuccessAt: "2026-10-01", lastErrorAt: "2026-10-02" }), "ERROR");
});

test("areas: levels nest in order, slugs transliterate Greek", () => {
  assert.equal(childLevel(null), "REGION");
  assert.equal(childLevel("REGION"), "CITY");
  assert.equal(childLevel("AREA"), "NEIGHBORHOOD");
  assert.equal(childLevel("NEIGHBORHOOD"), null);
  assert.equal(slugify("Άνω Γλυφάδα"), "ano-glyfada");
  assert.equal(slugify("Θεσσαλονίκη - Δήμος"), "thessaloniki-dimos");
});

test("matching rules from settings change scoring; zero weight drops a criterion", () => {
  const request = { listingType: "SALE", propertyTypes: [], areas: ["Γλυφάδα"], minPrice: null, maxPrice: 400000, features: [] };
  const property = { listingType: "SALE", propertyType: "APARTMENT", status: "ACTIVE", price: 418000, areaName: "Βούλα", flags: {} };
  // Default: 5% price tolerance → 418k fits 400k max; area misses.
  assert.equal(scoreMatch(request, property)!.score, 55);
  // Stricter tolerance: price no longer matches.
  assert.equal(scoreMatch(request, property, { priceTolerance: 0 })!.score, 0);
  // Area weight 0: only price counts.
  assert.equal(scoreMatch(request, property, { weights: { area: 0 } })!.score, 100);
});
