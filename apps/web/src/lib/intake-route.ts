/**
 * One request handler for every public intake endpoint.
 *
 * The honeypot and time trap, body-size cap, rate limit, schema validation,
 * idempotency/attribution metadata and the mapping of outcomes to responses
 * live here once. A route supplies only its schema and which service method to
 * call, so a new endpoint cannot forget a protection, and no response can leak
 * a database error, a stack trace or an internal id: anything unexpected is
 * logged server-side and the visitor sees a generic message.
 */

import { NextResponse } from "next/server";
import type { IntakeOutcome, PublicLeadIntakeService, RequestMeta } from "@home88/intake";
import { IntakeValidationError } from "@home88/intake";
import { AGE_GATE_REFUSAL_MESSAGE, intakeMetaSchema } from "@home88/validation";
import type { ZodType, ZodTypeDef } from "zod";

import {
  badRequest,
  contextFrom,
  fieldErrors,
  looksAutomated,
  readJson,
  serverError,
  silentAccept,
  unavailable,
} from "@/lib/api";
import { intakeService } from "@/lib/intake";
import { rateLimit } from "@/lib/rate-limit";

export type IntakeRoute<TIn> = {
  name: string;
  limit: { points: number; durationSeconds: number };
  schema: ZodType<TIn, ZodTypeDef, unknown>;
  run: (service: PublicLeadIntakeService, input: TIn, meta: RequestMeta, raw: Record<string, unknown>) => Promise<IntakeOutcome>;
  /** Message when the visitor is rate limited. */
  tooMany?: string;
};

export type IntakeDeps = { getService: () => PublicLeadIntakeService | null };

/** `deps` exists so tests can supply a fake service; production uses the real one. */
export async function handleIntake<TIn>(request: Request, route: IntakeRoute<TIn>, deps: IntakeDeps = { getService: intakeService }): Promise<NextResponse> {
  const ctx = contextFrom(request);

  const limit = rateLimit(`${route.name}:${ctx.ip}`, route.limit);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: route.tooMany ?? "Πολλές υποβολές σε σύντομο διάστημα. Δοκιμάστε ξανά αργότερα." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const raw = (body.value ?? {}) as Record<string, unknown>;

  if (looksAutomated(raw)) {
    console.warn(`[home88:${route.name}] automated submission dropped`);
    return silentAccept();
  }

  const parsed = route.schema.safeParse(raw);
  if (!parsed.success) return badRequest("Ελέγξτε τα στοιχεία της φόρμας.", fieldErrors(parsed.error.issues));
  const metaParsed = intakeMetaSchema.safeParse(raw);
  if (!metaParsed.success) return badRequest("Μη έγκυρο αίτημα.");

  const service = deps.getService();
  if (!service) return unavailable();

  const meta: RequestMeta = {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    idempotencyKey: metaParsed.data.idempotencyKey ?? null,
    attribution: metaParsed.data.attribution ?? null,
  };

  try {
    const outcome = await route.run(service, parsed.data, meta, raw);
    switch (outcome.status) {
      case "refused":
        // The reason was only for the server; the visitor gets the standard message.
        return badRequest(AGE_GATE_REFUSAL_MESSAGE, { dateOfBirth: [AGE_GATE_REFUSAL_MESSAGE] });
      case "replayed":
      case "created":
        return NextResponse.json(
          { ok: true, reference: outcome.reference, ...(outcome.uploads ? { uploads: { received: outcome.uploads.accepted + outcome.uploads.quarantined } } : {}) },
          { status: outcome.status === "created" ? 201 : 200 },
        );
    }
  } catch (error) {
    if (error instanceof IntakeValidationError) return badRequest("Ελέγξτε τα στοιχεία της φόρμας.", error.fields);
    // Log what failed, never the payload: it holds personal data.
    console.error(`[home88:${route.name}] intake failed:`, error instanceof Error ? error.constructor.name : "unknown");
    return serverError();
  }
}

/** Shapes shared by the routes: the age-gate input and the consent flags. */
export function ageOf(input: { dateOfBirth?: unknown; ageAffirmation?: unknown }) {
  return { dateOfBirth: input.dateOfBirth, ageAffirmation: input.ageAffirmation };
}

export function consentOf(input: { consent?: { analytics?: boolean; marketing?: boolean } | undefined }) {
  return input.consent ? { analytics: input.consent.analytics === true, marketing: input.consent.marketing === true } : undefined;
}
