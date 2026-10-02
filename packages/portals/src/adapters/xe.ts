import { combineHashes, propertyContentHash } from "../hash";
import { feedStatus } from "../eligibility";
import { mediaOfKind } from "../media";
import type {
  AdapterPayload,
  BuildContext,
  FeedDocument,
  PortalAdapter,
  PortalProperty,
} from "../types";
import { toBoolFlag, toCsvRow } from "../csv";

export const XE_GR_COLUMNS = [
  "reference",
  "transaction",
  "category",
  "status",
  "condition",
  "title_el",
  "title_en",
  "description_el",
  "description_en",
  "price",
  "price_on_request",
  "monthly_rent",
  "area",
  "plot_area",
  "built_area",
  "bedrooms",
  "bathrooms",
  "wc",
  "floor",
  "total_floors",
  "year_built",
  "year_renovated",
  "heating",
  "energy_class",
  "has_solar",
  "parking",
  "parking_spaces",
  "storage",
  "balcony",
  "balcony_area",
  "garden",
  "pool",
  "furnished",
  "pets_allowed",
  "sea_view",
  "new_construction",
  "region",
  "city",
  "area_name",
  "neighborhood",
  "address",
  "postal_code",
  "latitude",
  "longitude",
  "images",
  "floorplans",
  "video_url",
  "virtual_tour_url",
  "agent_external_id",
  "updated_at",
] as const;

export type XeGrColumn = (typeof XE_GR_COLUMNS)[number];

function num(value: number | null): string {
  return value === null ? "" : String(value);
}

function rowRecord(property: PortalProperty, context: BuildContext): Record<XeGrColumn, string> {
  const images = mediaOfKind(property.media, "PHOTO").map((item) => item.url).join("|");
  const floorplans = mediaOfKind(property.media, "FLOOR_PLAN").map((item) => item.url).join("|");

  return {
    reference: property.reference,
    transaction: property.listingType.toLowerCase(),
    category: property.propertyType.toLowerCase(),
    status: feedStatus(property.status),
    condition: property.condition.toLowerCase(),
    title_el: property.titleEl,
    title_en: property.titleEn ?? "",
    description_el: property.descriptionEl,
    description_en: property.descriptionEn ?? "",
    price: property.priceOnRequest ? "" : num(property.price),
    price_on_request: toBoolFlag(property.priceOnRequest),
    monthly_rent: num(property.monthlyRent),
    area: num(property.area),
    plot_area: num(property.plotArea),
    built_area: num(property.builtArea),
    bedrooms: num(property.bedrooms),
    bathrooms: num(property.bathrooms),
    wc: num(property.wc),
    floor: num(property.floor),
    total_floors: num(property.totalFloors),
    year_built: num(property.yearBuilt),
    year_renovated: num(property.yearRenovated),
    heating: property.heating.toLowerCase(),
    energy_class: property.energyClass,
    has_solar: toBoolFlag(property.hasSolar),
    parking: toBoolFlag(property.parking),
    parking_spaces: num(property.parkingSpaces),
    storage: toBoolFlag(property.storage),
    balcony: toBoolFlag(property.balcony),
    balcony_area: num(property.balconyArea),
    garden: toBoolFlag(property.garden),
    pool: toBoolFlag(property.pool),
    furnished: toBoolFlag(property.furnished),
    pets_allowed: toBoolFlag(property.petsAllowed),
    sea_view: toBoolFlag(property.seaView),
    new_construction: toBoolFlag(property.newConstruction),
    region: property.region ?? "",
    city: property.city ?? "",
    area_name: property.areaName ?? "",
    neighborhood: property.neighborhood ?? "",
    address: property.address ?? "",
    postal_code: property.postalCode ?? "",
    latitude: num(property.latitude),
    longitude: num(property.longitude),
    images,
    floorplans,
    video_url: property.videoUrl ?? "",
    virtual_tour_url: property.virtualTourUrl ?? "",
    agent_external_id: context.portal.defaultAgentExternalId ?? "",
    updated_at: property.updatedAt,
  };
}

function build(property: PortalProperty, context: BuildContext): AdapterPayload {
  const record = rowRecord(property, context);
  const body = toCsvRow(XE_GR_COLUMNS.map((column) => record[column]));

  return {
    propertyReference: property.reference,
    externalId: property.reference,
    body,
    contentType: "text/csv; charset=utf-8",
    filename: `${property.reference}.csv`,
    hash: propertyContentHash(property),
  };
}

function compose(payloads: AdapterPayload[]): FeedDocument {
  const body =
    [toCsvRow([...XE_GR_COLUMNS]), ...payloads.map((payload) => payload.body)].join("\r\n") +
    "\r\n";

  return {
    body,
    contentType: "text/csv; charset=utf-8",
    filename: "xe-gr-feed.csv",
    propertyCount: payloads.length,
    hash: combineHashes(payloads.map((payload) => payload.hash)),
  };
}

export const xeGrAdapter: PortalAdapter = {
  code: "XE_GR",
  transport: "CSV_FEED",
  label: "XE.gr",
  supports: () => true,
  build,
  compose,
};
