/**
 * Prisma access for the public website.
 *
 * The public site must never crash on a missing database — a listings page that
 * throws a 500 is worse than a listings page that says "no results yet". Every
 * read goes through `safeQuery`, which degrades to a fallback and reports the
 * failure to the server log rather than to the visitor.
 */

import { PrismaClient } from "@home88/database";
import { HAS_DATABASE } from "./config";

/**
 * Next.js hot-reloads modules in development, which would open a new pool on
 * every edit. The global cache keeps exactly one client per process.
 */
const globalForPrisma = globalThis as unknown as { home88Prisma?: PrismaClient };

export const prisma: PrismaClient | null = HAS_DATABASE
  ? (globalForPrisma.home88Prisma ?? new PrismaClient({ log: ["warn", "error"] }))
  : null;

if (HAS_DATABASE && process.env.NODE_ENV !== "production" && prisma) {
  globalForPrisma.home88Prisma = prisma;
}

export async function safeQuery<T>(
  label: string,
  fn: (db: PrismaClient) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!prisma) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[home88:web] ${label}: no DATABASE_URL configured, returning fallback.`);
    }
    return fallback;
  }
  try {
    return await fn(prisma);
  } catch (error) {
    // Log the failure server-side with a stable label. Never surface the raw
    // error to the page: Prisma errors can contain connection strings.
    console.error(`[home88:web] ${label} failed:`, error instanceof Error ? error.message : "unknown");
    return fallback;
  }
}
