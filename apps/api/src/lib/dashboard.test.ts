import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAgentRows,
  buildAlerts,
  countByCategory,
  countMap,
  orderedCounts,
  topSources,
} from "./dashboard";

test("alerts drop zero counts and lead with the most severe", () => {
  const alerts = buildAlerts({
    overdueTasks: 0,
    uncontactedLeads: 3,
    activeWithoutPhoto: 0,
    offersPending: 2,
    staleDrafts: 1,
    portalFailed: 4,
    mediaPending: null,
  });
  assert.deepEqual(
    alerts.map((a) => `${a.code}:${a.count}`),
    ["PORTAL_FAILED:4", "UNCONTACTED_LEADS:3", "OFFERS_PENDING:2", "STALE_DRAFTS:1"],
  );
});

test("property types roll up into categories, all categories present", () => {
  assert.deepEqual(
    countByCategory([
      { propertyType: "APARTMENT", count: 10 },
      { propertyType: "VILLA", count: 2 },
      { propertyType: "SHOP", count: 3 },
      { propertyType: "PLOT", count: 1 },
    ]),
    { RESIDENTIAL: 12, COMMERCIAL: 3, LAND: 1, OTHER: 0 },
  );
});

test("lead sources: largest first, the tail folded into OTHER", () => {
  const rows = [
    { source: "WEBSITE", count: 40 },
    { source: "SPITOGATOS", count: 25 },
    { source: "XE_GR", count: 12 },
    { source: "PHONE", count: 9 },
    { source: "EMAIL", count: 4 },
    { source: "WALK_IN", count: 2 },
    { source: "REFERRAL", count: 1 },
    { source: "SOCIAL", count: 0 },
  ];
  const top = topSources(rows, 6);
  assert.equal(top.length, 6);
  assert.deepEqual(top.at(-1), { source: "OTHER", count: 3 });
  assert.equal(top.reduce((s, r) => s + r.count, 0), 93);
  assert.deepEqual(topSources(rows.slice(0, 3)), rows.slice(0, 3));
});

test("an existing OTHER bar absorbs the tail without double counting", () => {
  const rows = [
    { source: "WEBSITE", count: 10 },
    { source: "OTHER", count: 8 },
    { source: "PHONE", count: 5 },
    { source: "EMAIL", count: 3 },
    { source: "WALK_IN", count: 2 },
  ];
  const top = topSources(rows, 3);
  assert.deepEqual(top, [
    { source: "OTHER", count: 18 },
    { source: "WEBSITE", count: 10 },
  ]);
  assert.equal(rows[1]!.count, 8, "input rows are not mutated");
});

test("ordered counts keep pipeline order and fill missing stages", () => {
  assert.deepEqual(
    orderedCounts(["NEW", "CONTACTED", "WON"] as const, [
      { key: "WON", count: 1 },
      { key: "NEW", count: 5 },
    ]),
    [
      { key: "NEW", count: 5 },
      { key: "CONTACTED", count: 0 },
      { key: "WON", count: 1 },
    ],
  );
});

test("agent rows join counts and hide agents with no activity", () => {
  const rows = buildAgentRows(
    [
      { id: "a", firstName: "Μαρία", lastName: "Παπαδοπούλου" },
      { id: "b", firstName: "Γιώργος", lastName: "Νικολάου" },
      { id: "c", firstName: "Idle", lastName: "Agent" },
    ],
    {
      activeProperties: countMap([{ key: "a", count: 4 }, { key: "b", count: 7 }, { key: null, count: 9 }]),
      leads: countMap([{ key: "a", count: 10 }, { key: "b", count: 3 }]),
      viewings: new Map(),
      offers: new Map(),
      closings: countMap([{ key: "b", count: 1 }]),
    },
  );
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
  assert.equal(rows[0]!.closings, 1);
});
