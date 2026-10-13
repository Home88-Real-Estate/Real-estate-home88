/**
 * Portal directory for the "Πύλες & Διανομή" workspace.
 *
 *   GET /distribution/portals   every known destination with an honest status
 *
 * Read-only. Status comes from the existing portal framework (adapter present,
 * account configured, last successful sync), never from the directory alone, and
 * no credential or feed token is part of the response.
 */

import { DISTRIBUTION_STATUSES, countByFit, recommendFor, sortRecommendations, type FrameworkVerdict, PORTAL_DIRECTORY, countByStatus, distributionStatus, filterDirectory, type DirectoryRow } from "@home88/domain";
import { getAdapter } from "@home88/portals";
import { propertySearchSchema } from "@home88/validation";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { badRequest } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import {
  BATCH_OPERATIONS,
  MAX_BATCH_PROPERTIES,
  assertMayBulk,
  cancelBatch,
  createBatch,
  getBatch,
  listBatches,
  planBatch,
  processBatch,
  retryFailed,
  type BatchOperation,
  type PortalSelection,
} from "../lib/distribution-batches";
import { resolvePortalProvider } from "../lib/portal-accounts";
import { loadPerformance, loadQueues, missingWhere } from "../lib/distribution-insights";
import { loadPortalChannels } from "../lib/publications";
import { notFound } from "../lib/errors";
import { db } from "../lib/prisma";
import { requireRole } from "../plugins/auth";
import { buildPropertyWhere } from "./properties";
import { portalView } from "./settings";

const portalSchema = z.object({ code: z.string().trim().min(1).max(40), accountId: z.string().trim().min(1).max(40), environment: z.enum(["TEST", "PRODUCTION"]) }).strict();

const selectionSchema = z
  .object({
    /** Explicit properties (this page, or individual rows). */
    ids: z.array(z.string().trim().min(1).max(40)).max(MAX_BATCH_PROPERTIES).optional(),
    /** Or "everything matching these filters", resolved on the server with the list's own filter. */
    filter: z.record(z.string(), z.string().max(200)).optional(),
    /** Rows the person unticked after choosing "all matching". */
    exclude: z.array(z.string().trim().min(1).max(40)).max(2000).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.ids) !== Boolean(v.filter), { message: "Δώστε είτε ids είτε filter." });

const planSchema = z
  .object({
    operation: z.enum(BATCH_OPERATIONS),
    selection: selectionSchema,
    portals: z.array(portalSchema).min(1).max(20),
    idempotencyKey: z.string().trim().min(8).max(80).optional(),
    /** Withdraw only: acknowledges a removal the size guard held back. */
    confirmMassRemoval: z.boolean().optional(),
  })
  .strict();

const PORTAL_STATES = ["NONE", "PUBLISHED", "ISSUES"] as const;

/** Resolves a selection to property ids on the server. Never loads more than the batch limit. */
async function resolveSelection(selection: z.infer<typeof selectionSchema>, userId: string): Promise<{ ids: string[]; matched: number }> {
  if (selection.ids) return { ids: selection.ids, matched: selection.ids.length };
  const q = parseInput(propertySearchSchema, selection.filter ?? {});
  const where = buildPropertyWhere(q, userId);
  const exclude = new Set(selection.exclude ?? []);
  const matched = await db().property.count({ where });
  if (matched - exclude.size > MAX_BATCH_PROPERTIES) {
    throw badRequest(`Η επιλογή περιέχει ${matched} ακίνητα. Μία μαζική ενέργεια δέχεται έως ${MAX_BATCH_PROPERTIES}· περιορίστε με φίλτρα.`);
  }
  const rows = await db().property.findMany({ where, select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: MAX_BATCH_PROPERTIES + exclude.size });
  return { ids: rows.map((r) => r.id).filter((id) => !exclude.has(id)), matched };
}

/** The directory with live status from the portal framework (adapter, account, last sync). */
async function loadDirectoryRows(): Promise<DirectoryRow[]> {
  const rows: DirectoryRow[] = [];
  for (const entry of PORTAL_DIRECTORY) {
    let live: DirectoryRow["live"] = null;
    let status = distributionStatus(entry, null);
    if (entry.catalogCode) {
      const view = await portalView(entry.catalogCode, false);
      status = distributionStatus(entry, { hasAdapter: Boolean(getAdapter(entry.catalogCode)), status: view.integrationStatus });
      live = { lastSuccessAt: view.lastSuccessAt, lastError: view.lastError, enabled: view.enabled };
    }
    rows.push({ ...entry, status, live });
  }
  return rows;
}

