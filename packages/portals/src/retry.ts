/**
 * Error classes and retry policy for portal operations.
 *
 * A timeout or a 429 is worth trying again; a rejected category or bad
 * credentials is not, and retrying it only repeats the failure (or locks an
 * account). Permanent failures go straight to review; transient ones back off
 * exponentially and are dead-lettered once the attempt budget is spent, so a
 * listing is never retried forever. Limits are configuration.
 */

/** Normalised provider errors. Adapters map whatever a portal says onto these. */
export const PORTAL_ERROR_CODES = [
  "AUTH_FAILED",
  "INVALID_CREDENTIALS",
  "MISSING_REQUIRED_FIELD",
  "UNSUPPORTED_PROPERTY_TYPE",
  "INVALID_PRICE",
  "INVALID_LOCATION",
  "IMAGE_UNAVAILABLE",
  "REMOTE_TIMEOUT",
  "RATE_LIMITED",
  "REMOTE_SERVER_ERROR",
  "PORTAL_REJECTED",
  "TRANSPORT_UNAVAILABLE",
  "DUPLICATE_LISTING",
] as const;

export type PortalErrorCode = (typeof PORTAL_ERROR_CODES)[number];
export type ErrorClass = "TRANSIENT" | "PERMANENT";

const TRANSIENT = new Set<string>(["REMOTE_TIMEOUT", "RATE_LIMITED", "REMOTE_SERVER_ERROR"]);

/** Older rows stored a lowercase code before this taxonomy existed. */
const LEGACY: Record<string, PortalErrorCode> = { api_transport_unavailable: "TRANSPORT_UNAVAILABLE" };

export function normaliseErrorCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return LEGACY[code] ?? code;
}

/**
 * Unknown codes count as transient: refusing to retry something we do not
 * understand would strand listings, and the attempt budget still bounds it.
 */
export function classifyError(code: string | null | undefined): ErrorClass {
  const normalised = normaliseErrorCode(code);
  if (normalised === null) return "TRANSIENT";
  if (TRANSIENT.has(normalised)) return "TRANSIENT";
  return (PORTAL_ERROR_CODES as readonly string[]).includes(normalised) ? "PERMANENT" : "TRANSIENT";
}

export type RetryPolicy = {
  /** Failed attempts allowed before a listing is dead-lettered. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 60_000,
  maxDelayMs: 6 * 60 * 60_000,
};

export function retryPolicyFromSettings(settings: Record<string, unknown> | null | undefined): RetryPolicy {
  const raw = settings?.retry;
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const positive = (value: unknown, fallback: number, max: number) =>
    typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
  const baseDelayMs = positive(v.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs, 24 * 60 * 60_000);
  return {
    maxAttempts: positive(v.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts, 20),
    baseDelayMs,
    maxDelayMs: Math.max(baseDelayMs, positive(v.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs, 7 * 24 * 60 * 60_000)),
  };
}

export type RetryDecision =
  | { action: "RETRY"; delayMs: number; nextRetryAt: Date; reason: string }
  | { action: "DEAD_LETTER"; delayMs: null; nextRetryAt: null; reason: string };

/** `attempts` counts failures so far, including the one just seen. */
export function decideRetry(input: {
  attempts: number;
  errorCode: string | null | undefined;
  policy?: RetryPolicy;
  now?: Date;
}): RetryDecision {
  const policy = input.policy ?? DEFAULT_RETRY_POLICY;
  const now = input.now ?? new Date();

  if (classifyError(input.errorCode) === "PERMANENT") {
    return { action: "DEAD_LETTER", delayMs: null, nextRetryAt: null, reason: "permanent error; needs review" };
  }
  if (input.attempts >= policy.maxAttempts) {
    return { action: "DEAD_LETTER", delayMs: null, nextRetryAt: null, reason: `gave up after ${input.attempts} attempts` };
  }
  const exponent = Math.max(0, input.attempts - 1);
  const delayMs = Math.min(policy.baseDelayMs * 2 ** exponent, policy.maxDelayMs);
  return {
    action: "RETRY",
    delayMs,
    nextRetryAt: new Date(now.getTime() + delayMs),
    reason: `retry ${input.attempts}/${policy.maxAttempts}`,
  };
}

/** A failed listing may be attempted again only when it is not parked and its backoff has elapsed. */
export function isRetryDue(input: { needsReview: boolean; nextRetryAt: Date | null; now?: Date }): boolean {
  if (input.needsReview) return false;
  if (!input.nextRetryAt) return true;
  return input.nextRetryAt.getTime() <= (input.now ?? new Date()).getTime();
}
