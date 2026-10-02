import assert from "node:assert/strict";
import { test } from "node:test";
import {
  forgotPasswordSchema,
  passwordChangeSchema,
  resetPasswordSchema,
} from "@home88/validation";
import {
  generateResetToken,
  hashResetToken,
  isResetUsable,
  resetExpiry,
  RESET_TOKEN_TTL_MINUTES,
} from "./password-reset";

test("reset tokens are url-safe, unique and sufficiently long", () => {
  const a = generateResetToken();
  const b = generateResetToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("token hashing is deterministic and one-way", () => {
  const token = "example-reset-token-value";
  assert.equal(hashResetToken(token), hashResetToken(token));
  assert.notEqual(hashResetToken(token), hashResetToken(`${token}x`));
  assert.match(hashResetToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashResetToken(token), token);
});

test("reset expiry is the configured window from now", () => {
  const now = Date.now();
  const at = resetExpiry(now).getTime();
  assert.equal(at - now, RESET_TOKEN_TTL_MINUTES * 60 * 1000);
});

test("a token is usable only before expiry and before first use", () => {
  const now = Date.now();
  const fresh = { usedAt: null, expiresAt: new Date(now + 60_000) };
  assert.equal(isResetUsable(fresh, now), true);

  const used = { usedAt: new Date(now - 1_000), expiresAt: new Date(now + 60_000) };
  assert.equal(isResetUsable(used, now), false);

  const expired = { usedAt: null, expiresAt: new Date(now) };
  assert.equal(isResetUsable(expired, now), false);
});

test("forgot-password schema normalises the email and rejects garbage", () => {
  const parsed = forgotPasswordSchema.parse({ email: "  Staff@HOME88.GR " });
  assert.equal(parsed.email, "staff@home88.gr");
  assert.equal(forgotPasswordSchema.safeParse({ email: "not-an-email" }).success, false);
});

test("reset-password schema enforces a real token and the password policy", () => {
  assert.equal(
    resetPasswordSchema.safeParse({ token: "short", newPassword: "correct-horse-8X!" }).success,
    false,
  );
  assert.equal(
    resetPasswordSchema.safeParse({ token: "x".repeat(40), newPassword: "weakpassword" }).success,
    false,
  );
  assert.equal(
    resetPasswordSchema.safeParse({
      token: "x".repeat(40),
      newPassword: "correct-horse-8X!",
    }).success,
    true,
  );
});

test("password-change schema requires the current password and a strong new one", () => {
  assert.equal(passwordChangeSchema.safeParse({ newPassword: "correct-horse-8X!" }).success, false);
  assert.equal(
    passwordChangeSchema.safeParse({ currentPassword: "old", newPassword: "short" }).success,
    false,
  );
  assert.equal(
    passwordChangeSchema.safeParse({
      currentPassword: "old-password-1A!",
      newPassword: "correct-horse-8X!",
    }).success,
    true,
  );
});
