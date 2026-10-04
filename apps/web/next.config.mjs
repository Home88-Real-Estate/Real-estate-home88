/** @type {import('next').NextConfig} */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Trace from the monorepo root. Without this, a lockfile in a parent directory
// can make Next treat that directory as the project root and mis-trace files.
const monorepoRoot = path.join(__dirname, "..", "..");

/**
 * Security headers are set here rather than only at the CDN so that
 * `next dev` behaves like production. The CSP is deliberately explicit: there
 * is no wildcard for fonts or styles, because a wildcard is what lets a
 * third-party font or stylesheet back in later without anyone noticing.
 */
const isDev = process.env.NODE_ENV !== "production";

let uploadOrigin = "";
try {
  uploadOrigin = process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : "";
} catch {
  uploadOrigin = "";
}

/**
 * Next.js injects inline bootstrap scripts and, in dev, eval-based HMR.
 * Production still needs 'unsafe-inline' for the framework's inline scripts
 * unless nonces are wired through middleware. Rather than pretend otherwise,
 * we keep 'unsafe-inline' for scripts and document the nonce upgrade path.
 */
const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  // No style-src wildcard: this is the rule that would otherwise permit
  // fonts.googleapis.com. Styles are same-origin; Next injects inline styles.
  "style-src 'self' 'unsafe-inline'",
  // No font-src wildcard either. Fonts are self-hosted (see globals.css).
  "font-src 'self'",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
  // Direct-to-storage uploads (owner photos) need the bucket origin; unset means uploads are off.
  `connect-src 'self'${uploadOrigin ? ` ${uploadOrigin}` : ""}`,
  "media-src 'self'",
  "frame-src 'self' https://www.youtube-nocookie.com https://www.google.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * The staff CRM can be served on this site's own origin under /crm: requests
 * are passed through to the CRM deployment named by CRM_ORIGIN (server-only,
 * e.g. https://home88-crm.vercel.app). The CRM is built with basePath /crm, so
 * its pages, assets and API routes all live under that prefix and need no
 * other change. Unset, nothing is proxied.
 */
const crmBasePath = (process.env.NEXT_PUBLIC_CRM_BASE_PATH || "/crm").replace(/\/+$/, "");
let crmOrigin = "";
try {
  if (process.env.CRM_ORIGIN) crmOrigin = new URL(process.env.CRM_ORIGIN).origin;
} catch {
  crmOrigin = "";
}
const crmSegment = crmBasePath.replace(/^\//, "");

/**
 * The HOME88 CRM's production deployment (keep in sync with src/lib/config.ts).
 * Without CRM_ORIGIN, /crm on this site redirects there, so old bookmarks and
 * typed URLs still reach the staff sign-in.
 */
const DEFAULT_CRM_ORIGIN = "https://real-estate-home88-iota.vercel.app";
let crmRedirectOrigin = "";
try {
  crmRedirectOrigin = new URL(process.env.NEXT_PUBLIC_CRM_URL || DEFAULT_CRM_ORIGIN).origin;
} catch {
  crmRedirectOrigin = DEFAULT_CRM_ORIGIN;
}
let siteOrigin = "";
try {
  siteOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || "").origin;
} catch {
  siteOrigin = "";
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The workspace packages ship TypeScript source, so Next must compile them.
  transpilePackages: [
    "@home88/database",
    "@home88/domain",
    "@home88/intake",
    "@home88/types",
    "@home88/ui",
    "@home88/validation",
  ],

  // Keep file tracing inside the monorepo.
  outputFileTracingRoot: monorepoRoot,

  // Property photos are served from object storage, not proxied through Next.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "http", hostname: "localhost" },
    ],
  },

  async rewrites() {
    if (!crmOrigin) return [];
    return [
      { source: crmBasePath, destination: `${crmOrigin}${crmBasePath}` },
      { source: `${crmBasePath}/:path*`, destination: `${crmOrigin}${crmBasePath}/:path*` },
    ];
  },

  async headers() {
    return [
      {
        // Everything except the proxied CRM, which sends its own (stricter)
        // security headers; stacking both CSPs would block the CRM's media.
        source: `/:path((?!${crmSegment}(?:/|$)).*)`,
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Never index the CRM or API surfaces that may be proxied here.
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },

  async redirects() {
    const crm =
      // Never redirect to this site itself (that would loop).
      crmOrigin || isDev || crmRedirectOrigin === siteOrigin
        ? []
        : [
            { source: crmBasePath, destination: `${crmRedirectOrigin}${crmBasePath}/login`, permanent: false },
            {
              source: `${crmBasePath}/:path*`,
              destination: `${crmRedirectOrigin}${crmBasePath}/:path*`,
              permanent: false,
            },
          ];
    return [
      // Legacy/alternate paths used by the previous deployment.
      { source: "/property", destination: "/properties", permanent: true },
      { source: "/legal/privacy-policy", destination: "/privacy", permanent: true },
      { source: "/legal/terms", destination: "/terms", permanent: true },
      ...crm,
    ];
  },
};

export default nextConfig;
