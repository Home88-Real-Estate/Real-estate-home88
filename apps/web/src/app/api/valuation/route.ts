import { contactSchema, RATE_LIMITS } from "@home88/validation";

import { ageOf, consentOf, handleIntake } from "@/lib/intake-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A request for a professional valuation: contact + seller-valuation lead + valuation record. */
export async function POST(request: Request) {
  return handleIntake(request, {
    name: "valuation",
    limit: RATE_LIMITS.leadCapture,
    schema: contactSchema,
    run: (service, input, meta, raw) => {
      const p = (raw.property ?? {}) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      return service.createValuationRequest({
        person: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, locale: input.locale },
        age: ageOf(input),
        consent: consentOf(input),
        meta,
        property: {
          titleEl: typeof p.titleEl === "string" && p.titleEl.trim() ? p.titleEl : "Αίτημα εκτίμησης",
          descriptionEl: input.message,
          listingType: p.listingType === "RENT" ? "RENT" : "SALE",
          propertyType: typeof p.propertyType === "string" ? p.propertyType : "OTHER",
          price: num(p.price),
          area: num(p.area),
          bedrooms: num(p.bedrooms),
          city: typeof p.city === "string" ? p.city : null,
          neighborhood: typeof p.neighborhood === "string" ? p.neighborhood : null,
        },
      });
    },
  });
}
