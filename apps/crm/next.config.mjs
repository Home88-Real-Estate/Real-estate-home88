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

/**
 * The object-storage origin the API signs URLs for. The browser uploads
 * straight to it (connect-src) and loads not-yet-approved media from it via
 * signed URLs (img-src). Derived from the same S3_* settings the in-process
 * API uses, so it cannot drift from where uploads actually go.
 */
function storageOrigin() {
  const bucket = process.env.S3_BUCKET || "";
  const endpoint = process.env.S3_ENDPOINT || "";
  try {
    if (endpoint) {
      const url = new URL(endpoint);
      if (process.env.S3_FORCE_PATH_STYLE === "true" || !bucket) return url.origin;
      return `${url.protocol}//${bucket}.${url.host}`;
    }
    if (bucket) return `https://${bucket}.s3.${process.env.S3_REGION || "us-east-1"}.amazonaws.com`;
  } catch {
    // An invalid endpoint leaves the policy closed rather than open.
  }
  return "";
}
const uploadOrigin = storageOrigin();

const imgSrc = ["'self'", "data:", "blob:"];
const mediaSrc = ["'self'", "blob:"];
const connectSrc = ["'self'"];
for (const origin of new Set([mediaOrigin, uploadOrigin])) {
  if (!origin) continue;
  imgSrc.push(origin);
  mediaSrc.push(origin);
}
if (uploadOrigin) connectSrc.push(uploadOrigin);
if (isDev) {
  // Local MinIO is plain HTTP; production never needs it.
  imgSrc.push("http:");
  mediaSrc.push("http:");
}

/**
 * The CRM is a backend-for-frontend: the browser only ever talks to this
 * origin, and the session cookie is forwarded to the API from the server. That
 * lets the CSP's connect-src list no API origin (only object storage, for direct
 * uploads) and keeps the session token out of client JavaScript entirely.
 */
const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `img-src ${imgSrc.join(" ")}`,
  `connect-src ${connectSrc.join(" ")}`,
  `media-src ${mediaSrc.join(" ")}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Upgrading in dev would rewrite the plain-HTTP MinIO URLs and break previews.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

/**
 * When the public site proxies /crm to this deployment, the browser's Origin
 * is the public site's while this server sees its own host. Next rejects
 * server actions across that mismatch unless the public origin is allowed.
 * CRM_PUBLIC_ORIGINS: comma-separated origins the CRM is reached through,
 * e.g. "https://realestate-home-88.vercel.app,https://home88.estate".
 */
const allowedActionOrigins = (process.env.CRM_PUBLIC_ORIGINS ?? "")
  .split(",")
  .map((value) => {
    try {
      return new URL(value.trim()).host;
    } catch {
      return "";
    }
  })
  .filter(Boolean);

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * The CRM is its own deploy (real-estate-home88-iota.vercel.app) served under
   * /crm, so the required /crm/login, /crm/security, ... paths exist on that
   * origin. Next applies basePath to `next/link`, `redirect()` and the router
   * automatically; the few places that build a fetch URL by hand read the same
   * value from `lib/paths.ts` (kept in sync through NEXT_PUBLIC_CRM_BASE_PATH).
   */
  basePath: process.env.NEXT_PUBLIC_CRM_BASE_PATH || "/crm",

  /**
   * The API (apps/api) runs inside this deployment (src/lib/api-transport.ts),
   * so its workspace packages are compiled here too.
   */
  transpilePackages: [
    "@home88/api",
    "@home88/database",
    "@home88/domain",
    "@home88/portals",
    "@home88/types",
    "@home88/ui",
    "@home88/validation",
  ],

  /** Server libraries the API uses; loaded by Node at runtime, not bundled. */
  serverExternalPackages: [
    "fastify",
    "@fastify/cookie",
    "@fastify/cors",
    "@prisma/client",
    ".prisma/client",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "nodemailer",
    "pdf-lib",
    "@pdf-lib/fontkit",
  ],

  outputFileTracingRoot: monorepoRoot,

  /**
   * Prisma's query engine is a native file that file tracing cannot discover
   * from imports alone; ship it with every server function. The same goes for
   * the font embedded in mandate PDFs (read from disk by apps/api).
   */
  outputFileTracingIncludes: {
    "/**": ["../../node_modules/.prisma/client/**", "../api/assets/fonts/**"],
  },

  experimental: {
    serverActions: { allowedOrigins: allowedActionOrigins },
  },

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
