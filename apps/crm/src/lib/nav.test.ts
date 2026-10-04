import assert from "node:assert/strict";
import { test } from "node:test";

import { activeGroup, activeHref, isGroup, navFor, NAV_SECTIONS } from "./nav";

const allHrefs = (sections = NAV_SECTIONS) =>
  sections.flatMap((s) => s.entries.flatMap((e) => (isGroup(e) ? e.children.map((c) => c.href) : [e.href])));

const admin = { role: "ADMIN", canOpenSettings: true };
const agent = { role: "AGENT", canOpenSettings: false };
const viewer = { role: "VIEWER", canOpenSettings: false };

test("every existing CRM route has exactly one sidebar link", () => {
  const routes = ["/", "/properties", "/leads", "/submissions", "/requests", "/media", "/sellers", "/valuations",
    "/mandates", "/transactions", "/calendar", "/reminders", "/contacts", "/documents", "/messages",
    "/users", "/invitations", "/settings", "/security", "/connections"];
  const hrefs = allHrefs(navFor(admin));
  for (const r of routes) assert.equal(hrefs.filter((h) => h === r).length, 1, r);
  assert.equal(new Set(hrefs).size, hrefs.length, "no duplicate links");
});

test("no roadmap module is listed", () => {
  const labels = NAV_SECTIONS.flatMap((s) => s.entries.flatMap((e) => [e.label, ...(isGroup(e) ? e.children.map((c) => c.label) : [])]));
  for (const soon of ["Διαφημίσεις", "Στατιστικά", "Μαζικό SMS", "Ομάδες"]) assert.ok(!labels.includes(soon), soon);
});

test("admin links keep their role and capability rules", () => {
  assert.deepEqual(allHrefs(navFor(agent)).filter((h) => ["/users", "/invitations", "/settings", "/security"].includes(h)), ["/security"]);
  assert.ok(allHrefs(navFor({ role: "MANAGER", canOpenSettings: false })).includes("/users"));
  assert.ok(!allHrefs(navFor({ role: "MANAGER", canOpenSettings: false })).includes("/invitations"));
  assert.ok(allHrefs(navFor(admin)).includes("/settings"));
  assert.ok(allHrefs(navFor({ role: "MANAGER", canOpenSettings: false })).includes("/connections"));
  assert.ok(!allHrefs(navFor(agent)).includes("/connections"));
  assert.ok(!allHrefs(navFor(viewer)).includes("/properties/new"), "create needs AGENT");
});

test("deep links resolve to the right child and open its group", () => {
  const nav = navFor(admin);
  const cases: Array<[string, string, string | null]> = [
    ["/documents", "/documents", "files"],
    ["/sellers/abc", "/sellers", "clients"],
    ["/leads", "/leads", "clients"],
    ["/reminders", "/reminders", "calendar"],
    ["/security", "/security", "settings"],
    ["/connections", "/connections", "settings"],
    ["/settings/portals", "/settings", "settings"],
    ["/properties/new", "/properties/new", "properties"],
    ["/properties/123/edit", "/properties", "properties"],
    ["/requests", "/requests", null],
    ["/", "/", null],
  ];
  for (const [path, href, group] of cases) {
    assert.equal(activeHref(nav, path), href, path);
    assert.equal(activeGroup(nav, path), group, path);
  }
  assert.equal(activeHref(nav, "/propertiesx"), null);
});
