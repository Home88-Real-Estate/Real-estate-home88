/**
 * Server-side configuration readers.
 *
 * Everything here is read from the environment at request time and never baked
 * into a client bundle: no module that imports this file is a client component,
 * and the values are public origins rather than secrets. The `NEXT_PUBLIC_`
 * spelling is still accepted for compatibility (see `resolvePublic`).
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const isProduction = process.env.NODE_ENV === "production";

/**
 * Reads a value that may be published under either the Next.js `NEXT_PUBLIC_`
 * name or the plain, server-only name.
 *
 * `NEXT_PUBLIC_` is inlined into the client bundle, and hosting platforms warn
 * about it and steer you to a private name instead. That warning does not apply
 * here: nothing in this app reads these values from the browser — every consumer
 * of this module is a server component or a server-side route handler — and
 * these values are public origins, not secrets. So the plain name is accepted
 * and the prefixed one stays supported, in case a deployment already sets it.
 */
export function resolvePublic(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return env[`NEXT_PUBLIC_${name}`]?.trim() || env[name]?.trim() || "";
}

function publicValue(name: string, fallback: string): string {
  return resolvePublic(name) || fallback;
}

export const SITE_URL = publicValue("SITE_URL", "http://localhost:3000").replace(/\/+$/, "");

export const CRM_BASE_PATH = publicValue("CRM_BASE_PATH", "/crm").replace(/\/+$/, "");

/**
 * Builds the staff sign-in URL from the CRM origin and base path. Kept pure so
 * the footer link and its tests share one source of truth; an empty origin
 * defensively yields no link (the column is then not rendered).
 */
export function crmLoginUrl(origin: string, basePath: string): string {
  if (!origin) return "";
  return `${origin.replace(/\/+$/, "")}${basePath.replace(/\/+$/, "")}/login`;
}

/**
 * The HOME88 CRM's production deployment. Keep in sync with
 * DEFAULT_CRM_ORIGIN in next.config.mjs.
 */
export const DEFAULT_CRM_ORIGIN = "https://real-estate-home88-iota.vercel.app";

/**
 * Where the footer's staff sign-in link points. The public site never holds a
 * CRM session; it only links to the CRM's own login page.
 *
 *  1. CRM_URL set (NEXT_PUBLIC_CRM_URL also accepted): that origin, e.g.
 *     crm.home88.estate once its DNS exists.
 *  2. CRM_ORIGIN set: the CRM deployment it names.
 *  3. Otherwise in production: the HOME88 CRM deployment (DEFAULT_CRM_ORIGIN).
 *  4. Development: the local CRM on port 3100.
 */
export function resolveCrmLoginUrl(env: {
  crmUrl?: string;
  crmOrigin?: string;
  basePath: string;
  production: boolean;
}): string {
  const origin =
    env.crmUrl?.trim() ||
    env.crmOrigin?.trim() ||
    (env.production ? DEFAULT_CRM_ORIGIN : "http://localhost:3100");
  return crmLoginUrl(origin, env.basePath);
}

/** The one staff sign-in URL used by the footer. */
export const CRM_LOGIN_URL = resolveCrmLoginUrl({
  crmUrl: resolvePublic("CRM_URL"),
  crmOrigin: process.env.CRM_ORIGIN,
  basePath: CRM_BASE_PATH,
  production: isProduction,
});

/**
 * Absolute base for public media (object storage). Blank falls back to the
 * root-relative `/media/<key>` route on this origin, so it only has to be set
 * when the bucket is served from a different host.
 */
export const MEDIA_BASE_URL = publicValue("MEDIA_BASE_URL", "").replace(/\/+$/, "");

export const COMPANY = {
  /** Shown in the privacy notice and the footer of every commercial email. */
  legalName: optional("COMPANY_LEGAL_NAME", "HOME88"),
  postalAddress: optional("COMPANY_POSTAL_ADDRESS"),
  privacyEmail: optional("COMPANY_PRIVACY_EMAIL", "privacy@example.com"),
  dmcaEmail: optional("COMPANY_DMCA_EMAIL", "dmca@example.com"),
  /**
   * Public contact details. Phone and hours fall back to the published HOME88
   * values so the header always shows them; contact email stays optional and
   * only renders when configured.
   */
  phone: optional("COMPANY_PHONE", "2166003838"),
  contactEmail: optional("COMPANY_CONTACT_EMAIL"),
  hours: optional("COMPANY_HOURS", "Δευτέρα - Παρασκευή 09:00 - 17:00, Σάββατο 10:00 - 14:00"),
  /**
   * Bumped whenever the privacy notice or cookie policy changes materially.
   * Consent records store the version the person agreed to, so a change means
   * we can tell whose consent is against an outdated text.
   */
  policyVersion: optional("POLICY_VERSION", "2026-10-01"),
} as const;

export const DATABASE_URL = process.env.DATABASE_URL ?? "";

/** True when a real database is configured. Pages degrade rather than crash. */
export const HAS_DATABASE = DATABASE_URL.trim().length > 0;

export { required };