export async function distributionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/distribution/portals", { preHandler: requireRole("AGENT") }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const rows = await loadDirectoryRows();
    const filtered = filterDirectory(rows, {
      q: query.q,
      country: query.country,
      market: query.market,
      method: query.method,
      status: query.status && (DISTRIBUTION_STATUSES as readonly string[]).includes(query.status) ? query.status : undefined,
      priority: query.priority,
      group: query.group,
    });
    return { data: filtered, total: rows.length, counts: countByStatus(rows) };
  });

  // --- The workspace table --------------------------------------------------------------------------------------------------

  app.get("/distribution/properties", { preHandler: requireRole("AGENT") }, async (request) => {
    const raw = request.query as Record<string, string | undefined>;
    const q = parseInput(propertySearchSchema, raw);
    const portalState = (PORTAL_STATES as readonly string[]).includes(raw.portalState ?? "") ? (raw.portalState as (typeof PORTAL_STATES)[number]) : undefined;
    const where = buildPropertyWhere(q, request.auth!.user.id);
    const and: Prisma.PropertyWhereInput[] = Array.isArray(where.AND) ? [...where.AND] : where.AND ? [where.AND] : [];
    // Only real, reproducible filters: derived from portal listings that exist.
    if (portalState === "NONE") and.push({ portalListings: { none: { state: { in: ["PUBLISHED", "OUTDATED", "IN_FEED"] } } } });
    if (portalState === "PUBLISHED") and.push({ portalListings: { some: { state: { in: ["PUBLISHED", "OUTDATED", "IN_FEED"] } } } });
    if (portalState === "ISSUES") and.push({ portalListings: { some: { OR: [{ state: "FAILED" }, { needsReview: true }] } } });
    const missing = missingWhere(raw.missing ?? "");
    if (missing) and.push(missing);
    if (and.length > 0) where.AND = and;

    const [total, rows] = await db().$transaction([
      db().property.count({ where }),
      db().property.findMany({
        where,
        select: {
          id: true, reference: true, titleEl: true, listingType: true, propertyType: true, status: true, price: true, priceOnRequest: true, city: true, areaName: true, updatedAt: true,
          agent: { select: { firstName: true, lastName: true } },
          websitePublication: { select: { status: true, enabled: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);
    const listings = await db().portalListing.groupBy({ by: ["propertyId", "state"], where: { propertyId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    const summary = new Map<string, { published: number; issues: number }>();
    for (const l of listings) {
      const cur = summary.get(l.propertyId) ?? { published: 0, issues: 0 };
      if (["PUBLISHED", "OUTDATED", "IN_FEED"].includes(l.state)) cur.published += l._count._all;
      if (l.state === "FAILED") cur.issues += l._count._all;
      summary.set(l.propertyId, cur);
    }
    return {
      data: rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        title: r.titleEl,
        listingType: r.listingType,
        propertyType: r.propertyType,
        status: r.status,
        price: r.price == null ? null : Number(r.price),
        priceOnRequest: r.priceOnRequest,
        city: r.city,
        areaName: r.areaName,
        agent: r.agent ? `${r.agent.firstName} ${r.agent.lastName}` : null,
        website: r.websitePublication ? { status: r.websitePublication.status, enabled: r.websitePublication.enabled } : null,
        portals: summary.get(r.id) ?? { published: 0, issues: 0 },
      })),
      total,
      page: q.page,
      limit: q.limit,
      maxBatch: MAX_BATCH_PROPERTIES,
    };
  });

  // --- Bulk operations ------------------------------------------------------------------------------------------------------

  app.post("/distribution/plan", { preHandler: requireRole("AGENT") }, async (request) => {
    const body = parseInput(planSchema, request.body);
    const user = request.auth!.user;
    const viewer = { id: user.id, role: user.role };
    await assertMayBulk(viewer, body.operation);
    const { ids, matched } = await resolveSelection(body.selection, user.id);
    const plan = await planBatch({ operation: body.operation, propertyIds: ids, portals: body.portals as PortalSelection[], viewer, confirmMassRemoval: body.confirmMassRemoval });
    return { ...plan, matched, items: plan.items.filter((i) => !i.ready).slice(0, 100), readyPreview: plan.items.filter((i) => i.ready).slice(0, 20) };
  });

  app.post("/distribution/batches", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    const body = parseInput(planSchema, request.body);
    const user = request.auth!.user;
    const viewer = { id: user.id, role: user.role };
    await assertMayBulk(viewer, body.operation);
    const { ids } = await resolveSelection(body.selection, user.id);
    const plan = await planBatch({ operation: body.operation as BatchOperation, propertyIds: ids, portals: body.portals as PortalSelection[], viewer, confirmMassRemoval: body.confirmMassRemoval });
    const created = await createBatch({
      operation: body.operation,
      plan,
      portals: body.portals as PortalSelection[],
      idempotencyKey: body.idempotencyKey,
      selection: { by: body.selection.ids ? "ids" : "filter", filter: body.selection.filter ?? null, properties: ids.length, portals: body.portals.map((p) => p.code.toUpperCase()) },
      viewer,
      ctx: { actorId: user.id, requestId: request.id, ipAddress: clientIp(request), userAgent: userAgent(request) },
    });
    reply.code(created.reused ? 200 : 201);
    return { ...created, summary: plan.summary };
  });

  app.get("/distribution/batches", { preHandler: requireRole("AGENT") }, async (request) => {
    const user = request.auth!.user;
    return { data: await listBatches({ id: user.id, role: user.role }) };
  });

  app.get("/distribution/batches/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const { id } = request.params as { id: string };
    const q = request.query as { status?: string; page?: string };
    const user = request.auth!.user;
    return getBatch(id, { id: user.id, role: user.role }, { status: q.status, page: q.page ? Number(q.page) : undefined });
  });

  for (const [name, fn] of [["process", processBatch], ["cancel", cancelBatch], ["retry", retryFailed]] as const) {
    app.post(`/distribution/batches/:id/${name}`, { preHandler: requireRole("AGENT") }, async (request) => {
      const { id } = request.params as { id: string };
      const user = request.auth!.user;
      return fn(id, { id: user.id, role: user.role }, { actorId: user.id, requestId: request.id, ipAddress: clientIp(request), userAgent: userAgent(request) });
    });
  }

  /** Destinations the workspace may offer: a real adapter and at least one account with a provider. */
  app.get("/distribution/destinations", { preHandler: requireRole("AGENT") }, async () => {
    const portals = await db().portal.findMany({ orderBy: { name: "asc" }, include: { accounts: { orderBy: [{ environment: "asc" }, { accountName: "asc" }] } } });
    const data = portals
      .filter((p) => Boolean(getAdapter(p.code)))
      .map((p) => ({
        code: p.code,
        name: p.name,
        accounts: p.accounts
          .map((a) => {
            const provider = resolvePortalProvider(p, a);
            return { id: a.id, accountName: a.accountName, environment: a.environment, enabled: a.enabled, providerKind: provider ? (provider.mock ? "mock" : "real") : "none" };
          })
          .filter((a) => a.providerKind !== "none"),
      }))
      .filter((p) => p.accounts.length > 0);
    return { data };
  });

  /**
   * Where this property fits, by rules over verified facts only. Suitability is
   * not performance: no portal results are held yet, and that is stated per row.
   */
  app.get("/properties/:id/recommendations", { preHandler: requireRole("AGENT") }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.auth!.user;
    const property = await db().property.findUnique({
      where: { id },
      select: { id: true, reference: true, listingType: true, titleEl: true, titleEn: true, descriptionEl: true, descriptionEn: true, price: true, priceOnRequest: true, area: true },
    });
    if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");
    const photoCount = await db().propertyMedia.count({ where: { propertyId: id, kind: "PHOTO", status: { in: ["approved", "published"] } } });
    const text = (v: string | null) => Boolean(v && v.trim().length > 0);
    const facts = {
      listingType: property.listingType,
      hasGreekTitle: text(property.titleEl),
      hasGreekDescription: text(property.descriptionEl),
      hasEnglishTitle: text(property.titleEn),
      hasEnglishDescription: text(property.descriptionEn),
      hasPrice: property.price != null || property.priceOnRequest,
      hasArea: property.area != null,
      photoCount,
    };
    const [rows, channels] = await Promise.all([loadDirectoryRows(), loadPortalChannels(id, { id: user.id, role: user.role })]);
    const verdictOf = (code?: string): FrameworkVerdict | null => {
      const ch = code ? channels?.channels.find((c) => c.code === code) : undefined;
      return ch ? { readiness: ch.readiness, blockers: ch.blockers } : null;
    };
    const recs = sortRecommendations(rows.map((r) => recommendFor(r, r.status, facts, verdictOf(r.catalogCode))));
    return { property: { id: property.id, reference: property.reference }, data: recs, counts: countByFit(recs), basis: "RULES", performance: "UNAVAILABLE" };
  });

  /** Actionable queues and measured performance by destination. */
  app.get("/distribution/insights", { preHandler: requireRole("AGENT") }, async (request) => {
    const raw = Number((request.query as { days?: string }).days);
    const days = [30, 90, 180, 365].includes(raw) ? raw : 90;
    const [queues, performance] = await Promise.all([loadQueues(), loadPerformance(days)]);
    return { queues, performance };
  });
}
