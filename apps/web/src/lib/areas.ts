/**
 * Area landing pages.
 *
 * Areas are not a separate table — they are derived from the listings that
 * actually exist. A page is only generated for an area with live listings, so
 * we never publish an empty "SEO" page for a place we do not actually cover.
 */

import { PUBLIC_PROPERTY_STATUSES } from "@home88/domain";
import type { Prisma } from "@home88/database";

import { safeQuery } from "./db";

/** Only these statuses are ever visible on the public site (owned by @home88/domain). */
const PUBLIC_STATUSES = PUBLIC_PROPERTY_STATUSES;

export interface AreaSummary {
  slug: string;
  name: string;
  city: string | null;
  count: number;
}

/** Same shape as the API's property slug: lower-case, Greek letters kept. */
export function areaSlug(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0370-\u03ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function listAreas(): Promise<AreaSummary[]> {
  return safeQuery(
    "listAreas",
    async (db) => {
      const rows = await db.property.groupBy({
        by: ["city", "areaName"],
        where: {
          publishedOnWebsite: true,
          status: { in: [...PUBLIC_STATUSES] },
          areaName: { not: null },
        } as Prisma.PropertyWhereInput,
        _count: true,
      });

      const raw = rows
        .filter((r) => !!r.areaName)
        .map((r) => ({
          name: r.areaName as string,
          city: r.city ?? null,
          count: typeof r._count === "number" ? r._count : 0,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "el"));

      // Disambiguate collisions deterministically (most listings keeps the
      // clean slug; ties broken by the sort above).
      const used = new Map<string, number>();
      return raw.map((a) => {
        const base = areaSlug(a.name) || "area";
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        return { ...a, slug: seen === 0 ? base : `${base}-${seen + 1}` };
      });
    },
    [],
  );
}

export async function getAreaBySlug(slug: string): Promise<AreaSummary | null> {
  const areas = await listAreas();
  return areas.find((a) => a.slug === slug) ?? null;
}
