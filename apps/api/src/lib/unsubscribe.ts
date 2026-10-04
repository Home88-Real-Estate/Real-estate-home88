/**
 * One-click unsubscribe links for marketing email.
 *
 * Byte-compatible with the website's verifier (apps/web/src/lib/unsubscribe-token.ts):
 * `base64url(address) + "." + base64url(HMAC-SHA256(secret, address))`.
 * Only UNSUBSCRIBE_SECRET is used here: the CRM and the website are separate
 * deployments, and a link signed with any other secret would not verify on the
 * site. Without it no link is minted and marketing mail is refused.
 */

import { createHmac } from "node:crypto";
import { loadConfig } from "../config";

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function unsubscribeAvailable(): boolean {
  return loadConfig().UNSUBSCRIBE_SECRET.length > 0;
}

export function unsubscribeUrl(email: string): string | null {
  const cfg = loadConfig();
  if (!cfg.UNSUBSCRIBE_SECRET) return null;
  const address = email.trim().toLowerCase();
  const token = `${b64url(address)}.${b64url(createHmac("sha256", cfg.UNSUBSCRIBE_SECRET).update(address).digest())}`;
  return `${cfg.SITE_URL.replace(/\/+$/, "")}/unsubscribe?token=${encodeURIComponent(token)}`;
}
