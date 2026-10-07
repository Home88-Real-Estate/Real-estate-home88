/**
 * Portal photo delivery.
 *
 * A portal fetches photos from URLs, but the media bucket is private. For a
 * portal operation each approved photo gets its own scoped, expiring link on
 * the CRM's own origin; the route behind it (GET /portal-media/:token) serves
 * that one photo and nothing else. Links carry no storage key, and the signing
 * key is derived from the settings encryption key, so no new secret is needed.
 */

import { createHmac } from "node:crypto";

import { signPortalMediaToken } from "@home88/portals";
import { loadConfig } from "../config";
import { HttpError } from "./errors";
import { parseKey } from "../settings/secret-box";

const DOMAIN = "h88-portal-media-v1";

/** Signing key for portal media links, or throws a 503 when the server has no encryption key. */
export function portalMediaKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const root = parseKey(env.SETTINGS_ENCRYPTION_KEY);
  if (!root) throw new HttpError(503, "media_delivery_unavailable", "Η παράδοση φωτογραφιών προς portals δεν είναι διαθέσιμη (λείπει το κλειδί κρυπτογράφησης).");
  return createHmac("sha256", root).update(DOMAIN).digest();
}

export function portalMediaUrl(input: { propertyId: string; mediaId: string; portalCode: string }, options: { ttlSeconds?: number; now?: Date } = {}): string {
  const cfg = loadConfig();
  const token = signPortalMediaToken(input, portalMediaKey(), options);
  return `${cfg.CRM_URL.replace(/\/+$/, "")}${cfg.CRM_BASE_PATH}/api/portal-media/${token}`;
}
