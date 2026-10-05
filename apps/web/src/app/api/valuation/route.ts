import { contactSchema, RATE_LIMITS } from "@home88/validation";

import { prisma } from "@/lib/db";
import { ageOf, consentOf, handleIntake } from "@/lib/intake-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A website valuation may be claimed by a follow-up request only within this window. */
const LINK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A request for a professional valuation: contact + seller-valuation lead + valuation record.
 * When it follows an indicative valuation (`valuationRequestId`), the property details are taken
 * from that stored request (not from the browser) and the request is linked to the new lead.
 */
export async function POST(request: Request) {
  return handleIntake(request, {
    name: "valuation",
    limit: RATE_LIMITS.leadCapture,
    schema: contactSchema,
    run: async (service, input, meta, raw) => {
      const p = (raw.property ?? {}) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const requestId = typeof raw.valuationRequestId === "string" ? raw.valuationRequestId.slice(0, 40) : null;
      const linked =
        requestId && prisma
          ? await prisma.valuationRequest.findFirst({
              where: { id: requestId, leadId: null, createdAt: { gte: new Date(Date.now() - LINK_WINDOW_MS) } },
              select: { id: true, reference: true, propertyType: true, areaSqm: true, bedrooms: true, city: true, areaName: true, estimatedMin: true, estimatedMax: true },
            })
          : null;

      const outcome = await service.createValuationRequest({
        person: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, locale: input.locale },
        age: ageOf(input),
        consent: consentOf(input),
        meta,
        property: linked
          ? {
              titleEl: `Αίτημα εκτίμησης (${linked.reference})`,
              descriptionEl: [
                input.message,
                linked.estimatedMin != null
                  ? `Αυτόματη ενδεικτική εκτίμηση ${linked.reference}: €${Number(linked.estimatedMin).toLocaleString("el-GR")} – €${Number(linked.estimatedMax).toLocaleString("el-GR")}.`
                  : `Αυτόματη εκτίμηση ${linked.reference}: ανεπαρκή συγκρίσιμα στοιχεία.`,
              ].filter(Boolean).join("\n\n"),
              listingType: "SALE",
              propertyType: linked.propertyType,
              price: null,
              area: Number(linked.areaSqm),
              bedrooms: linked.bedrooms,
              city: linked.city,
              neighborhood: linked.areaName,
            }
          : {
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

      if (linked && prisma && (outcome.status === "created" || outcome.status === "replayed")) {
        // The outcome carries the submission reference; the lead hangs off it.
        const submission = await prisma.propertySubmission.findUnique({ where: { reference: outcome.reference }, select: { leadId: true, contactId: true } });
        if (submission?.leadId) {
          await prisma.valuationRequest.updateMany({
            where: { id: linked.id, leadId: null },
            data: { leadId: submission.leadId, contactId: submission.contactId },
          });
        }
      }
      return outcome;
    },
  });
}
