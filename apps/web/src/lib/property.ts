/**
 * Public property reads and mapping to the public shape.
 *
 * The website must not receive owner contact details, commission rates,
 * internal notes or unpublished media. The mapper is an explicit allow-list:
 * adding a column to the schema does not leak it to the internet.
 */

import { isPublicMedia, publicWebsiteWhere, websiteSitemapEligible } from "@home88/domain";
import type { Prisma, PrismaClient } from "@home88/database";
import type {
  Locale,
  PublicPropertyDetail,
  PublicPropertySummary,
} from "@home88/types";
import { MEDIA_BASE_URL } from "./config";
import { prisma, safeQuery } from "./db";

type MediaRow = {
  storageKey: string;
  /** Browser-made web-sized version; shown instead of the original when present. */
  previewKey: string | null;
  kind: string;
  altEl: string | null;
  altEn: string | null;
  sortOrder: number;
  isPrimary: boolean;
  status: string;
  lifecycle: string;
};

/**
 * Media is stored as an object key, not a URL. Public photos are served from a
 * public-read bucket prefix; everything else is signed on demand. Generating
 * the URL here means a database leak does not hand over a browsable gallery.
 */
export function mediaUrl(storageKey: string): string {
  const base = MEDIA_BASE_URL;
  if (base) return `${base}/${storageKey.replace(/^\/+/, "")}`;
  return `/media/${storageKey.replace(/^\/+/, "")}`;
}

function pickAlt(media: MediaRow, locale: Locale): string {
  return (locale === "el" ? media.altEl : media.altEn) ?? media.altEl ?? "";
}

function toSummary(p: {
  reference: string;
  slug: string;
  listingType: string;
  propertyType: string;
  status: string;
  titleEl: string;
  titleEn: string | null;
  city: string | null;
  areaName: string | null;
  neighborhood: string | null;
  price: unknown;
  priceOnRequest: boolean;
  area: unknown;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: boolean;
  storage: boolean;
  energyClass: string;
  newConstruction: boolean;
  featured: boolean;
  media: MediaRow[];
}, locale: Locale): PublicPropertySummary {
  // The one definition of "approved media" (approved, usable, not a document), shared with the CRM preview.
  const publicMedia = p.media.filter(isPublicMedia);
  const primary = publicMedia.find((m) => m.isPrimary) ?? publicMedia[0];

  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(String(v));
    return Number.isFinite(n) ? n : null;
  };

  return {
    reference: p.reference,
    slug: p.slug,
    listingType: p.listingType,
    propertyType: p.propertyType,
    status: p.status,
    title: (locale === "el" ? p.titleEl : p.titleEn) ?? p.titleEl,
    city: p.city,
    areaName: p.areaName,
    neighborhood: p.neighborhood,
    price: num(p.price),
    priceOnRequest: p.priceOnRequest,
    area: num(p.area),
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    parking: p.parking,
    storage: p.storage,
    energyClass: p.energyClass,
    isNew: p.newConstruction,
    isFeatured: p.featured,
    primaryImage: primary ? mediaUrl(primary.previewKey ?? primary.storageKey) : null,
    imageCount: publicMedia.length,
  };
}

const mediaSelect = {
  storageKey: true,
  previewKey: true,
  kind: true,
  altEl: true,
  altEn: true,
  sortOrder: true,
  isPrimary: true,
  status: true,
  lifecycle: true,
} satisfies Prisma.PropertyMediaSelect;

