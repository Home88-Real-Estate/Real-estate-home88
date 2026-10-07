/**
 * Dashboard data for the CRM home page, in one request.
 *
 * Every number is counted from the database for the requested period and
 * scope; nothing is cached or estimated. Scope "mine" restricts to the
 * signed-in user's properties (assigned or created), leads, viewings and
 * offers; "all" covers the whole agency. Agents default to "mine", managers
 * and above to "all". Queries use Prisma's typed API (no raw SQL) and the
 * indexes in migration 20261003030000_dashboard_indexes.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LeadSource, Prisma } from "@home88/database";
import {
  CHANNEL_LEAD_SOURCES,
  LEAD_LOST_STAGES,
  LEAD_OPEN_STAGES,
  LEAD_PIPELINE_STAGES,
  lastMonths,
  localDay,
  PUBLIC_PROPERTY_STATUSES,
  resolveRange,
  type DateRange,
} from "@home88/domain";
import {
  buildAgentRows,
  buildAlerts,
  countByCategory,
  countMap,
  orderedCounts,
  topSources,
} from "../lib/dashboard";
import { parseInput } from "../lib/http";
import { db } from "../lib/prisma";
import { mediaUrlFor } from "../lib/storage";
import { requireRole, roleAtLeast } from "../plugins/auth";

const querySchema = z.object({
  range: z.string().max(20).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  scope: z.enum(["mine", "all"]).optional(),
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PUBLIC = [...PUBLIC_PROPERTY_STATUSES];
const OPEN_TASK = { in: ["OPEN", "IN_PROGRESS"] as Array<"OPEN" | "IN_PROGRESS"> };
const WEBSITE_SOURCES = [...CHANNEL_LEAD_SOURCES.WEBSITE] as LeadSource[];
const PORTAL_SOURCES = [...CHANNEL_LEAD_SOURCES.PORTAL] as LeadSource[];

type Scope = { all: boolean; userId: string };

function propertyScope(scope: Scope): Prisma.PropertyWhereInput {
  return scope.all ? {} : { OR: [{ agentId: scope.userId }, { createdById: scope.userId }] };
}
function leadScope(scope: Scope): Prisma.LeadWhereInput {
  return scope.all ? {} : { assignedToId: scope.userId };
}
function viewingScope(scope: Scope): Prisma.ViewingWhereInput {
  return scope.all ? {} : { agentId: scope.userId };
}
function offerScope(scope: Scope): Prisma.OfferWhereInput {
  return scope.all ? {} : { agentId: scope.userId };
}
function between(from: Date, to: Date) {
  return { gte: from, lt: to };
}

/** The flow metrics, counted for one window [from, to). */
async function periodCounts(scope: Scope, from: Date, to: Date) {
  const created = between(from, to);
  const [newProperties, leads, websiteLeads, portalLeads, viewings, offers, sales, rentals] =
    await Promise.all([
      db().property.count({ where: { ...propertyScope(scope), createdAt: created } }),
      db().lead.count({ where: { ...leadScope(scope), createdAt: created } }),
      db().lead.count({
        where: { ...leadScope(scope), createdAt: created, source: { in: WEBSITE_SOURCES } },
      }),
      db().lead.count({
        where: { ...leadScope(scope), createdAt: created, source: { in: PORTAL_SOURCES } },
      }),
      db().viewing.count({ where: { ...viewingScope(scope), status: "COMPLETED", startsAt: created } }),
      db().offer.count({ where: { ...offerScope(scope), createdAt: created } }),
      db().propertyStatusHistory.count({
        where: { toStatus: "SOLD", createdAt: created, property: propertyScope(scope) },
      }),
      db().propertyStatusHistory.count({
        where: { toStatus: "RENTED", createdAt: created, property: propertyScope(scope) },
      }),
    ]);
  return { newProperties, leads, websiteLeads, portalLeads, viewings, offers, sales, rentals };
}

type PeriodCounts = Awaited<ReturnType<typeof periodCounts>>;

function withPrevious(current: PeriodCounts, previous: PeriodCounts) {
  const out = {} as Record<keyof PeriodCounts, { value: number; previous: number }>;
  for (const key of Object.keys(current) as Array<keyof PeriodCounts>) {
    out[key] = { value: current[key], previous: previous[key] };
  }
  return out;
}

