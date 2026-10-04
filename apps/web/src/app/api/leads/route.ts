import { leadCaptureSchema, RATE_LIMITS } from "@home88/validation";

import { ageOf, consentOf, handleIntake } from "@/lib/intake-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A property enquiry when a property is named, otherwise a general enquiry.
 * Either way the visitor is matched to an existing contact before one is created.
 */
export async function POST(request: Request) {
  return handleIntake(request, {
    name: "leads",
    limit: RATE_LIMITS.leadCapture,
    tooMany: "Πολλές υποβολές σε σύντομο διάστημα. Δοκιμάστε ξανά σε λίγο.",
    schema: leadCaptureSchema,
    run: (service, input, meta) => {
      const common = {
        person: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, preferredContactMethod: input.preferredContactMethod, locale: input.locale },
        age: ageOf(input),
        consent: consentOf(input),
        meta,
      };
      return input.propertyReference
        ? service.createPropertyInquiry({ ...common, propertyReference: input.propertyReference, message: input.message })
        : service.createContactInquiry({ ...common, message: input.message ?? "Αίτημα επικοινωνίας" });
    },
  });
}
