/**
 * Guards against a broken feed wiping a portal.
 *
 * Some portals treat the feed as the complete set and remove whatever is absent
 * (Green Acres documents this "cancel and replace" behaviour). A bug, a bad
 * filter or an outage that shrinks the set would then delist real inventory, so
 * a large drop is held for a person to confirm. Thresholds are configuration.
 */

export type GuardConfig = {
  /** Block when the new set is smaller than the last confirmed one by more than this. */
  maxDropPercent: number;
  /** Below this many previous listings only an empty feed is blocked; small books swing naturally. */
  minPreviousForPercent: number;
  /** Raise a notice (not a block) when the set grows by more than this. */
  surgePercent: number;
};

export const DEFAULT_GUARD: GuardConfig = {
  maxDropPercent: 30,
  minPreviousForPercent: 10,
  surgePercent: 100,
};

export type GuardVerdict = {
  blocked: boolean;
  surge: boolean;
  kind: "EMPTY" | "DROP" | "SURGE" | null;
  previousCount: number | null;
  nextCount: number;
  changePercent: number | null;
  message: string | null;
};

export function guardConfigFromSettings(settings: Record<string, unknown> | null | undefined): GuardConfig {
  const raw = settings?.publicationGuard;
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pct = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1000 ? value : fallback;
  return {
    maxDropPercent: Math.min(pct(v.maxDropPercent, DEFAULT_GUARD.maxDropPercent), 100),
    minPreviousForPercent: pct(v.minPreviousForPercent, DEFAULT_GUARD.minPreviousForPercent),
    surgePercent: pct(v.surgePercent, DEFAULT_GUARD.surgePercent),
  };
}

/**
 * `previousCount` is the last count a person confirmed (or the last one served
 * without a block). `null` means there is no baseline yet, which is the first
 * publication: nothing is compared, but an empty set is still refused.
 */
export function guardPublicationChange(
  previousCount: number | null,
  nextCount: number,
  config: GuardConfig = DEFAULT_GUARD,
): GuardVerdict {
  const base = { previousCount, nextCount, surge: false, blocked: false, kind: null, changePercent: null, message: null } as GuardVerdict;

  if (nextCount === 0 && (previousCount === null || previousCount > 0)) {
    return {
      ...base,
      blocked: true,
      kind: "EMPTY",
      message: previousCount === null ? "Η ροή είναι κενή." : `⚠ Η ροή είναι κενή ενώ δημοσιεύονταν ${previousCount} ακίνητα.`,
    };
  }
  if (previousCount === null || previousCount === 0) return base;

  const changePercent = Math.round(((nextCount - previousCount) / previousCount) * 1000) / 10;
  const result = { ...base, changePercent };

  if (previousCount >= config.minPreviousForPercent && -changePercent > config.maxDropPercent) {
    return {
      ...result,
      blocked: true,
      kind: "DROP",
      message: `⚠ Εντοπίστηκε σημαντική μείωση δημοσιεύσεων: ${previousCount} → ${nextCount} (${changePercent}%).`,
    };
  }
  if (previousCount >= config.minPreviousForPercent && changePercent > config.surgePercent) {
    return {
      ...result,
      surge: true,
      kind: "SURGE",
      message: `Εντοπίστηκε σημαντική αύξηση δημοσιεύσεων: ${previousCount} → ${nextCount} (+${changePercent}%).`,
    };
  }
  return result;
}
