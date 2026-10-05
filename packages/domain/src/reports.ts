/**
 * Report building blocks: the arithmetic every report shares, and CSV output.
 *
 * Definitions are deliberately plain and are shown beside the numbers in the
 * CRM, so a figure can be checked against the records it was counted from.
 * Nothing here estimates or smooths: a rate with nothing to divide is `null`
 * (shown as "—"), never zero.
 */

export const REPORT_KINDS = ["leads", "inventory", "sales", "sellers", "communications"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABELS: Record<ReportKind, { title: string; description: string; minRole: "AGENT" | "MANAGER" }> = {
  leads: {
    title: "Leads & πηγές",
    description: "Από πού έρχονται τα leads, πόσα κλείνουν και πόσο γρήγορα επικοινωνούμε.",
    minRole: "AGENT",
  },
  inventory: {
    title: "Χαρτοφυλάκιο ακινήτων",
    description: "Ακίνητα ανά κατάσταση και τύπο, χρόνος στην αγορά και μειώσεις τιμής.",
    minRole: "AGENT",
  },
  sales: {
    title: "Συναλλαγές & προμήθειες",
    description: "Συναλλαγές ανά κατάσταση, συμφωνημένα ποσά και προμήθειες.",
    minRole: "MANAGER",
  },
  sellers: {
    title: "Ιδιοκτήτες & εντολές",
    description: "Από το πρώτο ενδιαφέρον ιδιοκτήτη μέχρι την εντολή και την καταχώριση.",
    minRole: "AGENT",
  },
  communications: {
    title: "Επικοινωνία",
    description: "Μηνύματα προς πελάτες ανά κανάλι και αποτέλεσμα.",
    minRole: "MANAGER",
  },
};

export function isReportKind(value: string): value is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value);
}

/** `part` as a percentage of `whole`, one decimal; null when there is nothing to divide. */
export function ratePct(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** Median of the numbers; null for none. Even counts average the two middle values. */
export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round(((v[mid - 1]! + v[mid]!) / 2) * 10) / 10;
}

export function average(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length === 0) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

const HOUR = 3_600_000;

/** Whole hours from `from` to `to`, null when either is missing or the order is wrong. */
export function hoursBetween(from: Date | string | null | undefined, to: Date | string | null | undefined): number | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms >= 0 ? Math.round((ms / HOUR) * 10) / 10 : null;
}

/** Sum of money values as numbers (Prisma decimals arrive as strings or Decimal objects). */
export function sumMoney(values: Array<number | string | { toString(): string } | null | undefined>): number {
  let cents = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const n = Number(typeof v === "object" ? v.toString() : v);
    if (Number.isFinite(n)) cents += Math.round(n * 100);
  }
  return cents / 100;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | boolean | null | undefined };

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starts with
 * = + - @ or a tab / carriage return) is prefixed with an apostrophe, so a
 * record whose name begins with "=" cannot execute when the file is opened.
 * Numbers are written as numbers with a decimal comma and are left alone
 * (a leading minus is a number, not a formula).
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value).replace(".", ",") : "";
  if (typeof value === "boolean") return value ? "ΝΑΙ" : "ΟΧΙ";
  let text = value.replace(/\r\n|\r|\n/g, " ");
  // Judge the original: a leading tab or carriage return, or spaces before "=", are all ways to hide a formula.
  if (/^[\t\r]/.test(value) || /^[ \t\r]*[=+\-@]/.test(value)) text = `'${text}`;
  return /[";]/.test(text) || text.startsWith("'") ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV for Greek-locale Excel: semicolon-separated (the list separator there),
 * decimal comma, a BOM and CRLF line ends so Greek text opens correctly.
 */
export function toCsv<T>(columns: Array<CsvColumn<T>>, rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(";"), ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
