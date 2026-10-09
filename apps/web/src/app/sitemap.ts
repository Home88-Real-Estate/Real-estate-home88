import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/config";
import { listSitemapProperties } from "@/lib/property";
import { listAreas } from "@/lib/areas";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/properties`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/areas`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/submit`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/request`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/valuation`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/cookies`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/dmca`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Area landing pages, derived from live listings (empty until there are any).
  let areaRoutes: MetadataRoute.Sitemap = [];
  try {
    const areas = await listAreas();
    areaRoutes = areas.map((a) => ({
      url: `${SITE_URL}/areas/${a.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    }));
  } catch {
    areaRoutes = [];
  }

  // Listings. Which properties belong here is derived from their publication state
  // (live, public, indexable, a public property status, no keep-off tag) by
  // listSitemapProperties; nothing stored or sent by a screen decides it.
  let listingRoutes: MetadataRoute.Sitemap = [];
  try {
    const properties = await listSitemapProperties();
    listingRoutes = properties.map((p) => ({
      url: `${SITE_URL}/property/${p.reference}`,
      lastModified: p.lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    }));
  } catch {
    // A sitemap missing listings is better than a 500; the static routes still
    // get served and search engines retry.
    listingRoutes = [];
  }

  return [...staticRoutes, ...areaRoutes, ...listingRoutes];
}
