import { contactSchema, RATE_LIMITS } from "@home88/validation";

import { ageOf, consentOf, handleIntake } from "@/lib/intake-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The contact form: a message is an enquiry, not marketing consent. */
export async function POST(request: Request) {
  return handleIntake(request, {
    name: "contact",
    limit: RATE_LIMITS.contact,
    tooMany: "Πολλά μηνύματα σε σύντομο διάστημα. Δοκιμάστε ξανά σε λίγο.",
    schema: contactSchema,
    run: (service, input, meta) =>
      service.createContactInquiry({
        person: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, locale: input.locale },
        age: ageOf(input),
        consent: consentOf(input),
        meta,
        subject: input.subject,
        message: input.message,
      }),
  });
}