async function monthlySeries(scope: Scope, now: Date) {
  const months = lastMonths(now, 12);
  const series = await Promise.all(
    months.map(async (month) => {
      const window = between(month.from, month.to);
      const [newProperties, leads, viewings, closings] = await Promise.all([
        db().property.count({ where: { ...propertyScope(scope), createdAt: window } }),
        db().lead.count({ where: { ...leadScope(scope), createdAt: window } }),
        db().viewing.count({ where: { ...viewingScope(scope), status: "COMPLETED", startsAt: window } }),
        db().propertyStatusHistory.count({
          where: { toStatus: { in: ["SOLD", "RENTED"] }, createdAt: window, property: propertyScope(scope) },
        }),
      ]);
      return { month: month.key, newProperties, leads, viewings, closings };
    }),
  );
  return series;
}

async function agentPerformance(range: DateRange) {
  const created = between(range.from, range.to);
  const [agents, active, leads, viewings, offers, closings] = await Promise.all([
    db().user.findMany({
      where: { status: "ACTIVE", role: { in: ["AGENT", "MANAGER", "ADMIN", "SUPER_ADMIN"] } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    db().property.groupBy({ by: ["agentId"], where: { status: { in: PUBLIC } }, _count: { _all: true } }),
    db().lead.groupBy({ by: ["assignedToId"], where: { createdAt: created }, _count: { _all: true } }),
    db().viewing.groupBy({
      by: ["agentId"],
      where: { status: "COMPLETED", startsAt: created },
      _count: { _all: true },
    }),
    db().offer.groupBy({ by: ["agentId"], where: { createdAt: created }, _count: { _all: true } }),
    // A closing is credited to the property's agent; groupBy cannot follow a
    // relation, so the (few) closing rows of the period are read and counted.
    db().propertyStatusHistory.findMany({
      where: { toStatus: { in: ["SOLD", "RENTED"] }, createdAt: created },
      select: { property: { select: { agentId: true } } },
    }),
  ]);

  return buildAgentRows(agents, {
    activeProperties: countMap(active.map((r) => ({ key: r.agentId, count: r._count._all }))),
    leads: countMap(leads.map((r) => ({ key: r.assignedToId, count: r._count._all }))),
    viewings: countMap(viewings.map((r) => ({ key: r.agentId, count: r._count._all }))),
    offers: countMap(offers.map((r) => ({ key: r.agentId, count: r._count._all }))),
    closings: countMap(closings.map((r) => ({ key: r.property.agentId, count: 1 }))),
  });
}

/** Thumbnail URL for a property's cover photo, if it has one. */
async function coverUrl(media: Array<{ storageKey: string; thumbnailKey: string | null; status: string }>) {
  const cover = media[0];
  if (!cover) return null;
  return mediaUrlFor(cover.thumbnailKey ?? cover.storageKey, cover.status);
}

const PROPERTY_CARD_SELECT = {
  id: true,
  reference: true,
  titleEl: true,
  status: true,
  listingType: true,
  propertyType: true,
  price: true,
  monthlyRent: true,
  area: true,
  city: true,
  areaName: true,
  createdAt: true,
  updatedAt: true,
  media: {
    where: { isPrimary: true, kind: "PHOTO" },
    take: 1,
    select: { storageKey: true, thumbnailKey: true, status: true },
  },
} satisfies Prisma.PropertySelect;

async function propertyCards(rows: Array<Prisma.PropertyGetPayload<{ select: typeof PROPERTY_CARD_SELECT }>>) {
  return Promise.all(
    rows.map(async ({ media, price, monthlyRent, area, ...row }) => ({
      ...row,
      price: price == null ? null : Number(price),
      monthlyRent: monthlyRent == null ? null : Number(monthlyRent),
      area: area == null ? null : Number(area),
      coverUrl: await coverUrl(media),
    })),
  );
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const q = parseInput(querySchema, request.query);
    const isManager = roleAtLeast(actor.role, "MANAGER");
    const scope: Scope = { all: (q.scope ?? (isManager ? "all" : "mine")) === "all", userId: actor.id };

    const now = new Date();
    const range = resolveRange({ key: q.range, from: q.from, to: q.to }, now);
    const today = localDay(now);
    const weekAhead = new Date(today.to.getTime() + 7 * DAY);
    const rangeWindow = between(range.from, range.to);
    const myOpenTasks: Prisma.TaskWhereInput = { assignedToId: actor.id, status: OPEN_TASK };

    const taskSelect = {
      id: true,
      title: true,
      dueAt: true,
      priority: true,
      lead: { select: { id: true, reference: true, firstName: true, lastName: true } },
      property: { select: { id: true, reference: true } },
    } satisfies Prisma.TaskSelect;

    const [
      total,
      active,
      drafts,
      onWebsite,
      byType,
      current,
      previous,
      upcomingViewings,
      monthly,
      sources,
      pipeline,
      agents,
      overdueTasks,
      todayTasks,
      upcomingTasks,
      overdueCount,
      todayCount,
      upcomingCount,
      todaysViewings,
      latestLeads,
      recentProperties,
      updatedProperties,
      latestOffers,
      uncontactedLeads,
      activeWithoutPhoto,
      offersPending,
      staleDrafts,
      portalFailed,
      mediaPending,
    ] = await Promise.all([
      db().property.count({ where: { ...propertyScope(scope), status: { notIn: ["ARCHIVED", "DELETED"] } } }),
      db().property.count({ where: { ...propertyScope(scope), status: { in: PUBLIC } } }),
      db().property.count({ where: { ...propertyScope(scope), status: "DRAFT" } }),
      db().property.count({
        where: { ...propertyScope(scope), status: { in: PUBLIC }, publishedOnWebsite: true },
      }),
      db().property.groupBy({
        by: ["propertyType"],
        where: { ...propertyScope(scope), status: { notIn: ["ARCHIVED", "DELETED"] } },
        _count: { _all: true },
      }),
      periodCounts(scope, range.from, range.to),
      periodCounts(scope, range.previousFrom, range.previousTo),
      db().viewing.count({ where: { ...viewingScope(scope), status: "SCHEDULED", startsAt: { gte: now } } }),
      monthlySeries(scope, now),
      db().lead.groupBy({
        by: ["source"],
        where: { ...leadScope(scope), createdAt: rangeWindow },
        _count: { _all: true },
      }),
      db().lead.groupBy({
        by: ["status"],
        where: { ...leadScope(scope), createdAt: rangeWindow },
        _count: { _all: true },
      }),
      isManager && scope.all ? agentPerformance(range) : Promise.resolve(null),
      db().task.findMany({
        where: { ...myOpenTasks, dueAt: { lt: now } },
        orderBy: { dueAt: "asc" },
        take: 5,
        select: taskSelect,
      }),
      db().task.findMany({
        where: { ...myOpenTasks, dueAt: { gte: now, lt: today.to } },
        orderBy: { dueAt: "asc" },
        take: 5,
        select: taskSelect,
      }),
      db().task.findMany({
        where: { ...myOpenTasks, dueAt: { gte: today.to, lt: weekAhead } },
        orderBy: { dueAt: "asc" },
        take: 5,
        select: taskSelect,
      }),
      db().task.count({ where: { ...myOpenTasks, dueAt: { lt: now } } }),
      db().task.count({ where: { ...myOpenTasks, dueAt: { gte: now, lt: today.to } } }),
      db().task.count({ where: { ...myOpenTasks, dueAt: { gte: today.to, lt: weekAhead } } }),
      db().viewing.findMany({
        where: { ...viewingScope(scope), startsAt: between(today.from, today.to), status: { not: "CANCELLED" } },
        orderBy: { startsAt: "asc" },
        take: 8,
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          status: true,
          clientName: true,
          property: { select: { id: true, reference: true, titleEl: true, areaName: true, city: true } },
          agent: { select: { firstName: true, lastName: true } },
        },
      }),
      db().lead.findMany({
        where: leadScope(scope),
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          reference: true,
          firstName: true,
          lastName: true,
          source: true,
          status: true,
          createdAt: true,
          property: { select: { id: true, reference: true } },
        },
      }),
      db().property.findMany({
        where: { ...propertyScope(scope), status: { notIn: ["ARCHIVED", "DELETED"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: PROPERTY_CARD_SELECT,
      }),
      db().property.findMany({
        where: { ...propertyScope(scope), status: { notIn: ["ARCHIVED", "DELETED"] } },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: PROPERTY_CARD_SELECT,
      }),
      db().offer.findMany({
        where: offerScope(scope),
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          reference: true,
          amount: true,
          status: true,
          createdAt: true,
          property: { select: { id: true, reference: true, titleEl: true } },
          lead: { select: { firstName: true, lastName: true } },
        },
      }),
      db().lead.count({
        where: { ...leadScope(scope), status: "NEW", createdAt: { lt: new Date(now.getTime() - DAY) } },
      }),
      db().property.count({
        where: {
          ...propertyScope(scope),
          status: { in: PUBLIC },
          media: { none: { kind: "PHOTO", status: { in: ["approved", "published"] } } },
        },
      }),
      db().offer.count({ where: { ...offerScope(scope), status: { in: ["SUBMITTED", "COUNTERED"] } } }),
      db().property.count({
        where: { ...propertyScope(scope), status: "DRAFT", updatedAt: { lt: new Date(now.getTime() - 14 * DAY) } },
      }),
      isManager ? db().portalListing.count({ where: { state: "FAILED" } }) : Promise.resolve(null),
      isManager ? db().propertyMedia.count({ where: { status: "pending_review" } }) : Promise.resolve(null),
    ]);

    return {
      generatedAt: now.toISOString(),
      scope: scope.all ? "all" : "mine",
      range: {
        key: range.key,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        previousFrom: range.previousFrom.toISOString(),
        previousTo: range.previousTo.toISOString(),
      },
      portfolio: {
        total,
        active,
        drafts,
        onWebsite,
        byCategory: countByCategory(byType.map((r) => ({ propertyType: r.propertyType, count: r._count._all }))),
      },
      period: withPrevious(current, previous),
      upcomingViewings,
      monthly,
      leadsBySource: topSources(sources.map((r) => ({ source: r.source, count: r._count._all }))),
      pipeline: {
        stages: orderedCounts(
          LEAD_PIPELINE_STAGES,
          pipeline.map((r) => ({ key: r.status, count: r._count._all })),
        ),
        lost: pipeline
          .filter((r) => (LEAD_LOST_STAGES as readonly string[]).includes(r.status))
          .reduce((sum, r) => sum + r._count._all, 0),
        open: pipeline
          .filter((r) => (LEAD_OPEN_STAGES as readonly string[]).includes(r.status))
          .reduce((sum, r) => sum + r._count._all, 0),
      },
      agents,
      reminders: {
        overdue: { count: overdueCount, items: overdueTasks },
        today: { count: todayCount, items: todayTasks },
        upcoming: { count: upcomingCount, items: upcomingTasks },
      },
      todaysViewings,
      latestLeads,
      recentProperties: await propertyCards(recentProperties),
      updatedProperties: await propertyCards(updatedProperties),
      latestOffers: latestOffers.map(({ amount, ...offer }) => ({ ...offer, amount: Number(amount) })),
      alerts: buildAlerts({
        overdueTasks: overdueCount,
        uncontactedLeads,
        activeWithoutPhoto,
        offersPending,
        staleDrafts,
        portalFailed,
        mediaPending,
      }),
    };
  });

  /** Small numbers for the sidebar, scoped like the dashboard's default. */
  app.get("/dashboard/counters", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const scope: Scope = { all: roleAtLeast(actor.role, "MANAGER"), userId: actor.id };
    const now = new Date();
    const today = localDay(now);
    const [properties, newLeads, dueTasks, newSubmissions] = await Promise.all([
      db().property.count({ where: { ...propertyScope(scope), status: { notIn: ["ARCHIVED", "DELETED"] } } }),
      db().lead.count({ where: { ...leadScope(scope), status: "NEW" } }),
      db().task.count({ where: { assignedToId: actor.id, status: OPEN_TASK, dueAt: { lt: today.to } } }),
      // Same visibility as the submissions list: everything for a manager, else mine or unassigned.
      db().propertySubmission.count({
        where: { status: "NEW", ...(scope.all ? {} : { OR: [{ assignedToId: actor.id }, { assignedToId: null }] }) },
      }),
    ]);
    return { properties, newLeads, dueTasks, newSubmissions };
  });
}
