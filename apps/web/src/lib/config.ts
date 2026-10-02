/**
 * Server-side configuration readers.
 *
 * Everything here is read from the environment at request time, never baked
 * into a client bundle except the three NEXT_PUBLIC_ values, which are
 * intentionally public and contain no secrets.
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

export const SITE_URL = optional("NEXT_PUBLIC_SITE_URL", "http://localhost:3000").replace(/\/+$/, "");

export const CRM_BASE_PATH = optional("NEXT_PUBLIC_CRM_BASE_PATH", "/crm").replace(/\/+$/, "");

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
 * Where the footer's staff sign-in link points. The public site never holds a
 * CRM session; it only links to the login page.
 *
 *  1. NEXT_PUBLIC_CRM_URL set: the CRM has its own origin (e.g. a subdomain
 *     whose DNS exists) and the link goes there.
 *  2. Otherwise in production: the CRM is served on this site's own origin
 *     under /crm (rewritten to the CRM deployment named by CRM_ORIGIN, see
 *     next.config.mjs), so the link is same-origin /crm/login. No extra domain
 *     or DNS record is needed.
 *  3. Development: the local CRM on port 3100, unless CRM_ORIGIN proxies it.
 */
export function resolveCrmLoginUrl(env: {
  crmUrl?: string;
  crmOrigin?: string;
  basePath: string;
  production: boolean;
}): string {
  const base = env.basePath.replace(/\/+$/, "");
  const configured = env.crmUrl?.trim();
  if (configured) return crmLoginUrl(configured, base);
  if (env.production || env.crmOrigin?.trim()) return `${base}/login`;
  return crmLoginUrl("http://localhost:3100", base);
}

/** The one staff sign-in URL used by the footer. */
export const CRM_LOGIN_URL = resolveCrmLoginUrl({
  crmUrl: process.env.NEXT_PUBLIC_CRM_URL,
  crmOrigin: process.env.CRM_ORIGIN,
  basePath: CRM_BASE_PATH,
  production: isProduction,
});

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
