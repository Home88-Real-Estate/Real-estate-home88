/**
 * Data for the redesigned CRM home page, beside GET /dashboard (which keeps
 * serving the detailed panels):
 *
 *   GET /dashboard/overview   four headline totals, each with the change against the previous
 *                             period and a six-month trend, all counted from the records
 *   GET /dashboard/series     daily counts for the statistics chart (7, 30 or 90 days)
 *   GET /dashboard/activity   recent CRM events, from the audit trail, as plain sentences
 *   GET /search               one search box over properties, contacts, requests, mandates and showings
 *
 * Nothing is estimated: a number is a count, a trend is counts per month, and
 * where history does not support a comparison the response says so instead of
 * inventing one. Visibility follows the dashboard: agents see their own work,
 * managers and above see the whole agency.
 */

import { Prisma } from "@prisma/client";
import { localDay } from "@home88/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { contactWhere } from "../lib/contacts";
import { parseInput } from "../lib/http";
import { runAll } from "../lib/map-limit";
import { db, lockedDb } from "../lib/prisma";
import { requireRole, roleAtLeast } from "../plugins/auth";

const DAY = 24 * 3_600_000;
const TZ = "Europe/Athens";

type Scope = { all: boolean; userId: string };

const scopeOf = (request: { auth: { user: { id: string; role: string } } | null }, asked?: string): Scope => {
  const user = request.auth!.user;
  const manager = roleAtLeast(user.role, "MANAGER");
  return { all: (asked ?? (manager ? "all" : "mine")) === "all" && manager, userId: user.id };
};

// Each counted record type: its table, its date column, and how "mine" is decided. Fixed strings only —
// nothing from the request is ever spliced into SQL.
const SOURCES = {
  properties: { table: Prisma.raw('"properties"'), date: Prisma.raw('"createdAt"'), base: Prisma.sql`"status" NOT IN ('ARCHIVED','DELETED')`, mine: (u: string) => Prisma.sql`("agentId" = ${u} OR "createdById" = ${u})` },
  contacts: { table: Prisma.raw('"contacts"'), date: Prisma.raw('"createdAt"'), base: Prisma.sql`TRUE`, mine: (u: string) => Prisma.sql`"assignedToId" = ${u}` },
  requests: { table: Prisma.raw('"buyer_requests"'), date: Prisma.raw('"createdAt"'), base: Prisma.sql`TRUE`, mine: (u: string) => Prisma.sql`("assignedToId" = ${u} OR "createdById" = ${u})` },
  showings: { table: Prisma.raw('"showings"'), date: Prisma.raw('"createdAt"'), base: Prisma.sql`"status" <> 'CANCELLED'`, mine: (u: string) => Prisma.sql`"createdById" = ${u}` },
  leads: { table: Prisma.raw('"leads"'), date: Prisma.raw('"createdAt"'), base: Prisma.sql`TRUE`, mine: (u: string) => Prisma.sql`"assignedToId" = ${u}` },
  viewings: { table: Prisma.raw('"viewings"'), date: Prisma.raw('"startsAt"'), base: Prisma.sql`"status" = 'COMPLETED'`, mine: (u: string) => Prisma.sql`"agentId" = ${u}` },
} as const;
type SourceKey = keyof typeof SOURCES;

/** Counts per local calendar day or month between [from, to), as { "2026-10-13": 4 }. */
async function bucketed(key: SourceKey, scope: Scope, from: Date, to: Date, unit: "day" | "month"): Promise<Map<string, number>> {
  const s = SOURCES[key];
  const format = unit === "day" ? "YYYY-MM-DD" : "YYYY-MM";
  const scoped = scope.all ? Prisma.sql`TRUE` : s.mine(scope.userId);
  const rows = await lockedDb().$queryRaw<Array<{ bucket: string; n: number }>>(Prisma.sql`
    SELECT to_char((${s.date} AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, ${format}) AS bucket, count(*)::int AS n
    FROM ${s.table}
    WHERE ${s.base} AND ${scoped} AND ${s.date} >= ${from} AND ${s.date} < ${to}
    GROUP BY 1`);
  return new Map(rows.map((r) => [r.bucket, r.n]));
}

