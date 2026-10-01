/**
 * Fixed-window in-process limiter.
 *
 * Intentionally not Redis-backed yet: the API runs as a single instance during
 * bring-up, and an in-process limiter cannot be defeated by a client that
 * changes IP the way a naive per-request counter can. When the API scales
 * horizontally this is the first thing to move to Redis, and it is isolated
 * here so that change is one file.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Removes expired buckets. Called opportunistically to keep the map bounded. */
function sweep(now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitRule = { points: number; durationSeconds: number };

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function consume(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const windowMs = rule.durationSeconds * 1000;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: rule.points - 1, resetAt, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= rule.points;
  return {
    allowed,
    remaining: Math.max(0, rule.points - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
}
