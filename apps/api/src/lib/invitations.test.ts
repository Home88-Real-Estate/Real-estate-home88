import assert from "node:assert/strict";
import { test } from "node:test";
import { generateInviteToken, hashInviteToken, inviteExpiry, isInviteUsable, INVITE_TTL_DAYS } from "./invitations";

test("invite tokens are url-safe and unique", () => {
  const a = generateInviteToken();
  const b = generateInviteToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("invite tokens are stored only as a SHA-256 hash", () => {
  const token = "invite-token-example-value";
  assert.equal(hashInviteToken(token), hashInviteToken(token));
  assert.match(hashInviteToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashInviteToken(token), token);
});

test("invite expiry is the configured window from now", () => {
  const now = Date.now();
  assert.equal(inviteExpiry(now).getTime() - now, INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
});

test("an invite is usable only while pending and unexpired", () => {
  const now = Date.now();
  const pending = { acceptedAt: null, revokedAt: null, expiresAt: new Date(now + 60_000) };
  assert.equal(isInviteUsable(pending, now), true);

  assert.equal(
    isInviteUsable({ ...pending, acceptedAt: new Date(now - 1) }, now),
    false,
  );
  assert.equal(isInviteUsable({ ...pending, revokedAt: new Date(now - 1) }, now), false);
  assert.equal(isInviteUsable({ ...pending, expiresAt: new Date(now) }, now), false);
});
