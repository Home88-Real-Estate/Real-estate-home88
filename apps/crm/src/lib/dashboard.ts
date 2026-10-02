/**
 * Types for GET /api/dashboard (apps/api/src/routes/dashboard.ts) and the
 * formatting helpers the dashboard uses. Formatting always uses the agency's
 * time zone so server and browser render identical text.
 */

import type { PropertyCategory } from "@home88/domain";

import { TIME_ZONE } from "./format";

export type Flow = { value: number; previous: number };

export type PropertyCard = {
  id: string;
  reference: string;
  titleEl: string;
  status: string;
  listingType: string;
  propertyType: string;
  price: number | null;
  monthlyRent: number | null;
  area: number | null;
  city: string | null;
  areaName: string | null;
  createdAt: string;
  updatedAt: string;
  coverUrl: string | null;
};

export type TaskItem = {
  id: string;
  title: string;
  dueAt: string | null;
  priority: string;
  lead: { id: string; reference: string; firstName: string; lastName: string | null } | null;
  property: { id: string; reference: string } | null;
};

export type DashboardData = {
  generatedAt: string;
  scope: "mine" | "all";
  range: { key: string; from: string; to: string; previousFrom: string; previousTo: string };
  portfolio: {
    total: number;
    active: number;
    drafts: number;
    onWebsite: number;
    byCategory: Record<PropertyCategory, number>;
  };
  period: {
    newProperties: Flow;
    leads: Flow;
    websiteLeads: Flow;
    portalLeads: Flow;
    viewings: Flow;
    offers: Flow;
    sales: Flow;
    rentals: Flow;
  };
  upcomingViewings: number;
  monthly: Array<{ month: string; newProperties: number; leads: number; viewings: number; closings: number }>;
  leadsBySource: Array<{ source: string; count: number }>;
  pipeline: { stages: Array<{ key: string; count: number }>; lost: number; open: number };
  agents: Array<{
    id: string;
    name: string;
    activeProperties: number;
    leads: number;
    viewings: number;
    offers: number;
    closings: number;
  }> | null;
  reminders: {
    overdue: { count: number; items: TaskItem[] };
    today: { count: number; items: TaskItem[] };
    upcoming: { count: number; items: TaskItem[] };
  };
  todaysViewings: Array<{
    id: string;
    startsAt: string;
    endsAt: string | null;
    status: string;
    clientName: string;
    property: { id: string; reference: string; titleEl: string; areaName: string | null; city: string | null };
    agent: { firstName: string; lastName: string };
  }>;
  latestLeads: Array<{
    id: string;
    reference: string;
    firstName: string;
    lastName: string | null;
    source: string;
    status: string;
    createdAt: string;
    property: { id: string; reference: string } | null;
  }>;
  recentProperties: PropertyCard[];
  updatedProperties: PropertyCard[];
  latestOffers: Array<{
    id: string;
    reference: string;
    amount: number;
    status: string;
    createdAt: string;
    property: { id: string; reference: string; titleEl: string };
    lead: { firstName: string; lastName: string | null } | null;
  }>;
  alerts: Array<{ code: string; count: number; severity: "critical" | "warning" | "info" }>;
};

const NUMBER = new Intl.NumberFormat("el-GR");
const MONEY = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function num(value: number): string {
  return NUMBER.format(value);
}

export function money(value: number | null): string {
  return value == null ? "—" : MONEY.format(value);
}

/** Change vs the previous period: direction and a short label. */
export function delta(flow: Flow): { direction: "up" | "down" | "flat"; text: string; title: string } {
  const title = `Προηγούμενη περίοδος: ${num(flow.previous)}`;
  if (flow.value === flow.previous) return { direction: "flat", text: "0%", title };
  if (flow.previous === 0) return { direction: "up", text: "νέο", title };
  const pct = Math.round(((flow.value - flow.previous) / flow.previous) * 100);
  return { direction: pct >= 0 ? "up" : "down", text: `${Math.abs(pct)}%`, title };
}

const DAY_LONG = new Intl.DateTimeFormat("el-GR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TIME_ZONE,
});
const DAY_SHORT = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", timeZone: TIME_ZONE });
const DAY_SHORT_YEAR = new Intl.DateTimeFormat("el-GR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TIME_ZONE,
});
/** 24-hour clock, as Greek offices write times ("15:30", not "3:30 μ.μ."). */
const TIME = new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE });
const HOUR = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TIME_ZONE });
const MONTH_SHORT = new Intl.DateTimeFormat("el-GR", { month: "short", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("el-GR", { month: "long", year: "numeric", timeZone: "UTC" });
const RELATIVE = new Intl.RelativeTimeFormat("el", { numeric: "auto" });

export function longDate(iso: string): string {
  return DAY_LONG.format(new Date(iso));
}

export function greeting(iso: string): string {
  const hour = Number(HOUR.format(new Date(iso)));
  return hour >= 5 && hour < 13 ? "Καλημέρα" : "Καλησπέρα";
}

export function timeOf(iso: string): string {
  return TIME.format(new Date(iso));
}

/** "1 Οκτ – 2 Οκτ 2026" for a [from, to) range. */
export function rangeLabel(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  // `to` is exclusive; show the last included moment's day.
  const to = new Date(new Date(toIso).getTime() - 1);
  return `${DAY_SHORT.format(from)} – ${DAY_SHORT_YEAR.format(to)}`;
}

/** "Οκτ" for "2026-10"; months are calendar buckets, formatted in UTC. */
export function monthShort(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return MONTH_SHORT.format(new Date(Date.UTC(y!, m! - 1, 15))).replace(".", "");
}

export function monthLong(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return MONTH_LONG.format(new Date(Date.UTC(y!, m! - 1, 15)));
}

/** "πριν από 2 ώρες" / "σε 3 ημέρες", relative to `now`. */
export function relative(iso: string, nowIso: string): string {
  const diff = new Date(iso).getTime() - new Date(nowIso).getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) return RELATIVE.format(Math.round(diff / minute), "minute");
  if (abs < day) return RELATIVE.format(Math.round(diff / hour), "hour");
  if (abs < 30 * day) return RELATIVE.format(Math.round(diff / day), "day");
  return DAY_SHORT_YEAR.format(new Date(iso));
}

/** Due date for a reminder: time if today, otherwise a short date + time. */
export function dueLabel(iso: string | null, nowIso: string): string {
  if (!iso) return "Χωρίς προθεσμία";
  const due = new Date(iso);
  const sameDay = DAY_SHORT_YEAR.format(due) === DAY_SHORT_YEAR.format(new Date(nowIso));
  return sameDay ? `Σήμερα ${TIME.format(due)}` : `${DAY_SHORT.format(due)} · ${TIME.format(due)}`;
}

/** Greek singular/plural. */
export function plural(n: number, one: string, many: string): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}
