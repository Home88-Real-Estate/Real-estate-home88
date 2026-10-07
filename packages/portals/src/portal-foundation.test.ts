import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { checkEnvironment, credentialHint, maskedCredential, summariseCredential } from "./account";
import { checkProviderContract } from "./provider-contract";
import { signPortalMediaToken, verifyPortalMediaToken } from "./media-token";
import { createMockProvider, MOCK_MODES, mockExternalId } from "./mock-provider";
import { classifyError } from "./retry";
import { makePortalProperty as sampleProperty } from "./test-fixtures";

test("credential mask: only the last four characters of a long value, never of a short one", () => {
  assert.equal(credentialHint("sk-live-1234567890abcd"), "abcd");
  assert.equal(credentialHint("short-secret"), "cret");
  assert.equal(credentialHint("tiny"), null);
  assert.equal(maskedCredential("abcd"), "********abcd");
  assert.equal(maskedCredential(null), "********");
  const s = summariseCredential("abcd", new Date("2026-10-07T00:00:00Z"));
  assert.deepEqual(s, { configured: true, masked: "********abcd", changedAt: "2026-10-07T00:00:00.000Z" });
  assert.deepEqual(summariseCredential(null, null), { configured: false, masked: null, changedAt: null });
});

test("environment is explicit: a request must name the account's own environment", () => {
  assert.equal(checkEnvironment("TEST", "TEST").ok, true);
  assert.equal(checkEnvironment("TEST", "PRODUCTION").ok, false);
  assert.equal(checkEnvironment("PRODUCTION", "TEST").ok, false);
  assert.equal(checkEnvironment("PRODUCTION", null).ok, false);
  assert.equal(checkEnvironment("TEST", undefined).ok, false);
});

test("mock provider satisfies the provider contract and never needs the network", async () => {
  assert.deepEqual(checkProviderContract(createMockProvider("XE_GR")), []);
  const p = createMockProvider("XE_GR");
  const property = sampleProperty();
  const first = await p.publishProperty!(property);
  const again = await p.publishProperty!(property);
  assert.ok(first.ok && again.ok);
  if (first.ok && again.ok) assert.equal(first.externalId, again.externalId, "repeating a publish lands on the same listing id");
  if (first.ok) assert.equal(first.externalId, mockExternalId(property.reference));
});

test("every mock failure mode maps onto a normalised error class", async () => {
  const expected: Record<string, { code: string; cls: "TRANSIENT" | "PERMANENT" }> = {
    temporary_failure: { code: "REMOTE_SERVER_ERROR", cls: "TRANSIENT" },
    rate_limit: { code: "RATE_LIMITED", cls: "TRANSIENT" },
    timeout: { code: "REMOTE_TIMEOUT", cls: "TRANSIENT" },
    authentication_failure: { code: "INVALID_CREDENTIALS", cls: "PERMANENT" },
    duplicate: { code: "DUPLICATE_LISTING", cls: "PERMANENT" },
  };
  for (const mode of MOCK_MODES) {
    const r = await createMockProvider("SPITOGATOS", mode).publishProperty!(sampleProperty());
    if (mode === "success") {
      assert.equal(r.ok, true);
    } else if (mode === "validation_error") {
      assert.ok(createMockProvider("SPITOGATOS", mode).validateProperty!(sampleProperty()).errors.length > 0);
    } else {
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.code, expected[mode]!.code);
        assert.equal(classifyError(r.code), expected[mode]!.cls);
        if (mode === "duplicate") assert.equal(r.externalId, mockExternalId(sampleProperty().reference));
      }
    }
  }
});

test("portal media token: valid, expired, tampered, wrong key", () => {
  const key = randomBytes(32);
  const claims = { propertyId: "prop1", mediaId: "med1", portalCode: "XE_GR" };
  const now = new Date("2026-10-07T10:00:00Z");
  const token = signPortalMediaToken(claims, key, { ttlSeconds: 60, now });

  const ok = verifyPortalMediaToken(token, key, new Date(now.getTime() + 30_000));
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual([ok.claims.p, ok.claims.m, ok.claims.c], ["prop1", "med1", "XE_GR"]);

  const expired = verifyPortalMediaToken(token, key, new Date(now.getTime() + 61_000));
  assert.deepEqual(expired, { ok: false, reason: "expired" });

  const [body, sig] = token.split(".") as [string, string];
  const forged = Buffer.from(JSON.stringify({ p: "prop2", m: "med1", c: "XE_GR", e: 9999999999, n: "x" })).toString("base64url");
  assert.deepEqual(verifyPortalMediaToken(`${forged}.${sig}`, key, now), { ok: false, reason: "signature" });
  assert.deepEqual(verifyPortalMediaToken(token, randomBytes(32), now), { ok: false, reason: "signature" });
  assert.deepEqual(verifyPortalMediaToken("garbage", key, now), { ok: false, reason: "malformed" });
  assert.deepEqual(verifyPortalMediaToken(`${body}.`, key, now), { ok: false, reason: "malformed" });

  assert.ok(!token.includes("properties/"), "no storage key in the token");
  assert.notEqual(token, signPortalMediaToken(claims, key, { ttlSeconds: 60, now }), "two tokens for the same photo differ");
});

test("token lifetime is capped", () => {
  const key = randomBytes(32);
  const now = new Date("2026-10-07T10:00:00Z");
  const t = signPortalMediaToken({ propertyId: "p", mediaId: "m", portalCode: "XE_GR" }, key, { ttlSeconds: 10 * 24 * 3600, now });
  assert.equal(verifyPortalMediaToken(t, key, new Date(now.getTime() + 25 * 3600_000)).ok, false);
});
