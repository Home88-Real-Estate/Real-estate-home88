import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/config";
import { listRecentProperties } from "@/lib/property";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/properties`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/submit`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/request`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/cookies`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/dmca`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Listings. A generous take: the sitemap is what makes new listings findable
  // immediately, and it is served from a cached render.
  let listingRoutes: MetadataRoute.Sitemap = [];
  try {
    const properties = await listRecentProperties("el", 200);
    listingRoutes = properties.map((p) => ({
      url: `${SITE_URL}/property/${p.reference}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    }));
  } catch {
    // A sitemap missing listings is better than a 500; the static routes still
    // get served and search engines retry.
    listingRoutes = [];
  }

  return [...staticRoutes, ...listingRoutes];
}
