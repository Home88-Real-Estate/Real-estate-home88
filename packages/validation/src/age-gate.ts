/**
 * COPPA age gate.
 *
 * The rules this implements, and why each one is here:
 *
 *  - The check is SERVER-side. A checkbox in React is a hint, not a control;
 *    the same function runs in the route handler before any insert.
 *  - Under-13 submissions are REFUSED and NOTHING is persisted. Not a lead,
 *    not a contact, not a "blocked" audit row containing their name. A refusal
 *    that writes the rejected data to a log is still collection.
 *  - Date of birth is not stored. We record only the timestamp of the decision
 *    and the boolean outcome, so we can show that a gate was applied without
 *    holding a birth date we have no other need for.
 *  - Two ways to satisfy it: an explicit date of birth, or an explicit
 *    affirmation. The affirmation alone is acceptable under COPPA only if we
 *    take reasonable steps to verify; we do not verify, so date of birth is the
 *    preferred path and the server prefers it when both are supplied.
 *  - The refusal path is silent about why, so it cannot be used to probe the
 *    boundary, and it never echoes the submitted values back.
 */

import { z } from "zod";

export const MINIMUM_AGE_YEARS = 13;

/** Injectable for tests; production passes nothing and gets `new Date()`. */
export type Clock = () => Date;

export type AgeGateInput = {
  dateOfBirth?: unknown;
  ageAffirmation?: unknown;
};

export type AgeGateDecision =
  | { eligible: true; method: "date_of_birth" | "affirmation" }
  | { eligible: false; reason: "missing" | "invalid" | "underage" | "implausible" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whole years elapsed, computed in UTC so a timezone near midnight cannot
 * shift the result by a day and change the answer.
 */
export function yearsBetween(dob: Date, now: Date): number {
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dob.getUTCDate())) {
    years -= 1;
  }
  return years;
}

/**
 * Pure decision function. No I/O, no storage, no logging.
 */
export function evaluateAgeGate(
  input: AgeGateInput,
  clock: Clock = () => new Date(),
): AgeGateDecision {
  const rawDob = typeof input.dateOfBirth === "string" ? input.dateOfBirth.trim() : "";

  if (rawDob.length > 0) {
    if (!ISO_DATE.test(rawDob)) return { eligible: false, reason: "invalid" };

    const dob = new Date(`${rawDob}T00:00:00.000Z`);
    if (Number.isNaN(dob.getTime())) return { eligible: false, reason: "invalid" };

    const now = clock();

    // A date in the future, or before live people were born, means the field was
    // filled in carelessly or dishonestly. Either way we cannot rely on it.
    if (dob.getTime() > now.getTime()) return { eligible: false, reason: "implausible" };
    if (dob.getUTCFullYear() < 1900) return { eligible: false, reason: "implausible" };

    return yearsBetween(dob, now) >= MINIMUM_AGE_YEARS
      ? { eligible: true, method: "date_of_birth" }
      : { eligible: false, reason: "underage" };
  }

  if (input.ageAffirmation === true || input.ageAffirmation === "true" || input.ageAffirmation === "on") {
    return { eligible: true, method: "affirmation" };
  }

  return { eligible: false, reason: "missing" };
}

/**
 * Schema fragment to spread into every form that collects a name, email,
 * phone or photo from someone who may not have an account: property enquiry,
 * property submission, general contact, and request-a-property.
 *
 * Making this part of the schema means a new capture form is non-compliant
 * until it opts in, rather than compliant until someone remembers.
 */
export const ageGateSchema = {
  /** Optional. Preferred over the affirmation when present. */
  dateOfBirth: z
    .string()
    .regex(ISO_DATE, "Use YYYY-MM-DD.")
    .max(10)
    .optional()
    .or(z.literal("").transform(() => undefined)),

  /** The UI copy must state the age, not just say "I agree". */
  ageAffirmation: z
    .boolean()
    .optional()
    .default(false),

  /**
   * Honeypot. A field a human never sees. Bots that fill everything in get
   * dropped before the age gate even runs.
   */
  website: z.string().max(0, "Rejected.").optional().or(z.literal("")),
} satisfies Record<string, z.ZodTypeAny>;

export type AgeGateFields = z.infer<ReturnType<typeof buildAgeGateSchema>>;

export function buildAgeGateSchema() {
  return z.object(ageGateSchema);
}

/**
 * Run after parsing. Returns the decision so the caller can record
 * `ageVerifiedAt` on the lead, and must branch on `eligible` before writing.
 */
export function assertAgeGate(
  parsed: AgeGateInput,
  clock?: Clock,
): { ok: true; decision: AgeGateDecision & { eligible: true } } | { ok: false; decision: AgeGateDecision } {
  const decision = evaluateAgeGate(parsed, clock);
  if (decision.eligible) {
    return { ok: true, decision: decision as AgeGateDecision & { eligible: true } };
  }
  return { ok: false, decision: decision as AgeGateDecision & { eligible: false } };
}

/**
 * Deliberately vague, identical for every failure mode. Distinguishing
 * "under 13" from "malformed" tells a prober how close they were.
 */
export const AGE_GATE_REFUSAL_MESSAGE =
  "We could not accept this submission. Please check the date of birth field " +
  "and confirm you are at least 13 years old, then try again.";

export const AGE_GATE_HONEYPOT_REFUSAL_MESSAGE = "Submission rejected.";
