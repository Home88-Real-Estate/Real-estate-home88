import { test } from "node:test";
import assert from "node:assert/strict";

import { AUTOMATION_RULES, automationTaskTitle, dueWithin, episodeKey, olderThan, ruleDays } from "./automation";

const now = new Date("2026-10-10T10:00:00Z");

test("a rule is off until Settings gives it a number of days", () => {
  const lead = AUTOMATION_RULES.find((r) => r.key === "LEAD_STALE")!;
  assert.equal(ruleDays({}, lead), null);
  assert.equal(ruleDays({ leadStaleDays: null }, lead), null);
  assert.equal(ruleDays({ leadStaleDays: -1 }, lead), null);
  assert.equal(ruleDays({ leadStaleDays: 0 }, lead), 0, "zero is a valid threshold");
  assert.equal(ruleDays({ leadStaleDays: 5 }, lead), 5);
  assert.equal(new Set(AUTOMATION_RULES.map((r) => `${r.section}.${r.field}`)).size, AUTOMATION_RULES.length);
  assert.equal(AUTOMATION_RULES.find((r) => r.key === "LISTING_STALE")!.section, "properties", "reuses the existing stale-listing setting");
});

test("staleness and expiry windows", () => {
  assert.equal(olderThan("2026-10-05T10:00:00Z", 5, now), true, "exactly five days counts");
  assert.equal(olderThan("2026-10-06T10:00:00Z", 5, now), false);
  assert.equal(olderThan(null, 1, now), false);
  assert.equal(dueWithin("2026-10-12T10:00:00Z", 3, now), true);
  assert.equal(dueWithin("2026-10-20T10:00:00Z", 3, now), false);
  assert.equal(dueWithin("2026-10-09T10:00:00Z", 3, now), false, "already past is not 'expiring'");
});

test("task titles carry a reference, and episodes are stable", () => {
  const r = AUTOMATION_RULES[0]!;
  assert.equal(automationTaskTitle(r, "LD-000012"), `${r.taskLabel} · LD-000012`);
  assert.equal(episodeKey([new Date("2026-10-01T00:00:00Z"), null]), "2026-10-01T00:00:00.000Z|-");
});
