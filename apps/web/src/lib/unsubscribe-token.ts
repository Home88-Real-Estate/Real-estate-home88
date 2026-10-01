/**
 * Signed unsubscribe tokens.
 *
 * A one-click unsubscribe link must identify the recipient without letting one
 * person unsubscribe another. The address is carried in the clear (it is their
 * own address, in their own email) but is only honoured together with an HMAC
 * computed over it, so the link cannot be edited to a different address.
 *
 * If no secret is configured the token cannot be minted and the mailer will
 * fall back to a preference-centre link that asks the recipient to type their
 * address — failing closed rather than emitting an unauthenticated link.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET =
  process.env.UNSUBSCRIBE_SECRET ?? process.env.JWT_SECRET ?? process.env.PII_HASH_PEPPER ?? "";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(email: string): string {
  return base64url(createHmac("sha256", SECRET).update(email.trim().toLowerCase()).digest());
}

export function hasUnsubscribeSecret(): boolean {
  return SECRET.length > 0;
}

export function createUnsubscribeToken(email: string): string | null {
  if (!SECRET) return null;
  const normalised = email.trim().toLowerCase();
  return `${base64url(normalised)}.${sign(normalised)}`;
}

export function verifyUnsubscribeToken(token: string): { email: string } | null {
  if (!SECRET) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  let email: string;
  try {
    email = fromBase64url(token.slice(0, dot)).toString("utf8");
  } catch {
    return null;
  }
  if (!email || email.length > 254 || !email.includes("@")) return null;

  const expected = Buffer.from(sign(email));
  const provided = Buffer.from(token.slice(dot + 1));
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  return { email: email.trim().toLowerCase() };
}
