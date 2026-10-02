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

test("production without configuration links to the HOME88 CRM deployment", () => {
  assert.equal(
    resolveCrmLoginUrl({ basePath: "/crm", production: true }),
    "https://real-estate-home88-iota.vercel.app/crm/login",
  );
  assert.equal(
    resolveCrmLoginUrl({ basePath: "/crm", production: true, crmUrl: "  " }),
    "https://real-estate-home88-iota.vercel.app/crm/login",
  );
});

test("CRM_ORIGIN names the CRM deployment the link goes to", () => {
  assert.equal(
    resolveCrmLoginUrl({ basePath: "/crm", production: true, crmOrigin: "https://crm-app.vercel.app/" }),
    "https://crm-app.vercel.app/crm/login",
  );
});

test("an explicit CRM domain wins", () => {
  assert.equal(
    resolveCrmLoginUrl({ crmUrl: "https://crm.home88.estate", basePath: "/crm", production: true }),
    "https://crm.home88.estate/crm/login",
  );
});

test("development uses the local CRM", () => {
  assert.equal(resolveCrmLoginUrl({ basePath: "/crm", production: false }), "http://localhost:3100/crm/login");
});
