import { combineHashes, propertyContentHash } from "../hash";
import { mediaOfKind } from "../media";
import type {
  AdapterPayload,
  BuildContext,
  FeedDocument,
  PortalAdapter,
  PortalProperty,
} from "../types";
import { block, compact, element, escapeXml, indentLines } from "../xml";

const TRANSACTION_LABELS: Record<string, string> = {
  SALE: "sale",
  RENT: "rent",
  ASSIGNMENT: "assignment",
};

function transactionLabel(property: PortalProperty): string {
  return TRANSACTION_LABELS[property.listingType] ?? property.listingType.toLowerCase();
}

function renderLocation(property: PortalProperty): string {
  return block("location", [
    element("region", property.region ?? ""),
    element("city", property.city ?? ""),
    element("area", property.areaName ?? ""),
    element("neighborhood", property.neighborhood ?? ""),
    element("address", property.address ?? ""),
    element("postal_code", property.postalCode ?? ""),
    element("latitude", property.latitude),
    element("longitude", property.longitude),
  ]);
}

function renderFeatures(property: PortalProperty): string {
  return block("features", [
    element("parking", property.parking),
    element("parking_spaces", property.parkingSpaces),
    element("storage", property.storage),
    element("balcony", property.balcony),
    element("balcony_area", property.balconyArea),
    element("garden", property.garden),
    element("pool", property.pool),
    element("furnished", property.furnished),
    element("pets_allowed", property.petsAllowed),
    element("sea_view", property.seaView),
    element("new_construction", property.newConstruction),
    element("solar", property.hasSolar),
  ]);
}

function renderImages(property: PortalProperty): string {
  const items = mediaOfKind(property.media, "PHOTO").map((photo, index) =>
    block("image", [element("url", photo.url), element("alt", photo.alt ?? "")], {
      primary: photo.isPrimary,
      order: index + 1,
    }),
  );
  return block("images", items);
}

function renderFloorPlans(property: PortalProperty): string {
  const items = mediaOfKind(property.media, "FLOOR_PLAN").map((plan, index) =>
    block("plan", [element("url", plan.url), element("alt", plan.alt ?? "")], {
      order: index + 1,
    }),
  );
  return block("floorplans", items);
}

function renderAgent(context: BuildContext): string {
  const id = context.portal.defaultAgentExternalId;
  return id ? `<agent external_id="${escapeXml(id)}" />` : "";
}

function renderAgency(context: BuildContext): string {
  return block("agency", [
    element("name", context.agency.name),
    element("phone", context.agency.phone ?? ""),
    element("email", context.agency.email ?? ""),
    element("website", context.agency.website ?? ""),
    element("license", context.agency.license ?? ""),
  ]);
}

function build(property: PortalProperty, context: BuildContext): AdapterPayload {
  const lines = compact([
    element("reference", property.reference),
    element("slug", property.slug),
    element("transaction", transactionLabel(property)),
    element("type", property.propertyType.toLowerCase()),
    element("status", property.status.toLowerCase()),
    element("condition", property.condition.toLowerCase()),
    element("title", property.titleEl, { language: "el" }),
    element("title", property.titleEn ?? "", { language: "en" }),
    element("description", property.descriptionEl, { language: "el" }),
    element("description", property.descriptionEn ?? "", { language: "en" }),
    property.priceOnRequest ? null : element("price", property.price, { currency: "EUR" }),
    element("price_on_request", property.priceOnRequest),
    element("monthly_rent", property.monthlyRent, { currency: "EUR" }),
    element("area", property.area, { unit: "sqm" }),
    element("plot_area", property.plotArea, { unit: "sqm" }),
    element("built_area", property.builtArea, { unit: "sqm" }),
    element("bedrooms", property.bedrooms),
    element("bathrooms", property.bathrooms),
    element("wc", property.wc),
    element("floor", property.floor),
    element("total_floors", property.totalFloors),
    element("year_built", property.yearBuilt),
    element("year_renovated", property.yearRenovated),
    element("heating", property.heating.toLowerCase()),
    element("energy_class", property.energyClass),
    renderLocation(property),
    renderFeatures(property),
    renderImages(property),
    renderFloorPlans(property),
    element("video", property.videoUrl ?? ""),
    element("virtual_tour", property.virtualTourUrl ?? ""),
    renderAgent(context),
    renderAgency(context),
    element("last_updated", property.updatedAt),
  ]);

  const body = ["<property>", ...indentLines(lines), "</property>"].join("\n");

  return {
    propertyReference: property.reference,
    externalId: property.reference,
    body,
    contentType: "application/xml; charset=utf-8",
    filename: `${property.reference}.xml`,
    hash: propertyContentHash(property),
  };
}

function compose(payloads: AdapterPayload[]): FeedDocument {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<properties>",
    ...payloads.flatMap((payload) => indentLines(payload.body.split("\n"))),
    "</properties>",
  ].join("\n");

  return {
    body,
    contentType: "application/xml; charset=utf-8",
    filename: "spitogatos-feed.xml",
    propertyCount: payloads.length,
    hash: combineHashes(payloads.map((payload) => payload.hash)),
  };
}

export const spitogatosAdapter: PortalAdapter = {
  code: "SPITOGATOS",
  transport: "XML_FEED",
  label: "Spitogatos",
  supports: () => true,
  build,
  compose,
};
