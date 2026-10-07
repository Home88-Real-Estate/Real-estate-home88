/**
 * Global cap on concurrent database queries for the dashboard.
 *
 * The serverless API shares one small Prisma pool (a handful of connections
 * per function instance), so wide fan-outs queue dozens of queries and trip
 * the pool timeout (503 "database unavailable"). The per-group guards in
 * map-limit.ts only shape each group in isolation: the dashboard's groups run
 * beside each other, so a single request can still hold far more queries in
 * flight than the pool has connections.
 *
 * This module is the single, global choke-point: no dashboard query runs
 * until a slot is free, whatever group it belongs to (and across dashboard
 * requests on the same function instance). It is acquired at the leaf — the
 * individual query — never around a group of queries, so it cannot deadlock
 * the nested mapLimit/runAll orchestration.
 */

const DEFAULT_CAP = 4;

/** A process-global FIFO semaphore with a fixed number of slots. */
class QuerySemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("QuerySemaphore limit must be a positive integer.");
    }
  }

  /** Number of slots currently held (for tests and monitoring). */
  get running(): number {
    return this.active;
  }

  /** Resolves to a release function once a slot is free. */
  acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.release);
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve(this.release);
      });
    });
  }

  private release = (): void => {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  };
}

const capValue = Number(process.env.DASHBOARD_QUERY_CONCURRENCY ?? DEFAULT_CAP);
const lock = new QuerySemaphore(Number.isInteger(capValue) && capValue >= 1 ? capValue : DEFAULT_CAP);

/**
 * Runs `query` only when a global slot is free, releasing the slot when the
 * query settles (success or failure).
 */
export function withQueryLock<T>(query: () => Promise<T>): Promise<T> {
  return lock.acquire().then((release) =>
    query().then(
      (value) => {
        release();
        return value;
      },
      (error: unknown) => {
        release();
        throw error;
      },
    ),
  );
}