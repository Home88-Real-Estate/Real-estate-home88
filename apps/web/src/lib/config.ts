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

export const SITE_URL = optional("NEXT_PUBLIC_SITE_URL", "http://localhost:3000").replace(/\/+$/, "");

export const COMPANY = {
  /** Shown in the privacy notice and the footer of every commercial email. */
  legalName: optional("COMPANY_LEGAL_NAME", "HOME88"),
  postalAddress: optional("COMPANY_POSTAL_ADDRESS"),
  privacyEmail: optional("COMPANY_PRIVACY_EMAIL", "privacy@example.com"),
  dmcaEmail: optional("COMPANY_DMCA_EMAIL", "dmca@example.com"),
  /**
   * Public contact details. All three are optional and every surface that shows
   * them renders only when a value is configured, so a half-set deployment
   * never prints "undefined" or invents a phone number.
   */
  phone: optional("COMPANY_PHONE"),
  contactEmail: optional("COMPANY_CONTACT_EMAIL"),
  hours: optional("COMPANY_HOURS"),
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

export const isProduction = process.env.NODE_ENV === "production";

export { required };
