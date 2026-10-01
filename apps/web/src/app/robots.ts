import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

/**
 * robots.txt.
 *
 * The CRM and API are deliberately excluded; they are also behind auth, but a
 * crawler should not be given the opportunity to index a login page or an
 * endpoint that returns JSON.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/crm/",
          "/admin/",
          "/account/",
          "/login",
          "/unsubscribe",
          // Filtered/paginated search URLs: allowed to be followed, not
          // indexed, to avoid a combinatorial explosion of near-duplicates.
          "/properties?",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