export const summarySelect = {
  reference: true,
  slug: true,
  listingType: true,
  propertyType: true,
  status: true,
  titleEl: true,
  titleEn: true,
  city: true,
  areaName: true,
  neighborhood: true,
  price: true,
  priceOnRequest: true,
  area: true,
  bedrooms: true,
  bathrooms: true,
  parking: true,
  storage: true,
  energyClass: true,
  newConstruction: true,
  featured: true,
  media: { select: mediaSelect, orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
} satisfies Prisma.PropertySelect;

export const detailSelect = {
  ...summarySelect,
  descriptionEl: true,
  descriptionEn: true,
  condition: true,
  heating: true,
  floor: true,
  totalFloors: true,
  yearBuilt: true,
  yearRenovated: true,
  plotArea: true,
  parking: true,
  storage: true,
  balcony: true,
  garden: true,
  pool: true,
  furnished: true,
  petsAllowed: true,
  seaView: true,
  hasSolar: true,
  latitude: true,
  longitude: true,
  videoUrl: true,
  virtualTourUrl: true,
  agent: { select: { firstName: true, lastName: true } },
  websitePublication: { select: { visibility: true, noIndex: true } },
} satisfies Prisma.PropertySelect;

export async function listFeaturedProperties(locale: Locale, take = 6): Promise<PublicPropertySummary[]> {
  return safeQuery(
    "listFeaturedProperties",
    async (db: PrismaClient) => {
      const rows = await db.property.findMany({
        where: { ...publicWebsiteWhere({ listed: true }), featured: true },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take,
        select: summarySelect,
      });
      return rows.map((r) => toSummary(r, locale));
    },
    [],
  );
}

export async function listRecentProperties(locale: Locale, take = 9): Promise<PublicPropertySummary[]> {
  return safeQuery(
    "listRecentProperties",
    async (db: PrismaClient) => {
      const rows = await db.property.findMany({
        where: publicWebsiteWhere({ listed: true }),
        orderBy: { publishedAt: "desc" },
        take,
        select: summarySelect,
      });
      return rows.map((r) => toSummary(r, locale));
    },
    [],
  );
}

export type SearchParams = {
  listingType?: string;
  propertyType?: string;
  city?: string;
  areaName?: string;
  neighborhood?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  bedrooms?: number | null;
  energyClass?: string;
  parking?: boolean;
  pool?: boolean;
  garden?: boolean;
  seaView?: boolean;
  furnished?: boolean;
  petsAllowed?: boolean;
  newConstruction?: boolean;
  q?: string;
  sort?: string;
  page?: number;
  limit?: number;
};

export async function searchProperties(
  locale: Locale,
  params: SearchParams,
): Promise<{ data: PublicPropertySummary[]; total: number; page: number; limit: number; pages: number }> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(60, Math.max(1, params.limit ?? 24));

  return safeQuery(
    "searchProperties",
    async (db: PrismaClient) => {
      const where: Record<string, unknown> = { ...publicWebsiteWhere({ listed: true }) };

      if (params.listingType) where.listingType = params.listingType;
      if (params.propertyType) where.propertyType = params.propertyType;
      if (params.city) where.city = { contains: params.city, mode: "insensitive" };
      if (params.areaName) where.areaName = { contains: params.areaName, mode: "insensitive" };
      if (params.neighborhood) where.neighborhood = { contains: params.neighborhood, mode: "insensitive" };
      if (params.energyClass) where.energyClass = params.energyClass;

      if (params.minPrice != null || params.maxPrice != null) {
        where.price = {
          ...(params.minPrice != null ? { gte: params.minPrice } : {}),
          ...(params.maxPrice != null ? { lte: params.maxPrice } : {}),
        };
      }
      if (params.minArea != null || params.maxArea != null) {
        where.area = {
          ...(params.minArea != null ? { gte: params.minArea } : {}),
          ...(params.maxArea != null ? { lte: params.maxArea } : {}),
        };
      }
      if (params.bedrooms != null) where.bedrooms = { gte: params.bedrooms };

      for (const flag of [
        "parking", "pool", "garden", "seaView", "furnished", "petsAllowed", "newConstruction",
      ] as const) {
        if (params[flag]) where[flag] = true;
      }

      if (params.q) {
        // Search the localised text without exposing raw SQL.
        where.OR = [
          { titleEl: { contains: params.q, mode: "insensitive" } },
          { titleEn: { contains: params.q, mode: "insensitive" } },
          { neighborhood: { contains: params.q, mode: "insensitive" } },
          { city: { contains: params.q, mode: "insensitive" } },
          { areaName: { contains: params.q, mode: "insensitive" } },
          { reference: { contains: params.q.toUpperCase() } },
        ];
      }

      const orderBy =
        params.sort === "price_asc" ? [{ price: "asc" as const }]
        : params.sort === "price_desc" ? [{ price: "desc" as const }]
        : params.sort === "area_asc" ? [{ area: "asc" as const }]
        : params.sort === "area_desc" ? [{ area: "desc" as const }]
        : [{ publishedAt: "desc" as const }];

      const [rows, total] = await Promise.all([
        db.property.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit, select: summarySelect }),
        db.property.count({ where }),
      ]);

      return {
        data: rows.map((r) => toSummary(r, locale)),
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      };
    },
    { data: [], total: 0, page, limit, pages: 1 },
  );
}

