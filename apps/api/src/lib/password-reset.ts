/**
 * Password-reset tokens.
 *
 * Same rule as sessions: the raw token only ever exists in the emailed link and
 * the request that redeemed it; the database stores its SHA-256. A leaked
 * database therefore cannot be turned into a working reset link.
 *
 * Tokens are single-use and short-lived. These pure helpers are kept apart from
 * the route so the expiry and single-use rules can be tested without a database.
 */

import { createHash, randomBytes } from "node:crypto";

/** How long an emailed reset link stays valid. */
export const RESET_TOKEN_TTL_MINUTES = 60;

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function resetExpiry(now: number = Date.now()): Date {
  return new Date(now + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
}

/**
 * A token is usable only if it exists in this shape: never redeemed and not
 * past its expiry. Expiry is exclusive, so a token whose expiry equals `now`
 * is treated as expired.
 */
export function isResetUsable(
  token: { usedAt: Date | null; expiresAt: Date },
  now: number = Date.now(),
): boolean {
  if (token.usedAt) return false;
  return token.expiresAt.getTime() > now;
}
