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

/**
 * The internal CRM lives on its own origin (e.g. https://crm.home88.estate) and
 * is served under a base path. Only the public login URL is used here; the
 * public site never holds a CRM session.
 *
 * Production fails closed: with no NEXT_PUBLIC_CRM_URL configured, the staff
 * link is hidden rather than pointing at localhost (a placeholder that would
 * 404 or, worse, hit a developer machine).
 */
export const CRM_URL = (() => {
  const configured = process.env.NEXT_PUBLIC_CRM_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return isProduction ? "" : "http://localhost:3100";
})();
export const CRM_BASE_PATH = optional("NEXT_PUBLIC_CRM_BASE_PATH", "/crm").replace(/\/+$/, "");

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
