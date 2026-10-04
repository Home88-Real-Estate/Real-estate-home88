import { REQUEST_FEATURES } from "@home88/domain";
import { buyerRequestSchema, RATE_LIMITS } from "@home88/validation";

import { ageOf, consentOf, handleIntake } from "@/lib/intake-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Ζητώ ακίνητο": contact + buyer lead + a persistent buyer request. */
export async function POST(request: Request) {
  return handleIntake(request, {
    name: "requests",
    limit: RATE_LIMITS.buyerRequest,
    schema: buyerRequestSchema,
    run: (service, input, meta, raw) => {
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const types = list(raw.propertyTypes) ?? (input.propertyType ? [input.propertyType] : []);
      return service.createBuyerRequest({
        person: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, locale: input.locale },
        age: ageOf(input),
        consent: consentOf(input),
        meta,
        request: {
          listingType: input.listingType === "RENT" ? "RENT" : "SALE",
          propertyTypes: types,
          areas: list(raw.areas) ?? (input.city ? [input.city] : []),
          minPrice: input.budgetMin ?? null,
          maxPrice: input.budgetMax ?? null,
          minArea: input.minArea ?? null,
          maxArea: num(raw.maxArea),
          minBedrooms: input.minBedrooms ?? null,
          minBathrooms: num(raw.minBathrooms),
          minFloor: num(raw.minFloor),
          minYearBuilt: num(raw.minYearBuilt),
          features: list(raw.features) ?? REQUEST_FEATURES.filter((key) => raw[key] === true),
          notes: input.message,
        },
      });
    },
  });
}
