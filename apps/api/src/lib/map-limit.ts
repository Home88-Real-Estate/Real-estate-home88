/**
 * Bounded fan-out for the serverless API.
 *
 * The in-process API shares one small Prisma pool (a handful of connections
 * per function instance), so wide `Promise.all` fans out to dozens of queued
 * queries and trips the pool timeout (503 "database unavailable"). Places that
 * assemble many counts in parallel should route through `runAll` / `mapLimit`
 * instead of `Promise.all`.
 *
 * Results keep the order of the input, and both helpers reject on the first
 * error exactly like `Promise.all`.
 */

/** Per-element result type of `runAll`: each slot takes its own query's type. */
export type RunAll<T extends readonly (() => Promise<unknown>)[]> = {
  -readonly [K in keyof T]: Awaited<ReturnType<T[K]>>;
};

/** Result shape of `mapLimit`: the input's tuple keeps its own element types. */
type MappedResults<T extends readonly unknown[], R> = {
  -readonly [K in keyof T]: R;
};

/**
 * Runs `items` with at most `limit` in flight, preserving input order and
 * each slot's type (when the input is a tuple, so destructuring stays exact).
 * For heterogeneous queries use `runAll`, which keeps per-query types.
 */
export async function mapLimit<const T extends readonly unknown[], R>(
  items: T,
  limit: number,
  fn: (item: T[number], index: number) => Promise<R>,
): Promise<MappedResults<T, R>> {
  const out = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return out as MappedResults<T, R>;
}

/**
 * Runs a list of query factories (each `() => db().something(...)`) with at
 * most `limit` of them in flight, and resolves to a tuple whose types match
 * the provided queries one-to-one, so destructuring is just like `Promise.all`
 * over the same queries.
 */
export async function runAll<const T extends readonly (() => Promise<unknown>)[]>(
  queries: T,
  limit: number,
): Promise<RunAll<T>> {
  const results = await mapLimit(queries, limit, (query) => query());
  return results as RunAll<T>;
}