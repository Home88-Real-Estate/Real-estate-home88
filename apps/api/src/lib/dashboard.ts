/**
 * Pure assembly for the dashboard: everything here takes plain counts and rows
 * and returns the response shape, so it is unit-tested without a database.
 * The route (routes/dashboard.ts) only runs the queries.
 */

import { categoryOf, PROPERTY_CATEGORIES, type PropertyCategory } from "@home88/domain";

export type Severity = "critical" | "warning" | "info";

export type Alert = {
  code:
    | "OVERDUE_TASKS"
    | "UNCONTACTED_LEADS"
    | "ACTIVE_WITHOUT_PHOTO"
    | "PORTAL_FAILED"
    | "MEDIA_PENDING"
    | "OFFERS_PENDING"
    | "STALE_DRAFTS";
  count: number;
  severity: Severity;
};

export type AlertCounts = {
  overdueTasks: number;
  uncontactedLeads: number;
  activeWithoutPhoto: number;
  offersPending: number;
  staleDrafts: number;
  /** Only counted for managers and above; null otherwise. */
  portalFailed: number | null;
  mediaPending: number | null;
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Alerts worth showing, most severe first; zero counts are dropped. */
export function buildAlerts(counts: AlertCounts): Alert[] {
  const alerts: Alert[] = [
    { code: "OVERDUE_TASKS", count: counts.overdueTasks, severity: "critical" },
    { code: "PORTAL_FAILED", count: counts.portalFailed ?? 0, severity: "critical" },
    { code: "UNCONTACTED_LEADS", count: counts.uncontactedLeads, severity: "warning" },
    { code: "ACTIVE_WITHOUT_PHOTO", count: counts.activeWithoutPhoto, severity: "warning" },
    { code: "OFFERS_PENDING", count: counts.offersPending, severity: "info" },
    { code: "MEDIA_PENDING", count: counts.mediaPending ?? 0, severity: "info" },
    { code: "STALE_DRAFTS", count: counts.staleDrafts, severity: "info" },
  ];
  return alerts
    .filter((alert) => alert.count > 0)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Counts per property type → counts per category, every category present. */
export function countByCategory(
  rows: Array<{ propertyType: string; count: number }>,
): Record<PropertyCategory, number> {
  const out = Object.fromEntries(PROPERTY_CATEGORIES.map((c) => [c, 0])) as Record<PropertyCategory, number>;
  for (const row of rows) out[categoryOf(row.propertyType)] += row.count;
  return out;
}

/**
 * Lead sources for a bar chart: largest first, at most `limit` bars, the
 * remainder folded into OTHER so the chart never needs more than one hue.
 */
export function topSources(
  rows: Array<{ source: string; count: number }>,
  limit = 6,
): Array<{ source: string; count: number }> {
  // Copies, so the caller's rows are never mutated.
  const sorted = rows
    .filter((r) => r.count > 0)
    .map((r) => ({ ...r }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  if (sorted.length <= limit) return sorted;

  const head = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1).reduce((sum, r) => sum + r.count, 0);
  const other = head.find((r) => r.source === "OTHER");
  if (!other) return [...head, { source: "OTHER", count: rest }];
  other.count += rest;
  return head.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/** Per-stage counts in the given order; stages without leads report 0. */
export function orderedCounts<K extends string>(
  order: readonly K[],
  rows: Array<{ key: string; count: number }>,
): Array<{ key: K; count: number }> {
  const map = new Map(rows.map((r) => [r.key, r.count]));
  return order.map((key) => ({ key, count: map.get(key) ?? 0 }));
}

export type AgentRow = {
  id: string;
  name: string;
  activeProperties: number;
  leads: number;
  viewings: number;
  offers: number;
  closings: number;
};

/** Joins per-agent counts; agents with no activity at all are left out. */
export function buildAgentRows(
  agents: Array<{ id: string; firstName: string; lastName: string }>,
  counts: {
    activeProperties: Map<string, number>;
    leads: Map<string, number>;
    viewings: Map<string, number>;
    offers: Map<string, number>;
    closings: Map<string, number>;
  },
): AgentRow[] {
  return agents
    .map((agent) => ({
      id: agent.id,
      name: `${agent.firstName} ${agent.lastName}`.trim(),
      activeProperties: counts.activeProperties.get(agent.id) ?? 0,
      leads: counts.leads.get(agent.id) ?? 0,
      viewings: counts.viewings.get(agent.id) ?? 0,
      offers: counts.offers.get(agent.id) ?? 0,
      closings: counts.closings.get(agent.id) ?? 0,
    }))
    .filter((row) => row.activeProperties + row.leads + row.viewings + row.offers + row.closings > 0)
    .sort((a, b) => b.closings - a.closings || b.leads - a.leads || a.name.localeCompare(b.name));
}

/** Map from a Prisma groupBy result keyed by a nullable id. */
export function countMap(
  rows: Array<{ key: string | null; count: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) if (row.key) map.set(row.key, (map.get(row.key) ?? 0) + row.count);
  return map;
}
