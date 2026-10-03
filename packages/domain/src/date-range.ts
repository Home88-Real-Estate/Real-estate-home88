/**
 * Reporting periods, computed in the agency's time zone (Europe/Athens), so
 * "today" and "this month" start at local midnight in both winter (UTC+2)
 * and summer (UTC+3), whatever zone the server runs in.
 *
 * Pure: `now` is always passed in, so every boundary is unit-tested.
 */

export const AGENCY_TIME_ZONE = "Europe/Athens";

export const RANGE_KEYS = ["today", "week", "month", "quarter", "year"] as const;
export type RangePreset = (typeof RANGE_KEYS)[number];
export type RangeKey = RangePreset | "custom";

export type DateRange = {
  key: RangeKey;
  /** Inclusive start. */
  from: Date;
  /** Exclusive end. */
  to: Date;
  /** The equally long period just before, for "vs previous period". */
  previousFrom: Date;
  previousTo: Date;
};

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Wall-clock parts of an instant in a time zone (weekday: Monday = 1). */
export function zonedParts(date: Date, timeZone: string = AGENCY_TIME_ZONE): Parts {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday ?? "Mon"] ?? 1,
  };
}

/** Offset of the zone from UTC at `date`, in milliseconds (Athens summer: +3h). */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which the zone's wall clock reads the given local time.
 * Out-of-range fields roll over (month 0 is December of the year before),
 * which is what makes "start of the previous month" a one-liner.
 */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  timeZone: string = AGENCY_TIME_ZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  // Re-check at the candidate: the offset can differ across a DST change.
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

function startOf(key: RangePreset, now: Date, timeZone: string): Date {
  const p = zonedParts(now, timeZone);
  switch (key) {
    case "today":
      return zonedTime(p.year, p.month, p.day, 0, 0, timeZone);
    case "week":
      // Weeks start on Monday in Greece.
      return zonedTime(p.year, p.month, p.day - (p.weekday - 1), 0, 0, timeZone);
    case "month":
      return zonedTime(p.year, p.month, 1, 0, 0, timeZone);
    case "quarter":
      return zonedTime(p.year, Math.floor((p.month - 1) / 3) * 3 + 1, 1, 0, 0, timeZone);
    case "year":
      return zonedTime(p.year, 1, 1, 0, 0, timeZone);
  }
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(value: string | undefined): { year: number; month: number; day: number } | null {
  const match = value ? ISO_DAY.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** Longest custom period accepted (a guard against accidental full scans). */
const MAX_CUSTOM_DAYS = 3 * 366;

function withPrevious(key: RangeKey, from: Date, to: Date): DateRange {
  const length = to.getTime() - from.getTime();
  return { key, from, to, previousFrom: new Date(from.getTime() - length), previousTo: from };
}

/**
 * Resolves a requested period. Presets run from their local start to `now`;
 * a custom period covers whole local days `from`..`to` inclusive. Anything
 * invalid falls back to the current month.
 */
export function resolveRange(
  input: { key?: string | null; from?: string | null; to?: string | null },
  now: Date,
  timeZone: string = AGENCY_TIME_ZONE,
): DateRange {
  if (input.key === "custom") {
    const a = parseDay(input.from ?? undefined);
    const b = parseDay(input.to ?? undefined);
    if (a && b) {
      const from = zonedTime(a.year, a.month, a.day, 0, 0, timeZone);
      const to = zonedTime(b.year, b.month, b.day + 1, 0, 0, timeZone);
      const days = (to.getTime() - from.getTime()) / 86_400_000;
      if (days > 0 && days <= MAX_CUSTOM_DAYS) return withPrevious("custom", from, to);
    }
  }
  const key: RangePreset = (RANGE_KEYS as readonly string[]).includes(input.key ?? "")
    ? (input.key as RangePreset)
    : "month";
  return withPrevious(key, startOf(key, now, timeZone), now);
}

export type MonthBucket = { key: string; from: Date; to: Date };

/** The last `count` calendar months up to and including the current one. */
export function lastMonths(now: Date, count = 12, timeZone: string = AGENCY_TIME_ZONE): MonthBucket[] {
  const p = zonedParts(now, timeZone);
  const buckets: MonthBucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const from = zonedTime(p.year, p.month - i, 1, 0, 0, timeZone);
    const to = zonedTime(p.year, p.month - i + 1, 1, 0, 0, timeZone);
    const local = zonedParts(new Date(from.getTime() + 12 * 3_600_000), timeZone);
    buckets.push({ key: `${local.year}-${String(local.month).padStart(2, "0")}`, from, to });
  }
  return buckets;
}

/** Start of the local day containing `now`, and of the next one. */
export function localDay(now: Date, timeZone: string = AGENCY_TIME_ZONE): { from: Date; to: Date } {
  const p = zonedParts(now, timeZone);
  return {
    from: zonedTime(p.year, p.month, p.day, 0, 0, timeZone),
    to: zonedTime(p.year, p.month, p.day + 1, 0, 0, timeZone),
  };
}

/**
 * "2026-10-05T10:30" (a datetime-local input, no zone) read as agency time.
 * Returns null for anything else.
 */
export function parseLocalDateTime(value: string, timeZone: string = AGENCY_TIME_ZONE): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31 || h! > 23 || mi! > 59) return null;
  return zonedTime(y!, mo!, d!, h!, mi!, timeZone);
}

/** The inverse, for prefilling a datetime-local input: "2026-10-05T10:30". */
export function toLocalDateTimeInput(date: Date, timeZone: string = AGENCY_TIME_ZONE): string {
  const p = zonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
