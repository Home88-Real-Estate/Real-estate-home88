/**
 * Single Prisma client for the API process.
 *
 * Constructed lazily rather than at import time: building the client requires
 * DATABASE_URL to be present, and a module imported by a test or the type-
 * checker must not fail merely because no database is configured.
 */

import { PrismaClient } from "@home88/database";

const globalForPrisma = globalThis as unknown as { home88ApiPrisma?: PrismaClient };

let client: PrismaClient | null = null;

export function db(): PrismaClient {
  if (client) return client;
  client = globalForPrisma.home88ApiPrisma ?? new PrismaClient({ log: ["warn", "error"] });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.home88ApiPrisma = client;
  }
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
