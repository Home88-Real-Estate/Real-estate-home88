/**
 * Consent state.
 *
 * Rules this module enforces:
 *   - Non-essential purposes default to DENIED. Absence of a cookie is not
 *     consent, and a corrupt cookie is treated as no consent rather than as
 *     whatever the corrupt bytes happen to parse to.
 *   - The choice is revocable and versioned. Withdrawal is as easy as granting:
 *     the same banner is reachable from the footer at any time.
 *   - A stored choice records the version it was made against, so a change to
 *     the policy re-prompts instead of silently inheriting old consent.
 *
 * This lives on the server so a client component cannot fabricate a "granted"
 * state by writing localStorage the analytics loader trusts.
 */

import { COMPANY } from "./config";

export const CONSENT_COOKIE = "h88_consent";

export type ConsentPurpose = "analytics" | "marketing" | "session_replay";

export type ConsentState = {
  /** Version of the policy the choice was made against. */
  version: string;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  sessionReplay: boolean;
  decidedAt: string;
};

export const DENY_ALL: ConsentState = {
  version: COMPANY.policyVersion,
  necessary: true,
  analytics: false,
  marketing: false,
  sessionReplay: false,
  decidedAt: "",
};

export function parseConsent(raw: string | undefined | null): ConsentState {
  if (!raw) return DENY_ALL;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<ConsentState>;

    // A policy change invalidates the stored decision.
    if (parsed.version !== COMPANY.policyVersion) return DENY_ALL;

    return {
      version: COMPANY.policyVersion,
      necessary: true,
      // Strictly boolean coercion: anything that is not exactly `true` is false.
      analytics: parsed.analytics === true,
      marketing: parsed.marketing === true,
      sessionReplay: parsed.sessionReplay === true,
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : "",
    };
  } catch {
    return DENY_ALL;
  }
}

export function serializeConsent(state: ConsentState): string {
  return encodeURIComponent(
    JSON.stringify({
      version: COMPANY.policyVersion,
      necessary: true,
      analytics: state.analytics,
      marketing: state.marketing,
      sessionReplay: state.sessionReplay,
      decidedAt: state.decidedAt || new Date().toISOString(),
    }),
  );
}

export function allows(state: ConsentState, purpose: ConsentPurpose): boolean {
  switch (purpose) {
    case "analytics":
      return state.analytics;
    case "marketing":
      return state.marketing;
    case "session_replay":
      return state.sessionReplay;
    default:
      return false;
  }
}

/** True when the visitor has not made a choice yet, so the banner should show. */
export function needsDecision(state: ConsentState): boolean {
  return state.decidedAt.length === 0;
}
