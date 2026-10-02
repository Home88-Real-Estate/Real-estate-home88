import assert from "node:assert/strict";
import { test } from "node:test";

import { crmLoginUrl } from "./config";

test("production CRM origin builds the production staff login URL", () => {
  assert.equal(
    crmLoginUrl("https://crm.home88.estate", "/crm"),
    "https://crm.home88.estate/crm/login",
  );
});

test("development CRM origin builds the local staff login URL", () => {
  assert.equal(crmLoginUrl("http://localhost:3100", "/crm"), "http://localhost:3100/crm/login");
});

test("no CRM origin yields no link (production fails closed)", () => {
  assert.equal(crmLoginUrl("", "/crm"), "");
});

test("trailing slashes on the origin and base path are normalised", () => {
  assert.equal(
    crmLoginUrl("https://crm.home88.estate/", "/crm/"),
    "https://crm.home88.estate/crm/login",
  );
});