export async function getPropertyByReference(
  reference: string,
  locale: Locale,
): Promise<PublicPropertyDetail | null> {
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(String(v));
    return Number.isFinite(n) ? n : null;
  };

  return safeQuery(
    "getPropertyByReference",
    async (db: PrismaClient) => {
      const p = await db.property.findFirst({
        // The same rule as the listings, but a NOINDEX page is still served to anyone with its link.
        where: { reference: reference.toUpperCase(), ...publicWebsiteWhere() },
        select: detailSelect,
      });
      if (!p) return null;

      const summary = toSummary(p, locale);
      const publicMedia = p.media
        .filter(isPublicMedia)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);

      return {
        ...summary,
        indexable: p.websitePublication?.visibility === "PUBLIC" && p.websitePublication?.noIndex === false ? true : false,
        titleSecondary: p.titleEn && p.titleEn !== summary.title ? p.titleEn : null,
        description: (locale === "el" ? p.descriptionEl : p.descriptionEn) ?? p.descriptionEl,
        descriptionSecondary:
          locale === "en" && p.descriptionEl !== p.descriptionEn ? p.descriptionEl : null,
        condition: p.condition,
        heating: p.heating,
        floor: p.floor,
        totalFloors: p.totalFloors,
        yearBuilt: p.yearBuilt,
        yearRenovated: p.yearRenovated,
        parking: p.parking,
        storage: p.storage,
        balcony: p.balcony,
        garden: p.garden,
        pool: p.pool,
        furnished: p.furnished,
        petsAllowed: p.petsAllowed,
        seaView: p.seaView,
        hasSolar: p.hasSolar,
        plotArea: num(p.plotArea),
        latitude: num(p.latitude),
        longitude: num(p.longitude),
        videoUrl: p.videoUrl ?? null,
        virtualTourUrl: p.virtualTourUrl ?? null,
        images: publicMedia.map((m) => ({
          url: mediaUrl(m.previewKey ?? m.storageKey),
          alt: pickAlt(m, locale),
          kind: m.kind,
        })),
        // The public site shows the agent's name only. Phone and email are
        // returned by the enquiry endpoint after the form is submitted, so the
        // address is not harvestable from the page source.
        agent: p.agent
          ? { name: `${p.agent.firstName} ${p.agent.lastName}`.trim(), phone: null, email: null }
          : null,
      };
    },
    null,
  );
}

export async function countPublicProperties(): Promise<number> {
  return safeQuery(
    "countPublicProperties",
    async (db: PrismaClient) =>
      db.property.count({ where: publicWebsiteWhere({ listed: true }) }),
    0,
  );
}

/**
 * The properties that belong in the sitemap. Eligibility is derived from the
 * publication's own state (live, PUBLIC, indexable), the property's status and its
 * tags, by the same function the CRM uses; the stored `sitemapIncluded` column is
 * never consulted, so no flag in any UI or stale row can put a page in the sitemap.
 */
export async function listSitemapProperties(take = 2000): Promise<Array<{ reference: string; lastModified: Date }>> {
  return safeQuery(
    "listSitemapProperties",
    async (db: PrismaClient) => {
      const rows = await db.websitePublication.findMany({
        where: { property: publicWebsiteWhere({ listed: true }) as Prisma.PropertyWhereInput, noIndex: false },
        orderBy: { updatedAt: "desc" },
        take,
        select: {
          status: true,
          enabled: true,
          visibility: true,
          noIndex: true,
          lastGeneratedAt: true,
          updatedAt: true,
          property: { select: { reference: true, status: true, tagAssignments: { select: { tag: { select: { code: true } } } } } },
        },
      });
      return rows
        .filter((r) =>
          websiteSitemapEligible({
            status: r.status,
            enabled: r.enabled,
            visibility: r.visibility,
            noIndex: r.noIndex,
            propertyStatus: r.property.status,
            tagCodes: r.property.tagAssignments.map((t) => t.tag.code),
          }),
        )
        .map((r) => ({ reference: r.property.reference, lastModified: r.lastGeneratedAt ?? r.updatedAt }));
    },
    [],
  );
}
