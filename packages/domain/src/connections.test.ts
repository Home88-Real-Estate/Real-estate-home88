import { test } from "node:test";
import assert from "node:assert/strict";

import { connectionNeedsAttention, providerConnectionStatus, serverSettingStatus, summariseConnections } from "./connections";

test("provider connections: settings, adapter and observed deliveries decide the status", () => {
  assert.equal(providerConnectionStatus({ state: "not_configured" }), "NOT_CONFIGURED");
  assert.equal(providerConnectionStatus({ state: "no_adapter", lastSuccessAt: new Date() }), "PLANNED", "a provider without an adapter never sends");
  assert.equal(providerConnectionStatus({ state: "configured" }), "CONFIGURED");
  assert.equal(providerConnectionStatus({ state: "environment", lastSuccessAt: "2026-10-01T10:00:00Z" }), "CONNECTED");
  assert.equal(
    providerConnectionStatus({ state: "configured", lastSuccessAt: "2026-10-01T10:00:00Z", lastErrorAt: "2026-10-02T10:00:00Z" }),
    "ERROR",
    "a failure after the last success is an error",
  );
  assert.equal(
    providerConnectionStatus({ state: "configured", lastSuccessAt: "2026-10-03T10:00:00Z", lastErrorAt: "2026-10-02T10:00:00Z" }),
    "CONNECTED",
    "a success after a failure clears it",
  );
});

test("server settings and the summary", () => {
  assert.equal(serverSettingStatus(false, new Date()), "NOT_CONFIGURED");
  assert.equal(serverSettingStatus(true), "CONFIGURED");
  assert.equal(serverSettingStatus(true, new Date()), "CONNECTED");
  assert.equal(connectionNeedsAttention("DISABLED"), false);
  assert.equal(connectionNeedsAttention("PLANNED"), false);
  assert.deepEqual(summariseConnections(["CONNECTED", "CONFIGURED", "ERROR", "NOT_CONFIGURED", "PLANNED", "DISABLED"]), { total: 6, working: 2, attention: 2 });
});
