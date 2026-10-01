import { NextResponse } from "next/server";

import { recordCapture } from "@/lib/capture";
import { rateLimit } from "@/lib/rate-limit";
import { AGE_GATE_REFUSAL_MESSAGE, contactSchema, RATE_LIMITS } from "@home88/validation";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = contextFrom(request);

  const limit = rateLimit(`contact:${ctx.ip}`, RATE_LIMITS.contact);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: "Πολλά μηνύματα σε σύντομο διάστημα. Δοκιμάστε ξανά σε λίγο." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const raw = body.value;

  if (looksAutomated(raw)) {
    console.warn(`[home88:contact] automated submission dropped ip=${ctx.ip}`);
    return silentAccept();
  }

  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest("Ελέγξτε τα στοιχεία της φόρμας.", fieldErrors(parsed.error.issues));
  }
  const input = parsed.data;

  const outcome = await recordCapture(
    {
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      // The subject is folded into the message body: there is no subject
      // column on Lead, and inventing one would mean a migration for a label.
      message: input.subject ? `Θέμα: ${input.subject}\n\n${input.message}` : input.message,
      source: "WEBSITE",
      sourceUrl: "/contact",
    },
    {
      kind: "LEAD",
      age: { dateOfBirth: input.dateOfBirth, ageAffirmation: input.ageAffirmation },
      consent: input.consent,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      consentSource: "website:contact-form",
    },
  );

  switch (outcome.status) {
    case "refused":
      return badRequest(AGE_GATE_REFUSAL_MESSAGE, { dateOfBirth: [AGE_GATE_REFUSAL_MESSAGE] });
    case "unavailable":
      return unavailable();
    case "failed":
      return serverError();
    case "created":
      return NextResponse.json({ ok: true, reference: outcome.reference }, { status: 201 });
  }
}
