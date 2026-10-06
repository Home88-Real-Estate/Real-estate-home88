import { toNumber } from "@home88/ui";

const EMPTY = "-";

export function formatMoney(value: unknown): string {
  const n = toNumber(value);
  if (n == null) return EMPTY;
  return new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatDecimal(value: unknown): string {
  const n = toNumber(value);
  if (n == null) return EMPTY;
  return new Intl.NumberFormat("el-GR", { maximumFractionDigits: 2 }).format(n);
}

export function formatInt(value: unknown): string {
  const n = toNumber(value);
  if (n == null) return EMPTY;
  return new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 }).format(n);
}

export function formatArea(value: unknown): string {
  const n = toNumber(value);
  if (n == null) return EMPTY;
  return `${formatDecimal(n)} m²`;
}

/**
 * Dates are shown in the agency's time zone, explicitly: the server may run
 * in UTC, and server and browser must render the same text.
 */
export const TIME_ZONE = "Europe/Athens";

export function formatDateTime(value: unknown): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  return new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: TIME_ZONE }).format(d);
}

export function formatTime(value: unknown): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  return new Intl.DateTimeFormat("el-GR", { timeStyle: "short", hourCycle: "h23", timeZone: TIME_ZONE }).format(d);
}

/** Value for <input type="date"> and <input type="time"> in the office's time zone. */
export function inputDateTime(value: unknown): { date: string; time: string } {
  const d = toDate(value);
  if (!d) return { date: "", time: "" };
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function formatDate(value: unknown): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  return new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: TIME_ZONE }).format(d);
}

function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Joins a person's name fields, falling back to a dash. */
export function personName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const name = `${first ?? ""} ${last ?? ""}`.trim();
  return name.length > 0 ? name : EMPTY;
}
