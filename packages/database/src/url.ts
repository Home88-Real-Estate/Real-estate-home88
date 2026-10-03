/**
 * Connection settings for serverless functions behind Supabase's pooler.
 *
 * In transaction mode (Supavisor, port 6543) Prisma must not use prepared
 * statements (`pgbouncer=true`). A pool of a single connection makes every
 * page that runs several queries wait in line, and queued queries then hit
 * Prisma's pool timeout. So, for the pooler only: keep `pgbouncer=true`,
 * allow at least MIN_CONNECTIONS per function instance and wait longer for a
 * free one. Any other database URL is returned unchanged.
 */

const MIN_CONNECTIONS = 5;
const POOL_TIMEOUT_SECONDS = "30";

export function serverlessDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw; // Let Prisma report the invalid URL itself.
  }
  const transactionPooler = url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543";
  if (!transactionPooler) return raw;

  url.searchParams.set("pgbouncer", "true");
  const limit = Number(url.searchParams.get("connection_limit"));
  if (!Number.isFinite(limit) || limit < MIN_CONNECTIONS) {
    url.searchParams.set("connection_limit", String(MIN_CONNECTIONS));
  }
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", POOL_TIMEOUT_SECONDS);
  return url.toString();
}
