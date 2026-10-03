/**
 * Portal-publishing domain types.
 *
 * This package is deliberately free of Prisma, HTTP and database imports. The
 * API maps a `Property` row to a `PortalProperty` once and hands it here, so the
 * payload builders and the sync planner can be reasoned about and tested without
 * a database. The string unions mirror the Prisma enums; a Prisma enum value is
 * assignable to them without a cast.
 */

import type { PropertyStatus } from "@home88/domain";

export type PortalTransport = "API" | "XML_FEED" | "CSV_FEED" | "JSON_FEED" | "MANUAL";

export type PortalSyncState =
  | "NOT_PUBLISHED"
  | "QUEUED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "REMOVED"
  | "OUTDATED";

export type SyncAction = "PUBLISH" | "UPDATE" | "REMOVE" | "REPUBLISH" | "IMPORT_LEADS";

export type ListingType = "SALE" | "RENT" | "ASSIGNMENT";

/** Owned by the property lifecycle in @home88/domain. */
export type { PropertyStatus };

export type MediaKind = "PHOTO" | "FLOOR_PLAN" | "VIDEO" | "VIRTUAL_TOUR" | "DOCUMENT";

/** A media item with its public URL already resolved by the caller. */
export type PortalMedia = {
  kind: MediaKind;
  url: string;
  alt: string | null;
  sortOrder: number;
  isPrimary: boolean;
};

/**
 * The canonical shape every adapter consumes. It carries only fields a portal
 * could care about; internal ids, agent commissions and audit columns are not
 * part of it, so they can never leak into a feed by accident.
 */
export type PortalProperty = {
  reference: string;
  slug: string;

  listingType: ListingType;
  propertyType: string;
  status: PropertyStatus;
  condition: string;

  titleEl: string;
  titleEn: string | null;
  descriptionEl: string;
  descriptionEn: string | null;

  price: number | null;
  priceOnRequest: boolean;
  monthlyRent: number | null;

  area: number | null;
  plotArea: number | null;
  builtArea: number | null;

  bedrooms: number | null;
  bathrooms: number | null;
  wc: number | null;
  floor: number | null;
  totalFloors: number | null;

  yearBuilt: number | null;
  yearRenovated: number | null;

  heating: string;
  energyClass: string;
  hasSolar: boolean;

  parking: boolean;
  parkingSpaces: number | null;
  storage: boolean;
  balcony: boolean;
  balconyArea: number | null;
  garden: boolean;
  pool: boolean;
  furnished: boolean;
  petsAllowed: boolean;
  seaView: boolean;
  newConstruction: boolean;

  region: string | null;
  city: string | null;
  areaName: string | null;
  neighborhood: string | null;
  address: string | null;
  postalCode: string | null;

  latitude: number | null;
  longitude: number | null;

  videoUrl: string | null;
  virtualTourUrl: string | null;

  media: PortalMedia[];

  /** ISO-8601 timestamp. Excluded from the content hash; see hash.ts. */
  updatedAt: string;
};

/** The subset of a `Portal` row an adapter needs. */
export type PortalConfig = {
  code: string;
  name: string;
  transport: PortalTransport;
  baseUrl?: string | null;
  feedUrl?: string | null;
  defaultAgentExternalId?: string | null;
  settings?: Record<string, unknown> | null;
};

/** Agency identity used on portal feeds; portals reject listings without it. */
export type AgencyConfig = {
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  license?: string | null;
};

export type BuildContext = {
  portal: PortalConfig;
  agency: AgencyConfig;
  /**
   * Public base for object storage. Blank means media is served from `/media`.
   * Resolved per media item with `resolveMediaUrl` before it reaches an adapter.
   */
  mediaBaseUrl?: string | null;
};

/** One property rendered by an adapter, ready to be pushed or written to a feed. */
export type AdapterPayload = {
  propertyReference: string;
  /** The id we expect the portal to key the listing on (our reference). */
  externalId: string;
  body: string;
  contentType: string;
  filename: string;
  /** Content hash of the source property, used to detect real changes. */
  hash: string;
};

/** A whole feed document assembled from many per-property payloads. */
export type FeedDocument = {
  body: string;
  contentType: string;
  filename: string;
  propertyCount: number;
  /** Order-independent hash of the included property hashes. */
  hash: string;
};

export interface PortalAdapter {
  readonly code: string;
  readonly transport: PortalTransport;
  readonly label: string;
  /** Whether this portal will accept the listing at all. */
  supports(property: PortalProperty): boolean;
  /** Render one property. */
  build(property: PortalProperty, context: BuildContext): AdapterPayload;
  /** Optional: batch many rendered properties into a single feed document. */
  compose?(payloads: AdapterPayload[]): FeedDocument;
}
