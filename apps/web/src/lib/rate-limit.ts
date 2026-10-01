/**
 * Fixed-window rate limiting, in process memory.
 *
 * This is the correct amount of machinery for a single-instance deployment and
 * an honest liability on anything else: behind two or more instances the limit
 * is per-instance, so the effective allowance multiplies. When the app is run
 * as more than one instance this must be swapped for the shared limiter
 * (Redis/Upstash) that RATE_LIMITS in @home88/validation is already shaped for
 * — the call signature below does not change when it is.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bound the map so a flood of distinct keys cannot grow it without limit.
const MAX_KEYS = 50_000;

function sweep(now: number): void {
  if (buckets.size < MAX_KEYS) return;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: { points: number; durationSeconds: number },
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + limit.durationSeconds * 1000;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit.points - 1, resetAt, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit.points) {
    return {
      ok: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: limit.points - existing.count,
    resetAt: existing.resetAt,
    retryAfterSeconds: 0,
  };
}

/**
 * Best-effort client address. `x-forwarded-for` is only trustworthy when a
 * proxy sets it; it is used as a spam-throttling signal, never as an
 * authorisation decision.
 */
export function clientIp(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || h.get("cf-connecting-ip")?.trim() || "unknown";
}
