import { RATE_LIMITS, viewingRequestSchema } from "@home88/validation";

import { ageOf, consentOf, handleIntake } from "@/lib/intake-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Request a viewing. It stays a request until an agent confirms it. */
export async function POST(request: Request) {
  return handleIntake(request, {
    name: "viewings",
    limit: RATE_LIMITS.viewingRequest,
    schema: viewingRequestSchema,
    run: (service, input, meta) =>
      service.createViewingRequest({
        person: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, locale: input.locale },
        age: ageOf(input),
        consent: consentOf(input),
        meta,
        propertyReference: input.propertyReference,
        preferredStart: input.preferredStart ?? null,
        message: input.message,
      }),
  });
}
