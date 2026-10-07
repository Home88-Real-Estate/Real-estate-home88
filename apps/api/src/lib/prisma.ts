/**
 * Single Prisma client for the API process.
 *
 * Constructed lazily rather than at import time: building the client requires
 * DATABASE_URL to be present, and a module imported by a test or the type-
 * checker must not fail merely because no database is configured.
 *
 * `lockedDb()` is the same client, wrapped with a query extension so every
 * model operation runs under the process-wide semaphore in `query-lock.ts`.
 * It caps concurrent queries regardless of how the caller fans them out: the
 * dashboard, for example, launches dozens of counts through `mapLimit` and
 * `Promise.all`, and without a leaf-level lock those can still pile on top of
 * each other and exhaust the small serverless pool. Raw and transaction
 * operations (model names starting with "$") pass through unlocked, so an
 * interactive `$transaction` is never itself queued and cannot deadlock.
 */

import { PrismaClient, serverlessDatabaseUrl } from "@home88/database";

import { withQueryLock } from "./query-lock";

const globalForPrisma = globalThis as unknown as { home88ApiPrisma?: PrismaClient };

let client: PrismaClient | null = null;

export function db(): PrismaClient {
  if (client) return client;
  const url = serverlessDatabaseUrl(process.env.DATABASE_URL);
  client =
    globalForPrisma.home88ApiPrisma ??
    new PrismaClient({ log: ["warn", "error"], ...(url ? { datasources: { db: { url } } } : {}) });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.home88ApiPrisma = client;
  }
  return client;
}

function buildLockedClient() {
  return db().$extends({
    query: {
      $allOperations({ model, args, query }) {
        if (!model || model.startsWith("$")) return query(args);
        return withQueryLock(() => query(args));
      },
    },
  });
}

let lockedClient: ReturnType<typeof buildLockedClient> | null = null;

/** The shared Prisma client with every model operation serialised by the global query semaphore. */
export function lockedDb() {
  lockedClient ??= buildLockedClient();
  return lockedClient;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
