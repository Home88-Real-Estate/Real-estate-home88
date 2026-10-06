/**
 * Origin check for cookie-authenticated writes (CSRF defence).
 *
 * A browser attaches `Origin` to cross-site writes and the attacker cannot
 * change it. A write is allowed when that origin is
 *   1. the origin this very request was served from (same-origin: the CRM page
 *      and its /crm/api calls share a host, whatever alias the deployment is
 *      reached by), or
 *   2. one of the explicitly configured origins (CRM_URL, SITE_URL, and the
 *      comma-separated CRM_PUBLIC_ORIGINS for a website that also serves /crm).
 * Anything else is rejected. There is no wildcard and no suffix matching, so a
 * random `*.vercel.app` deployment is never trusted.
 */

/** Normalises to `scheme://host[:port]`, or null when it is not a http(s) origin. */
export function normaliseOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Parses a comma-separated list of origins; invalid entries are dropped. */
export function parseOriginList(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => normaliseOrigin(v))
    .filter((v): v is string => v !== null);
}

type Headers = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim() || undefined;

/**
 * The origin the request was addressed to. Behind Vercel's edge the forwarded
 * headers are set by the platform; a browser on another site cannot choose
 * them (a custom header would need a CORS preflight, which is refused).
 */
export function requestOrigin(headers: Headers): string | null {
  const host = one(headers["x-forwarded-host"]) ?? one(headers.host);
  if (!host) return null;
  const proto = one(headers["x-forwarded-proto"]);
  // Without a forwarded protocol the scheme is unknown: compare on host only (see isAllowedOrigin).
  return normaliseOrigin(`${proto ?? "https"}://${host}`);
}

export function isAllowedOrigin(origin: string, allowed: readonly string[], headers: Headers): boolean {
  const o = normaliseOrigin(origin);
  if (!o) return false;
  if (allowed.some((a) => normaliseOrigin(a) === o)) return true;
  const self = requestOrigin(headers);
  if (!self) return false;
  if (o === self) return true;
  // Plain-http dev servers send no forwarded protocol; accept http only for the same host there.
  if (!one(headers["x-forwarded-proto"])) {
    const a = new URL(o);
    const b = new URL(self);
    return a.host === b.host && a.protocol === "http:";
  }
  return false;
}
