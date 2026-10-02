/** @type {import('next').NextConfig} */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(__dirname, "..", "..");

const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";

/**
 * Media is served from object storage on its own origin, so `img-src` has to
 * name it. Derive the origin from the configured base URL rather than hard-coding
 * a bucket host; an invalid value just leaves the list closed.
 */
let mediaOrigin = "";
try {
  if (process.env.NEXT_PUBLIC_MEDIA_BASE_URL) {
    mediaOrigin = new URL(process.env.NEXT_PUBLIC_MEDIA_BASE_URL).origin;
  }
} catch {
  mediaOrigin = "";
}

const imgSrc = ["'self'", "data:", "blob:"];
const mediaSrc = ["'self'", "blob:"];
if (mediaOrigin) {
  imgSrc.push(mediaOrigin);
  mediaSrc.push(mediaOrigin);
}
if (isDev) {
  // Local MinIO is plain HTTP; production never needs it.
  imgSrc.push("http:");
  mediaSrc.push("http:");
}

/**
 * The CRM is a backend-for-frontend: the browser only ever talks to this
 * origin, and the session cookie is forwarded to the API from the server. That
 * lets the CSP stay at `connect-src 'self'` with no API origin listed and keeps
 * the session token out of client JavaScript entirely.
 */
const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `img-src ${imgSrc.join(" ")}`,
  "connect-src 'self'",
  `media-src ${mediaSrc.join(" ")}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Upgrading in dev would rewrite the plain-HTTP MinIO URLs and break previews.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * The CRM is its own deploy (e.g. crm.home88.estate) served under /crm, so the
   * required /crm/login, /crm/security, ... paths exist on that origin. Next
   * applies basePath to `next/link`, `redirect()` and the router automatically;
   * the few places that build a fetch URL by hand read the same value from
   * `lib/paths.ts` (kept in sync through NEXT_PUBLIC_CRM_BASE_PATH).
   */
  basePath: process.env.NEXT_PUBLIC_CRM_BASE_PATH || "/crm",

  transpilePackages: ["@home88/types", "@home88/ui"],

  outputFileTracingRoot: monorepoRoot,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // An internal tool should never be indexed, on any path.
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
