import assert from "node:assert/strict";
import { test } from "node:test";

import { crmLoginUrl, resolveCrmLoginUrl, resolvePublic } from "./config";

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

test("a plain env name is accepted, so a private variable works", () => {
  assert.equal(
    resolvePublic("SITE_URL", { SITE_URL: "https://realestate-home-88.vercel.app" }),
    "https://realestate-home-88.vercel.app",
  );
});

test("the NEXT_PUBLIC_ name still wins when both are set", () => {
  assert.equal(
    resolvePublic("SITE_URL", {
      NEXT_PUBLIC_SITE_URL: "https://public.example",
      SITE_URL: "https://private.example",
    }),
    "https://public.example",
  );
});

test("a blank prefixed value falls through to the plain name", () => {
  assert.equal(
    resolvePublic("CRM_URL", { NEXT_PUBLIC_CRM_URL: "   ", CRM_URL: "https://crm.example" }),
    "https://crm.example",
  );
});

test("an unset value resolves to empty for the caller to default", () => {
  assert.equal(resolvePublic("MEDIA_BASE_URL", {}), "");
});

test("a CRM origin configured without the prefix still wins over the proxy", () => {
  const crmUrl = resolvePublic("CRM_URL", { CRM_URL: "https://real-estate-home88-iota.vercel.app/" });
  assert.equal(
    resolveCrmLoginUrl({ crmUrl, crmOrigin: "https://real-estate-home88-iota.vercel.app", basePath: "/crm", production: true }),
    "https://real-estate-home88-iota.vercel.app/crm/login",
  );
});
