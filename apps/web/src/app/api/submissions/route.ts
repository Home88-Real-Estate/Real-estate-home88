import { NextResponse } from "next/server";

import { recordCapture } from "@/lib/capture";
import { rateLimit } from "@/lib/rate-limit";
import { AGE_GATE_REFUSAL_MESSAGE, propertySubmissionSchema, RATE_LIMITS } from "@home88/validation";
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

  const limit = rateLimit(`submissions:${ctx.ip}`, RATE_LIMITS.propertySubmission);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: "Πολλές υποβολές σε σύντομο διάστημα. Δοκιμάστε ξανά αργότερα." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const raw = body.value;

  if (looksAutomated(raw)) {
    console.warn(`[home88:submissions] automated submission dropped ip=${ctx.ip}`);
    return silentAccept();
  }

  const parsed = propertySubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest("Ελέγξτε τα στοιχεία της φόρμας.", fieldErrors(parsed.error.issues));
  }
  const input = parsed.data;

  // The owner/vendor's details are the contact for this enquiry.
  const summary = [
    `Ανάθεση ακινήτου: ${input.titleEl}`,
    `Τύπος: ${input.listingType} / ${input.propertyType}`,
    input.city ? `Περιοχή: ${input.city}${input.neighborhood ? `, ${input.neighborhood}` : ""}` : null,
    input.price != null ? `Επιθυμητή τιμή: ${input.price} €` : null,
    input.area != null ? `Εμβαδόν: ${input.area} τ.μ.` : null,
    input.bedrooms != null ? `Υπνοδωμάτια: ${input.bedrooms}` : null,
    "",
    input.descriptionEl,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const outcome = await recordCapture(
    {
      firstName: input.contactFirstName,
      lastName: input.contactLastName ?? null,
      email: input.contactEmail ?? null,
      phone: input.contactPhone ?? null,
      message: summary,
      source: "WEBSITE",
      sourceUrl: "/submit",
      // Vendor submissions are not buyer leads; the CRM distinguishes them by
      // source so they enter the vendor pipeline.
      extraLeadData: { status: "NEW" },
    },
    {
      kind: "LEAD",
      age: { dateOfBirth: input.dateOfBirth, ageAffirmation: input.ageAffirmation },
      consent: input.consent,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      consentSource: "website:submit-property",
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
