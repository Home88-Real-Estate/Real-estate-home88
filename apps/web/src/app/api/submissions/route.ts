import { intakeMetaSchema, propertySubmissionSchema, RATE_LIMITS } from "@home88/validation";

import { ageOf, consentOf, handleIntake } from "@/lib/intake-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner/vendor submission. Creates a contact, an owner lead and a *draft*
 * submission for staff to review; photos and documents arrive private. It never
 * creates a property.
 */
export async function POST(request: Request) {
  return handleIntake(request, {
    name: "submissions",
    limit: RATE_LIMITS.propertySubmission,
    tooMany: "Πολλές υποβολές σε σύντομο διάστημα. Δοκιμάστε ξανά αργότερα.",
    schema: propertySubmissionSchema,
    run: async (service, input, meta, raw) => {
      const uploads = intakeMetaSchema.parse(raw).uploads;
      return service.createAssignmentSubmission({
        person: { firstName: input.contactFirstName, lastName: input.contactLastName, email: input.contactEmail, phone: input.contactPhone },
        age: ageOf(input),
        consent: consentOf(input),
        meta,
        property: {
          titleEl: input.titleEl,
          descriptionEl: input.descriptionEl,
          listingType: input.listingType as "SALE" | "RENT" | "ASSIGNMENT",
          propertyType: input.propertyType,
          price: input.price ?? null,
          area: input.area ?? null,
          bedrooms: input.bedrooms ?? null,
          city: input.city ?? null,
          neighborhood: input.neighborhood ?? null,
        },
        uploads,
      });
    },
  });
}
