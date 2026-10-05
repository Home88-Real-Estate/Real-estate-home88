/**
 * Age gate: HOME88 is an 18+ service.
 *
 * The rules this implements, and why each one is here:
 *
 *  - The check is SERVER-side. A checkbox in React is a hint, not a control;
 *    the same function runs in the route handler before any insert.
 *  - Under-18 submissions are REFUSED and NOTHING is persisted. Not a lead,
 *    not a contact, not a "blocked" audit row containing their name. A refusal
 *    that writes the rejected data to a log is still collection.
 *  - Date of birth is not stored. We record only the timestamp of the decision
 *    and the boolean outcome, so we can show that a gate was applied without
 *    holding a birth date we have no other need for.
 *  - BOTH are required: a valid date of birth that makes the person at least
 *    MINIMUM_AGE_YEARS old, and the explicit affirmation. A bare checkbox is
 *    not accepted on its own — it would let anyone bypass an 18+ rule by
 *    ticking it — and a ticked box never overrides a date that says otherwise.
 *  - The refusal path is silent about why, so it cannot be used to probe the
 *    boundary, and it never echoes the submitted values back.
 */

import { z } from "zod";

/** Single source of truth for the minimum age. Do not hard-code it elsewhere. */
export const MINIMUM_AGE_YEARS = 18;

/** Injectable for tests; production passes nothing and gets `new Date()`. */
export type Clock = () => Date;

export type AgeGateInput = {
  dateOfBirth?: unknown;
  ageAffirmation?: unknown;
};

export type AgeGateDecision =
  | { eligible: true; method: "date_of_birth" }
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

/** True only for a real calendar date: `2015-02-31` must not roll into March. */
function parseIsoDate(raw: string): Date | null {
  if (!ISO_DATE.test(raw)) return null;
  const dob = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(dob.getTime())) return null;
  return dob.toISOString().slice(0, 10) === raw ? dob : null;
}

/** Whether a date of birth makes the person at least `minimumAge` on `now`. */
export function isAtLeastAge(dob: Date, minimumAge: number, now: Date): boolean {
  return yearsBetween(dob, now) >= minimumAge;
}

function isAffirmed(value: unknown): boolean {
  return value === true || value === "true" || value === "on";
}

/**
 * Pure decision function. No I/O, no storage, no logging.
 */
export function evaluateAgeGate(
  input: AgeGateInput,
  clock: Clock = () => new Date(),
): AgeGateDecision {
  const rawDob = typeof input.dateOfBirth === "string" ? input.dateOfBirth.trim() : "";

  if (rawDob.length === 0) return { eligible: false, reason: "missing" };

  const dob = parseIsoDate(rawDob);
  if (!dob) return { eligible: false, reason: "invalid" };

  const now = clock();

  // A date in the future, or before live people were born, means the field was
  // filled in carelessly or dishonestly. Either way we cannot rely on it.
  if (dob.getTime() > now.getTime()) return { eligible: false, reason: "implausible" };
  if (dob.getUTCFullYear() < 1900) return { eligible: false, reason: "implausible" };

  if (!isAtLeastAge(dob, MINIMUM_AGE_YEARS, now)) return { eligible: false, reason: "underage" };

  // Old enough by date; the explicit affirmation is still required.
  if (!isAffirmed(input.ageAffirmation)) return { eligible: false, reason: "missing" };

  return { eligible: true, method: "date_of_birth" };
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
 * Neutral refusal for anyone under the minimum age. It never states the
 * person's age or how close they were to the boundary.
 */
export const AGE_GATE_REFUSAL_MESSAGE =
  "Η υπηρεσία είναι διαθέσιμη μόνο σε άτομα ηλικίας 18 ετών και άνω.";

/** English equivalent, for any English-language surface. */
export const AGE_GATE_REFUSAL_MESSAGE_EN =
  "You must be 18 years old or older to use this service.";

export const AGE_GATE_MISSING_MESSAGE =
  "Συμπληρώστε την ημερομηνία γέννησης και επιβεβαιώστε ότι είστε 18 ετών ή μεγαλύτερος/η.";

export const AGE_GATE_INVALID_MESSAGE = "Εισαγάγετε μια έγκυρη ημερομηνία γέννησης.";

/** The user-facing message for a refusal reason. Never echoes submitted values. */
export function ageGateMessage(reason: string): string {
  switch (reason) {
    case "missing":
      return AGE_GATE_MISSING_MESSAGE;
    case "invalid":
    case "implausible":
      return AGE_GATE_INVALID_MESSAGE;
    default:
      return AGE_GATE_REFUSAL_MESSAGE;
  }
}

export const AGE_GATE_HONEYPOT_REFUSAL_MESSAGE = "Submission rejected.";