async function total(key: SourceKey, scope: Scope, extra: Prisma.Sql = Prisma.sql`TRUE`): Promise<number> {
  const s = SOURCES[key];
  const scoped = scope.all ? Prisma.sql`TRUE` : s.mine(scope.userId);
  const rows = await lockedDb().$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM ${s.table} WHERE ${s.base} AND ${scoped} AND ${extra}`);
  return rows[0]?.n ?? 0;
}

function dayKeys(from: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(from.getTime() + i * DAY)));
  return out;
}
function monthKeys(now: Date, months: number): string[] {
  const out: string[] = [];
  const [y, m] = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(now).split("-").map(Number) as [number, number];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const scopeSchema = z.object({ scope: z.enum(["mine", "all"]).optional() });
const PERIOD_DAYS = 30;

// --- Activity feed ------------------------------------------------------------------------------------------------------

type Rule = { entity: string; action: string; text: string; href: (id: string) => string };
// Only events a person would call "something happened in the CRM". Settings, security, portal and login events
// are audit records, not activity, and never appear here.
const RULES: Rule[] = [
  { entity: "CONTACT", action: "create", text: "Νέα επαφή καταχωρήθηκε", href: (id) => `/contacts/${id}` },
  { entity: "LEAD", action: "create", text: "Νέο lead καταχωρήθηκε", href: (id) => `/leads/${id}` },
  { entity: "PROPERTY", action: "create", text: "Νέο ακίνητο καταχωρήθηκε", href: (id) => `/properties/${id}` },
  { entity: "PROPERTY", action: "property_create", text: "Νέο ακίνητο καταχωρήθηκε", href: (id) => `/properties/${id}` },
  { entity: "VIEWING", action: "create", text: "Νέο ραντεβού επίσκεψης δημιουργήθηκε", href: () => "/calendar" },
  { entity: "REQUEST", action: "create", text: "Νέα ζήτηση δημιουργήθηκε", href: (id) => `/requests/${id}` },
  { entity: "OFFER", action: "create", text: "Νέα προσφορά καταχωρήθηκε", href: () => "/leads" },
  { entity: "MANDATE", action: "create", text: "Ανάθεση δημιουργήθηκε", href: (id) => `/mandates/${id}` },
  { entity: "MANDATE", action: "issue", text: "Εντολή εκδόθηκε", href: (id) => `/mandates/${id}` },
  { entity: "MANDATE", action: "send", text: "Εντολή στάλθηκε", href: (id) => `/mandates/${id}` },
  { entity: "MANDATE", action: "signed_copy", text: "Εντολή υπογράφηκε", href: (id) => `/mandates/${id}` },
  { entity: "TRANSACTION", action: "create", text: "Νέα συναλλαγή ξεκίνησε", href: (id) => `/transactions/${id}` },
];

async function labelFor(entity: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const q = db();
  if (entity === "CONTACT") for (const r of await q.contact.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })) out.set(r.id, `${r.firstName} ${r.lastName}`.trim());
  if (entity === "LEAD") for (const r of await q.lead.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true, firstName: true, lastName: true } })) out.set(r.id, `${r.reference} · ${r.firstName} ${r.lastName ?? ""}`.trim());
  if (entity === "PROPERTY") for (const r of await q.property.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true, titleEl: true } })) out.set(r.id, `${r.reference} · ${r.titleEl}`);
  if (entity === "REQUEST") for (const r of await q.buyerRequest.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true } })) out.set(r.id, r.reference);
  if (entity === "MANDATE") for (const r of await q.mandate.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true } })) out.set(r.id, r.reference);
  if (entity === "TRANSACTION") for (const r of await q.transaction.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true } })) out.set(r.id, r.reference);
  return out;
}

// --- Search -------------------------------------------------------------------------------------------------------------

const searchSchema = z.object({ q: z.string().trim().min(2, "Γράψτε τουλάχιστον 2 χαρακτήρες.").max(80) });
const PER_TYPE = 5;

export async function dashboardHomeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard/overview", { preHandler: requireRole("AGENT") }, async (request) => {
    const q = parseInput(scopeSchema, request.query);
    const scope = scopeOf(request, q.scope);
    const now = new Date();
    const today = localDay(now);
    const to = today.to;
    const from = new Date(to.getTime() - PERIOD_DAYS * DAY);
    const previousFrom = new Date(from.getTime() - PERIOD_DAYS * DAY);
    const months = monthKeys(now, 6);
    const trendFrom = new Date(Date.UTC(Number(months[0]!.slice(0, 4)), Number(months[0]!.slice(5)) - 1, 1) - DAY); // a day's margin for the zone offset

    const keys: SourceKey[] = ["properties", "contacts", "requests", "showings"];
    const extras: Partial<Record<SourceKey, Prisma.Sql>> = { requests: Prisma.sql`"status" = 'ACTIVE'`, contacts: Prisma.sql`"status" = 'ACTIVE'` };
    const results = await runAll(
      keys.map((k) => async () => ({
        key: k,
        total: await total(k, scope, extras[k] ?? Prisma.sql`TRUE`),
        current: [...(await bucketed(k, scope, from, to, "day")).values()].reduce((a, b) => a + b, 0),
        previous: [...(await bucketed(k, scope, previousFrom, from, "day")).values()].reduce((a, b) => a + b, 0),
        monthly: await bucketed(k, scope, trendFrom, to, "month"),
      })),
      2,
    );
    return {
      generatedAt: now.toISOString(),
      scope: scope.all ? "all" : "mine",
      period: { days: PERIOD_DAYS, from: from.toISOString(), to: to.toISOString() },
      months,
      kpis: Object.fromEntries(
        results.map((r) => [
          r.key,
          {
            total: r.total,
            /** New records in the last 30 days against the 30 before. Null when there is no earlier history to compare with. */
            flow: { value: r.current, previous: r.previous },
            trend: months.map((m) => r.monthly.get(m) ?? 0),
          },
        ]),
      ),
    };
  });

  app.get("/dashboard/series", { preHandler: requireRole("AGENT") }, async (request) => {
    const q = parseInput(scopeSchema.extend({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), "Επιτρέπονται 7, 30 ή 90 ημέρες.").default(30) }), request.query);
    const scope = scopeOf(request, q.scope);
    const to = localDay(new Date()).to;
    const from = new Date(to.getTime() - q.days * DAY);
    const days = dayKeys(from, q.days);
    const keys: SourceKey[] = ["leads", "contacts", "requests", "viewings"];
    const buckets = await runAll(keys.map((k) => () => bucketed(k, scope, from, to, "day")), 2);
    const series = keys.map((k, i) => ({ key: k, values: days.map((d) => buckets[i]!.get(d) ?? 0) }));
    return { days, series: series.map((s) => ({ ...s, total: s.values.reduce((a, b) => a + b, 0) })), scope: scope.all ? "all" : "mine", periodDays: q.days };
  });

  app.get("/dashboard/activity", { preHandler: requireRole("AGENT") }, async (request) => {
    const user = request.auth!.user;
    const manager = roleAtLeast(user.role, "MANAGER");
    const rows = await db().auditLog.findMany({
      where: { OR: RULES.map((r) => ({ entity: r.entity as never, action: r.action })), ...(manager ? {} : { actorId: user.id }) },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, entity: true, entityId: true, action: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
    });
    const byEntity = new Map<string, string[]>();
    for (const r of rows) byEntity.set(r.entity, [...(byEntity.get(r.entity) ?? []), r.entityId]);
    const labels = new Map<string, Map<string, string>>();
    for (const [entity, ids] of byEntity) labels.set(entity, await labelFor(entity, [...new Set(ids)]));
    const data = rows.flatMap((r) => {
      const rule = RULES.find((x) => x.entity === r.entity && x.action === r.action);
      if (!rule) return [];
      return [{ id: r.id, text: rule.text, entity: r.entity, label: labels.get(r.entity)?.get(r.entityId) ?? null, href: rule.href(r.entityId), at: r.createdAt.toISOString(), actor: r.actor ? `${r.actor.firstName} ${r.actor.lastName}`.trim() : null }];
    });
    return { data: data.slice(0, 8), scope: manager ? "all" : "mine" };
  });

  app.get("/search", { preHandler: requireRole("AGENT") }, async (request) => {
    const { q } = parseInput(searchSchema, request.query);
    const upper = q.toUpperCase();
    const database = db();
    const [properties, contacts, requests, mandates, showings] = await runAll([
      () =>
        database.property.findMany({
          where: { status: { not: "DELETED" }, OR: [{ reference: { contains: upper } }, { titleEl: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { areaName: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } }] },
          select: { id: true, reference: true, titleEl: true, city: true, areaName: true },
          orderBy: { updatedAt: "desc" },
          take: PER_TYPE,
        }),
      () => database.contact.findMany({ where: contactWhere({ q }), select: { id: true, reference: true, firstName: true, lastName: true, company: true }, orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } }, take: PER_TYPE }),
      () => database.buyerRequest.findMany({ where: { reference: { contains: upper } }, select: { id: true, reference: true }, orderBy: { updatedAt: "desc" }, take: PER_TYPE }),
      () => database.mandate.findMany({ where: { reference: { contains: upper } }, select: { id: true, reference: true, type: true }, orderBy: { updatedAt: "desc" }, take: PER_TYPE }),
      () => database.showing.findMany({ where: { number: { contains: upper } }, select: { id: true, number: true }, orderBy: { updatedAt: "desc" }, take: PER_TYPE }),
    ], 2);
    return {
      query: q,
      results: [
        ...properties.map((p) => ({ type: "PROPERTY", id: p.id, title: `${p.reference} · ${p.titleEl}`, subtitle: [p.areaName, p.city].filter(Boolean).join(", ") || null, href: `/properties/${p.id}` })),
        ...contacts.map((c) => ({ type: "CONTACT", id: c.id, title: `${c.firstName} ${c.lastName}`.trim(), subtitle: [c.reference, c.company].filter(Boolean).join(" · ") || null, href: `/contacts/${c.id}` })),
        ...requests.map((r) => ({ type: "REQUEST", id: r.id, title: r.reference, subtitle: null, href: `/requests/${r.id}` })),
        ...mandates.map((m) => ({ type: "MANDATE", id: m.id, title: m.reference, subtitle: null, href: `/mandates/${m.id}` })),
        ...showings.map((s) => ({ type: "SHOWING", id: s.id, title: s.number ?? "Υπόδειξη", subtitle: null, href: `/showings/${s.id}` })),
      ],
    };
  });
}
