import assert from "node:assert/strict";
import { test } from "node:test";

import { PORTAL_CATALOG } from "./settings-catalog";
import { PORTAL_DIRECTORY, countByStatus, distributionStatus, filterDirectory, type DirectoryRow } from "./portal-directory";

const rows = (): DirectoryRow[] => PORTAL_DIRECTORY.map((e) => ({ ...e, status: distributionStatus(e, null), live: null }));

test("keys are unique and every catalogue link points at a real framework portal (no duplicates)", () => {
  const keys = PORTAL_DIRECTORY.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
  const codes = new Set(PORTAL_CATALOG.map((p) => p.code));
  const linked = PORTAL_DIRECTORY.filter((e) => e.catalogCode).map((e) => e.catalogCode!);
  for (const c of linked) assert.ok(codes.has(c), c);
  assert.equal(new Set(linked).size, linked.length, "one directory entry per framework portal");
  // Every framework portal that is a real destination (not a generic custom feed) is listed.
  for (const c of codes) if (!c.startsWith("CUSTOM_")) assert.ok(linked.includes(c), `${c} missing from the directory`);
});

test("the Greek core and the priority international partners are present", () => {
  const names = PORTAL_DIRECTORY.map((e) => e.key);
  for (const k of ["SPITOGATOS", "XE_GR", "INDOMIO_GR", "SPITI24", "TOSPITIMOU", "PLOT_GR", "KYERO", "GREEN_ACRES", "JAMESEDITION", "PROPERSTAR", "IDEALISTA", "RIGHTMOVE", "PROPERTY_FINDER", "TROVIT"]) assert.ok(names.includes(k), k);
});

test("nothing is connected without a framework link and a successful connection", () => {
  assert.ok(rows().every((r) => r.status === "CATALOG_ONLY" || r.status === "NEEDS_SPECIFICATION"));
  const spito = PORTAL_DIRECTORY.find((e) => e.key === "SPITOGATOS")!;
  assert.equal(distributionStatus(spito, { hasAdapter: true, status: "NOT_CONFIGURED" }), "AWAITING_ACCOUNT");
  assert.equal(distributionStatus(spito, { hasAdapter: true, status: "CONFIGURED" }), "READY_FOR_TEST");
  assert.equal(distributionStatus(spito, { hasAdapter: true, status: "CONNECTED" }), "CONNECTED");
  assert.equal(distributionStatus(spito, { hasAdapter: true, status: "ERROR" }), "SYNC_ERROR");
  assert.equal(distributionStatus(spito, { hasAdapter: true, status: "DISABLED" }), "PAUSED");
  // A research candidate cannot be connected even if a status were passed.
  const rightmove = PORTAL_DIRECTORY.find((e) => e.key === "RIGHTMOVE")!;
  assert.equal(distributionStatus(rightmove, { hasAdapter: true, status: "CONNECTED" }), "NEEDS_SPECIFICATION");
  // Documented spec but no adapter: catalogue only, not "ready".
  const kyero = PORTAL_DIRECTORY.find((e) => e.key === "KYERO")!;
  assert.equal(distributionStatus(kyero, null), "CATALOG_ONLY");
  const green = PORTAL_DIRECTORY.find((e) => e.key === "GREEN_ACRES")!;
  assert.equal(distributionStatus(green, { hasAdapter: false, status: "PLANNED" }), "CATALOG_ONLY");
});

test("only Greek-market portals claim to accept Greek listings; full-feed portals carry a caution", () => {
  for (const e of PORTAL_DIRECTORY) assert.equal(e.greece === "YES", e.market === "GR", e.key);
  assert.ok(PORTAL_DIRECTORY.find((e) => e.key === "GREEN_ACRES")!.caution);
  assert.ok(PORTAL_DIRECTORY.find((e) => e.key === "KYERO")!.caution);
});

test("filters by search (accent-insensitive), country, method, status, priority and group", () => {
  const all = rows();
  assert.deepEqual(filterDirectory(all, { q: "χρυση" }).map((r) => r.key), ["XE_GR"]);
  assert.deepEqual(filterDirectory(all, { q: "spitogatos" }).map((r) => r.key), ["SPITOGATOS"]);
  assert.ok(filterDirectory(all, { country: "GR" }).every((r) => r.country === "GR"));
  assert.ok(filterDirectory(all, { method: "XML_FEED" }).every((r) => r.delivery === "XML_FEED"));
  assert.equal(filterDirectory(all, { group: "Indomio Group" }).length, 4);
  assert.ok(filterDirectory(all, { priority: "A" }).length === 6);
  assert.equal(filterDirectory(all, { status: "CONNECTED" }).length, 0);
  const counts = countByStatus(all);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), all.length);
});

test("snapshot behaviour is only claimed where documented, and snapshot portals carry the caution", () => {
  const snapshots = PORTAL_DIRECTORY.filter((e) => e.publication === "FULL_SNAPSHOT").map((e) => e.key).sort();
  assert.deepEqual(snapshots, ["GREEN_ACRES", "JAMESEDITION", "KYERO"]);
  for (const key of ["GREEN_ACRES", "KYERO"]) assert.ok(PORTAL_DIRECTORY.find((e) => e.key === key)!.caution, key);
  const xe = PORTAL_DIRECTORY.find((e) => e.key === "XE_GR")!;
  assert.deepEqual([xe.delivery, xe.publication, xe.specification], ["API", "INCREMENTAL", "DOCUMENTED"]);
  assert.match(xe.note ?? "", /δεν έχει υλοποιηθεί/, "the API is documented but not built");
  assert.ok(PORTAL_DIRECTORY.filter((e) => !["GREEN_ACRES", "KYERO", "JAMESEDITION", "XE_GR"].includes(e.key)).every((e) => e.publication === "UNKNOWN"));
});
