import { combineHashes, propertyContentHash } from "../hash";
import { mediaOfKind } from "../media";
import type {
  AdapterPayload,
  BuildContext,
  FeedDocument,
  PortalAdapter,
  PortalProperty,
} from "../types";

/**
 * For portals with no machine interface. The "payload" is a posting sheet an
 * agent copies from, so the work of publishing is still tracked and still shows
 * up in the sync log rather than being an untracked manual step.
 */
function checklist(property: PortalProperty, context: BuildContext): string[] {
  const photos = mediaOfKind(property.media, "PHOTO");
  const priceLine = property.priceOnRequest
    ? "Price: on request"
    : `Price: ${property.price === null ? "-" : property.price} EUR`;

  return [
    `${property.titleEl} (${property.reference})`,
    `${property.listingType} · ${property.propertyType} · ${property.status} · ${property.condition}`,
    priceLine,
    `Area: ${property.area ?? "-"} sqm · Bedrooms: ${property.bedrooms ?? "-"} · Bathrooms: ${property.bathrooms ?? "-"}`,
    `Location: ${[property.address, property.neighborhood, property.areaName, property.city, property.region].filter(Boolean).join(", ") || "-"}`,
    `Photos (${photos.length}):`,
    ...photos.map((photo, index) => `  ${index + 1}. ${photo.url}`),
    context.portal.defaultAgentExternalId
      ? `Portal agent id: ${context.portal.defaultAgentExternalId}`
      : "",
    context.portal.baseUrl ? `Post at: ${context.portal.baseUrl}` : "",
    `Last updated: ${property.updatedAt}`,
  ].filter((line) => line.length > 0);
}

function build(property: PortalProperty, context: BuildContext): AdapterPayload {
  const body = checklist(property, context).join("\n");

  return {
    propertyReference: property.reference,
    externalId: property.reference,
    body,
    contentType: "text/plain; charset=utf-8",
    filename: `${property.reference}.txt`,
    hash: propertyContentHash(property),
  };
}

function compose(payloads: AdapterPayload[]): FeedDocument {
  const body = payloads.map((payload) => payload.body).join("\n\n---\n\n");

  return {
    body,
    contentType: "text/plain; charset=utf-8",
    filename: "manual-posting-sheet.txt",
    propertyCount: payloads.length,
    hash: combineHashes(payloads.map((payload) => payload.hash)),
  };
}

export const manualAdapter: PortalAdapter = {
  code: "MANUAL",
  transport: "MANUAL",
  label: "Manual posting",
  supports: () => true,
  build,
  compose,
};
