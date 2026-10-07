/**
 * Short-lived, scoped links for a portal to fetch one approved photo.
 *
 * The media bucket stays private. A token names exactly one media item of one
 * property for one portal, expires, and is signed with a key only the server
 * knows. It carries no storage key and grants no listing, upload or delete: the
 * route that honours it re-checks that the media is still approved.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type PortalMediaClaims = {
  /** Property id. */
  p: string;
  /** Media id. */
  m: string;
  /** Portal code. */
  c: string;
  /** Expiry, seconds since the epoch. */
  e: number;
  /** Random, so two tokens for the same photo differ. */
  n: string;
};

export const DEFAULT_PORTAL_MEDIA_TTL_SECONDS = 60 * 60;
export const MAX_PORTAL_MEDIA_TTL_SECONDS = 24 * 60 * 60;

const sign = (body: string, key: Buffer) => createHmac("sha256", key).update(body).digest("base64url");

export function signPortalMediaToken(
  input: { propertyId: string; mediaId: string; portalCode: string },
  key: Buffer,
  options: { ttlSeconds?: number; now?: Date } = {},
): string {
  const ttl = Math.min(Math.max(1, options.ttlSeconds ?? DEFAULT_PORTAL_MEDIA_TTL_SECONDS), MAX_PORTAL_MEDIA_TTL_SECONDS);
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const claims: PortalMediaClaims = { p: input.propertyId, m: input.mediaId, c: input.portalCode, e: now + ttl, n: randomBytes(9).toString("base64url") };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export type VerifiedPortalMediaToken = { ok: true; claims: PortalMediaClaims } | { ok: false; reason: "malformed" | "signature" | "expired" };

export function verifyPortalMediaToken(token: string, key: Buffer, now: Date = new Date()): VerifiedPortalMediaToken {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, signature] = parts as [string, string];

  const expected = Buffer.from(sign(body, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "signature" };

  let claims: PortalMediaClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PortalMediaClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof claims.p !== "string" || typeof claims.m !== "string" || typeof claims.c !== "string" || typeof claims.e !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (claims.e * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
