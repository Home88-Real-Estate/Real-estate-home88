import assert from "node:assert/strict";
import { test } from "node:test";

import { crmLoginUrl, resolveCrmLoginUrl } from "./config";

test("production CRM origin builds the production staff login URL", () => {
  assert.equal(
    crmLoginUrl("https://crm.home88.estate", "/crm"),
    "https://crm.home88.estate/crm/login",
  );
});

test("development CRM origin builds the local staff login URL", () => {
  assert.equal(crmLoginUrl("http://localhost:3100", "/crm"), "http://localhost:3100/crm/login");
});

test("no CRM origin yields no link (defensive guard)", () => {
  assert.equal(crmLoginUrl("", "/crm"), "");
});

test("trailing slashes on the origin and base path are normalised", () => {
  assert.equal(
    crmLoginUrl("https://crm.home88.estate/", "/crm/"),
    "https://crm.home88.estate/crm/login",
  );
});

test("production without a CRM domain links to /crm/login on the site itself", () => {
  assert.equal(resolveCrmLoginUrl({ basePath: "/crm", production: true }), "/crm/login");
  assert.equal(
    resolveCrmLoginUrl({ basePath: "/crm", production: true, crmOrigin: "https://crm-app.vercel.app" }),
    "/crm/login",
  );
});

test("an explicit CRM domain wins", () => {
  assert.equal(
    resolveCrmLoginUrl({ crmUrl: "https://crm.home88.estate", basePath: "/crm", production: true }),
    "https://crm.home88.estate/crm/login",
  );
});

test("development uses the local CRM unless it is proxied", () => {
  assert.equal(resolveCrmLoginUrl({ basePath: "/crm", production: false }), "http://localhost:3100/crm/login");
  assert.equal(
    resolveCrmLoginUrl({ basePath: "/crm", production: false, crmOrigin: "http://localhost:3100" }),
    "/crm/login",
  );
});
