/**
 * Staff-invitation tokens.
 *
 * Same discipline as sessions and password resets: the emailed token is random
 * and the database stores only its SHA-256. An invitation is single-use, can be
 * revoked before it is accepted, and expires. Kept pure so the rules can be
 * tested without a database.
 */

import { randomBytes } from "node:crypto";
import { hashToken } from "./sessions";

/** How long an emailed invitation stays valid. */
export const INVITE_TTL_DAYS = 7;

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Reuses the session hasher; both are plain SHA-256 over the opaque token. */
export const hashInviteToken = hashToken;

export function inviteExpiry(now: number = Date.now()): Date {
  return new Date(now + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Usable means: not yet accepted, not revoked, and not past expiry. Expiry is
 * exclusive, matching the reset-token rule.
 */
export function isInviteUsable(
  invite: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: number = Date.now(),
): boolean {
  if (invite.acceptedAt || invite.revokedAt) return false;
  return invite.expiresAt.getTime() > now;
}
