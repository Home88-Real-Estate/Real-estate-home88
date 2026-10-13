import assert from "node:assert/strict";
import { test } from "node:test";

import { PORTAL_DIRECTORY } from "./portal-directory";
import { countByFit, recommendFor, sortRecommendations, type RecommendationFacts } from "./portal-recommendations";

const entry = (key: string) => PORTAL_DIRECTORY.find((e) => e.key === key)!;
const full: RecommendationFacts = { listingType: "SALE", hasGreekTitle: true, hasGreekDescription: true, hasEnglishTitle: true, hasEnglishDescription: true, hasPrice: true, hasArea: true, photoCount: 5 };

test("a Greek portal with a ready property is a strong fit, explained, with performance unavailable", () => {
  const r = recommendFor(entry("SPITOGATOS"), "READY_FOR_TEST", full, { readiness: "READY", blockers: [] });
  assert.equal(r.fit, "STRONG");
  assert.equal(r.basis, "RULES");
  assert.equal(r.performance, "UNAVAILABLE");
  assert.ok(r.matches.includes("Πληροί τους κανόνες του portal"));
  assert.ok(r.notes.some((n) => n.includes("πλήρως συνδεδεμένο")), "connection state is a note, not a verdict");
});

test("missing data is a fixable constraint, never a silent downgrade to not eligible", () => {
  const r = recommendFor(entry("SPITOGATOS"), "READY_FOR_TEST", { ...full, photoCount: 0, hasPrice: false }, { readiness: "BLOCKED", blockers: ["Λείπει: Περιγραφή"] });
  assert.equal(r.fit, "NEEDS_INFO");
  assert.ok(r.constraints.includes("Δεν υπάρχει εγκεκριμένη φωτογραφία.") && r.constraints.includes("Λείπει η τιμή.") && r.constraints.includes("Λείπει: Περιγραφή"));
});

test("a destination whose acceptance of Greek listings is unconfirmed is never strong", () => {
  for (const key of ["GREEN_ACRES", "KYERO", "PROPERSTAR", "RIGHTMOVE", "PROPERTY_FINDER", "TROVIT"]) {
    const r = recommendFor(entry(key), "CATALOG_ONLY", full);
    assert.notEqual(r.fit, "STRONG", key);
    assert.ok(r.notes.some((n) => n.includes("επιβεβαιωθεί ότι δέχεται")), key);
  }
  assert.equal(recommendFor(entry("KYERO"), "CATALOG_ONLY", full).fit, "POSSIBLE");
  assert.equal(recommendFor(entry("RIGHTMOVE"), "NEEDS_SPECIFICATION", full).fit, "LOW", "a foreign national portal is low priority");
});

test("foreign-market destinations need English content; Greek ones need Greek", () => {
  const noEnglish = recommendFor(entry("KYERO"), "CATALOG_ONLY", { ...full, hasEnglishDescription: false });
  assert.equal(noEnglish.fit, "NEEDS_INFO");
  assert.ok(noEnglish.constraints.some((c) => c.includes("αγγλικός")));
  assert.equal(recommendFor(entry("SPITOGATOS"), "READY_FOR_TEST", { ...full, hasEnglishTitle: false, hasEnglishDescription: false }, { readiness: "READY", blockers: [] }).fit, "STRONG", "English is irrelevant to a Greek portal");
  assert.equal(recommendFor(entry("SPITOGATOS"), "READY_FOR_TEST", { ...full, hasGreekDescription: false }, null).fit, "NEEDS_INFO");
});

test("a Greek portal with no working integration is only a possible fit, and the rule never claims more than the facts", () => {
  const r = recommendFor(entry("SPITI24"), "NEEDS_SPECIFICATION", full);
  assert.equal(r.fit, "POSSIBLE");
  assert.ok(r.notes.some((n) => n.includes("λειτουργική ενσωμάτωση")));
  for (const rec of PORTAL_DIRECTORY.map((e) => recommendFor(e, "CATALOG_ONLY", full))) {
    const text = JSON.stringify(rec).toLowerCase();
    for (const forbidden of ["ταχύτερα", "faster", "conversion", "traffic", "audience", "ζήτηση"]) assert.ok(!text.includes(forbidden), `${rec.key} claims ${forbidden}`);
  }
});

test("sorting puts the best fits first and counts add up", () => {
  const rows = PORTAL_DIRECTORY.map((e) => recommendFor(e, "CATALOG_ONLY", full));
  const sorted = sortRecommendations(rows);
  assert.equal(sorted.length, rows.length);
  const order = ["STRONG", "POSSIBLE", "NEEDS_INFO", "LOW", "NOT_ELIGIBLE"];
  for (let i = 1; i < sorted.length; i++) assert.ok(order.indexOf(sorted[i - 1]!.fit) <= order.indexOf(sorted[i]!.fit));
  assert.equal(Object.values(countByFit(rows)).reduce((a, b) => a + b, 0), rows.length);
});

test("full-feed destinations carry the removal note", () => {
  assert.ok(recommendFor(entry("GREEN_ACRES"), "CATALOG_ONLY", full).notes.some((n) => n.includes("Πλήρες feed")));
});
