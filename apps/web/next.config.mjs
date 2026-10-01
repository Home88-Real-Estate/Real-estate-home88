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
  "connect-src 'self'",
  "media-src 'self'",
  "frame-src 'self' https://www.youtube-nocookie.com https://www.google.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The workspace packages ship TypeScript source, so Next must compile them.
  transpilePackages: [
    "@home88/database",
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

  async headers() {
    return [
      {
        source: "/:path*",
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
    return [
      // Legacy/alternate paths used by the previous deployment.
      { source: "/property", destination: "/properties", permanent: true },
      { source: "/legal/privacy-policy", destination: "/privacy", permanent: true },
      { source: "/legal/terms", destination: "/terms", permanent: true },
    ];
  },
};

export default nextConfig;
