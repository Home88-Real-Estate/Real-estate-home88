/**
 * Maps a database property onto the portal engine's canonical view.
 *
 * Kept separate from the sync service (and free of database and config imports)
 * so the projection rules — which media count as public, how a Decimal becomes a
 * number — can be unit-tested directly.
 */

import type { Prisma } from "@home88/database";
import {
  resolveMediaUrl,
  type MediaKind,
  type PortalMedia,
  type PortalProperty,
} from "@home88/portals";

/**
 * Only media a human has cleared for public use may leave the building. The
 * schema default is `pending_review`, so a newly uploaded photo is withheld
 * from feeds and the website until it is approved.
 */
export const EXPORTABLE_MEDIA_STATUSES = ["approved", "published"] as const;

export type PropertyForPortal = Prisma.PropertyGetPayload<{ include: { media: true } }>;

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Absolute base for public media. Portals cannot resolve a root-relative URL. */
export function mediaBase(cfg: { MEDIA_BASE_URL: string; SITE_URL: string }): string {
  return cfg.MEDIA_BASE_URL || `${cfg.SITE_URL}/media`;
}

/**
 * `urlFor` lets a caller replace the media link (portal delivery uses scoped,
 * expiring links instead of the storage-key URL). The content hash must always
 * be taken from the default projection, so it does not change with every token.
 */
export function toPortalProperty(
  property: PropertyForPortal,
  base: string,
  urlFor?: (item: PropertyForPortal["media"][number]) => string,
): PortalProperty {
  const media: PortalMedia[] = property.media
    .filter((item) => (EXPORTABLE_MEDIA_STATUSES as readonly string[]).includes(item.status))
    .map((item) => ({
      kind: item.kind as MediaKind,
      url: urlFor ? urlFor(item) : resolveMediaUrl(item.storageKey, base),
      alt: item.altEl,
      sortOrder: item.sortOrder,
      isPrimary: item.isPrimary,
    }));

  return {
    reference: property.reference,
    slug: property.slug,
    listingType: property.listingType,
    propertyType: property.propertyType,
    status: property.status,
    condition: property.condition,
    titleEl: property.titleEl,
    titleEn: property.titleEn,
    descriptionEl: property.descriptionEl,
    descriptionEn: property.descriptionEn,
    price: num(property.price),
    priceOnRequest: property.priceOnRequest,
    monthlyRent: num(property.monthlyRent),
    area: num(property.area),
    plotArea: num(property.plotArea),
    builtArea: num(property.builtArea),
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    wc: property.wc,
    floor: property.floor,
    totalFloors: property.totalFloors,
    yearBuilt: property.yearBuilt,
    yearRenovated: property.yearRenovated,
    heating: property.heating,
    energyClass: property.energyClass,
    hasSolar: property.hasSolar,
    parking: property.parking,
    parkingSpaces: property.parkingSpaces,
    storage: property.storage,
    balcony: property.balcony,
    balconyArea: num(property.balconyArea),
    garden: property.garden,
    pool: property.pool,
    furnished: property.furnished,
    petsAllowed: property.petsAllowed,
    seaView: property.seaView,
    newConstruction: property.newConstruction,
    region: property.region,
    city: property.city,
    areaName: property.areaName,
    neighborhood: property.neighborhood,
    address: property.address,
    postalCode: property.postalCode,
    latitude: num(property.latitude),
    longitude: num(property.longitude),
    videoUrl: property.videoUrl,
    virtualTourUrl: property.virtualTourUrl,
    media,
    updatedAt: property.updatedAt.toISOString(),
  };
}
