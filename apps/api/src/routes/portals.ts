/**
 * Portal routes.
 *
 * Reading the portal catalogue and triggering a push are internal, agent-only
 * operations. The feed endpoints are public by design: a portal polls them
 * server-to-server, with no session. They are gated instead by an optional
 * `feedToken` stored on the portal so a guessed URL is not enough to scrape the
 * full book.
 */

import { PORTAL_CATALOG, SYSTEM_PROPERTY_TAGS } from "@home88/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  evaluateCandidate,
  FEATURE_FLAGS,
  FEATURE_LABELS,
  getAdapter,
  unmappedCodes,
  type AdapterPayload,
  type PortalAdapter,
} from "@home88/portals";
import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import { conflict, forbidden, HttpError, notFound } from "../lib/errors";
import { parseInput } from "../lib/http";
import { db } from "../lib/prisma";
import {
  FEED_SCHEMA_VERSION,
  gateFeed,
  loadCandidateContext,
  loadCandidates,
  loadTagCodes,
  previewPortal,
} from "../lib/portal-distribution";
import { mediaBase, toPortalProperty } from "../lib/portal-map";
import { buildContext, syncPropertyPortals } from "../lib/portal-sync";
import { resolvePortalProvider } from "../lib/portal-accounts";
import { settings } from "../settings";
import type { Portal } from "@home88/database";
import { requireRole } from "../plugins/auth";

const syncBodySchema = z
  .object({
    force: z.boolean().optional(),
    portalCode: z.string().min(1).optional(),
  })
  .strict()
  .default({});

function feedTokenOf(portal: Portal): string | null {
  const settings = (portal.settings ?? {}) as unknown as Record<string, unknown>;
  return typeof settings.feedToken === "string" && settings.feedToken.length > 0
    ? settings.feedToken
    : null;
}

/** A feed portal must have an adapter that can batch properties into one document. */
function feedAdapter(portal: Portal): PortalAdapter | null {
  const adapter = getAdapter(portal.code);
  return adapter && typeof adapter.compose === "function" ? adapter : null;
}

/**
 * Assembles a portal's feed from the properties that pass that portal's own
 * gate: market status, publication rule and flags, validation, mapping. This is
 * the same gate the dry run uses, so the preview shows what is served.
 */
async function buildFeed(portal: Portal, adapter: PortalAdapter) {
  const cfg = loadConfig();
  const context = buildContext(portal, cfg);
  const gate = await loadCandidateContext(portal);
  const candidates = await loadCandidates();

  const payloads: AdapterPayload[] = [];
  for (const candidate of candidates) {
    if (evaluateCandidate(candidate, gate).outcome !== "READY") continue;
    payloads.push(adapter.build(candidate.property, context));
  }

  return adapter.compose!(payloads);
}

async function portalByCode(code: string): Promise<Portal> {
  const portal = await db().portal.findUnique({ where: { code: code.toUpperCase() } });
  if (!portal) throw notFound("Το portal δεν βρέθηκε.");
  return portal;
}

const PROPERTY_TYPES = [
  "APARTMENT", "MAISONETTE", "HOUSE", "VILLA", "STUDIO", "OFFICE", "SHOP", "WAREHOUSE",
  "BUILDING", "HOTEL", "LAND", "PLOT", "PARKING", "INDUSTRIAL", "OTHER",
] as const;

const mappingsBodySchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            kind: z.enum(["TYPE", "FEATURE"]),
            internalCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
            status: z.enum(["MAPPED", "UNSUPPORTED", "TRANSFORM"]),
            externalValue: z.string().trim().max(120).nullable().optional(),
          })
          .strict()
          .refine((e) => e.status === "UNSUPPORTED" || Boolean(e.externalValue), {
            message: "Συμπληρώστε την τιμή του portal.",
          }),
      )
      .max(200),
  })
  .strict();

const tagsBodySchema = z
  .object({ codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)).max(30) })
  .strict();

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/portals", { preHandler: requireRole("AGENT") }, async () => {
    const portals = await db().portal.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        transport: true,
        enabled: true,
        baseUrl: true,
        feedUrl: true,
        updatedAt: true,
        _count: { select: { listings: true } },
      },
    });
    return { portals };
  });

  app.post(
    "/properties/:id/portals/sync",
    { preHandler: requireRole("MANAGER") },
    async (request) => {
      const actor = request.auth!.user;
      const { id } = request.params as { id: string };
      const body = parseInput(syncBodySchema, request.body ?? {});
      const outcomes = await syncPropertyPortals(id, actor.id, {
        force: body.force,
        portalCode: body.portalCode,
      });
      return { outcomes };
    },
  );

  app.post(
    "/properties/:id/portals/:portalId/republish",
    { preHandler: requireRole("MANAGER") },
    async (request) => {
      const actor = request.auth!.user;
      const { id, portalId } = request.params as { id: string; portalId: string };

      const portal = await db().portal.findUnique({ where: { id: portalId } });
      if (!portal) throw notFound("Το portal δεν βρέθηκε.");

      const results = await syncPropertyPortals(id, actor.id, {
        force: true,
        portalCode: portal.code,
      });
      return { outcomes: results };
    },
  );

  app.get("/feeds/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const portal = await db().portal.findUnique({ where: { code: code.toUpperCase() } });
    if (!portal || !portal.enabled) throw notFound("Η ροή δεν βρέθηκε.");

    const adapter = feedAdapter(portal);
    if (!adapter) throw notFound("Η ροή δεν βρέθηκε.");

    const expected = feedTokenOf(portal);
    if (expected) {
      const provided = (request.query as { token?: string }).token;
      if (provided !== expected) throw forbidden("Invalid feed token.");
    }

    const feed = await buildFeed(portal, adapter);

    // A feed that suddenly shrinks is held back: some portals delist whatever is
    // missing from it. Answering 503 leaves the portal on its last good import.
    const gate = await gateFeed(portal, feed);
    if (gate.blocked) {
      reply.header("retry-after", "3600");
      throw new HttpError(503, "publication_blocked", gate.verdict.message ?? "Η δημοσίευση έχει ανασταλεί μέχρι επιβεβαίωση από διαχειριστή.");
    }

    reply.header("x-feed-version", String(gate.version));
    reply.header("x-feed-schema", FEED_SCHEMA_VERSION);
    if (request.headers["if-none-match"] === feed.hash) {
      reply.code(304);
      return null;
    }

    reply.header("etag", feed.hash);
    reply.header("content-disposition", `inline; filename="${feed.filename}"`);
    reply.header("x-property-count", String(feed.propertyCount));
    reply.type(feed.contentType);
    return feed.body;
  });

  // --- Distribution: preview, feed versions, mappings, tags ---------------------

  /** Dry run: what would go out, what would not, and why. Writes nothing. */
  app.get("/portals/:code/preview", { preHandler: requireRole("MANAGER") }, async (request) => {
    const portal = await portalByCode((request.params as { code: string }).code);
    const result = await previewPortal(portal);
    // The list can be long; the reference and reason are all a manager needs.
    return {
      preview: {
        ...result,
        items: result.items
          .filter((item) => item.outcome !== "READY")
          .slice(0, 200)
          .map(({ reference, outcome, reasons }) => ({ reference, outcome, reasons })),
      },
    };
  });

  /** Listings parked after a permanent error or an exhausted retry budget. */
  app.get("/portals/:code/failed", { preHandler: requireRole("MANAGER") }, async (request) => {
    const portal = await portalByCode((request.params as { code: string }).code);
    const listings = await db().portalListing.findMany({
      where: { portalId: portal.id, state: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        retryCount: true,
        needsReview: true,
        nextRetryAt: true,
        lastError: true,
        lastErrorCode: true,
        updatedAt: true,
        property: { select: { id: true, reference: true } },
      },
    });
    return { listings };
  });

  app.get("/portals/:code/feed/versions", { preHandler: requireRole("MANAGER") }, async (request) => {
    const portal = await portalByCode((request.params as { code: string }).code);
    const versions = await db().portalFeedVersion.findMany({
      where: { portalId: portal.id },
      orderBy: { version: "desc" },
      take: 20,
    });
    return { versions };
  });

  /** A manager confirms a feed the size guard held back. */
  app.post("/portals/:code/feed/approve", { preHandler: requireRole("MANAGER") }, async (request) => {
    const actor = request.auth!.user;
    const portal = await portalByCode((request.params as { code: string }).code);
    const latest = await db().portalFeedVersion.findFirst({ where: { portalId: portal.id }, orderBy: { version: "desc" } });
    if (!latest || !latest.blocked) throw conflict("Δεν υπάρχει ροή που να περιμένει επιβεβαίωση.");
    if (latest.approvedAt) throw conflict("Η ροή έχει ήδη επιβεβαιωθεί.");

    await db().portalFeedVersion.update({
      where: { id: latest.id },
      data: { approvedAt: new Date(), approvedById: actor.id },
    });
    await writeAudit({
      entity: "PORTAL",
      entityId: portal.id,
      action: "feed_approved",
      actorId: actor.id,
      changes: { portal: portal.code, version: latest.version, propertyCount: latest.propertyCount, reason: latest.blockReason },
    });
    return { approved: { version: latest.version, propertyCount: latest.propertyCount } };
  });

  app.get("/portals/:code/mappings", { preHandler: requireRole("MANAGER") }, async (request) => {
    const portal = await portalByCode((request.params as { code: string }).code);
    const entries = await db().portalMapping.findMany({
      where: { portalId: portal.id },
      orderBy: [{ kind: "asc" }, { internalCode: "asc" }],
    });
    const asEntries = entries.map((e) => ({ kind: e.kind, internalCode: e.internalCode, status: e.status, externalValue: e.externalValue }));
    return {
      entries: asEntries,
      unmapped: unmappedCodes(asEntries, PROPERTY_TYPES),
      features: (Object.keys(FEATURE_FLAGS) as Array<keyof typeof FEATURE_LABELS>).map((code) => ({ code, label: FEATURE_LABELS[code] })),
      propertyTypes: PROPERTY_TYPES,
    };
  });

  /** Replaces the portal's whole mapping table. Admin: it changes what categories are published. */
  app.put("/portals/:code/mappings", { preHandler: requireRole("ADMIN") }, async (request) => {
    const actor = request.auth!.user;
    const portal = await portalByCode((request.params as { code: string }).code);
    const body = parseInput(mappingsBodySchema, request.body);

    const seen = new Set<string>();
    for (const e of body.entries) {
      const key = `${e.kind}:${e.internalCode}`;
      if (seen.has(key)) throw conflict(`Διπλή αντιστοίχιση για ${e.internalCode}.`);
      seen.add(key);
      if (e.kind === "TYPE" && !(PROPERTY_TYPES as readonly string[]).includes(e.internalCode)) {
        throw conflict(`Άγνωστος τύπος ακινήτου ${e.internalCode}.`);
      }
      if (e.kind === "FEATURE" && !(e.internalCode in FEATURE_FLAGS)) {
        throw conflict(`Άγνωστο χαρακτηριστικό ${e.internalCode}.`);
      }
    }

    await db().$transaction(async (tx) => {
      await tx.portalMapping.deleteMany({ where: { portalId: portal.id } });
      if (body.entries.length > 0) {
        await tx.portalMapping.createMany({
          data: body.entries.map((e) => ({
            portalId: portal.id,
            kind: e.kind,
            internalCode: e.internalCode,
            status: e.status,
            externalValue: e.status === "UNSUPPORTED" ? null : (e.externalValue ?? null),
            updatedById: actor.id,
          })),
        });
      }
    });
    await writeAudit({
      entity: "PORTAL",
      entityId: portal.id,
      action: "mappings_changed",
      actorId: actor.id,
      changes: { portal: portal.code, entries: body.entries.length },
    });
    return { saved: body.entries.length };
  });

  /** Stable tag codes drive publication rules and the DO_NOT_PUBLISH flag. */
  app.get("/properties/:id/tags", { preHandler: requireRole("AGENT") }, async (request) => {
    const { id } = request.params as { id: string };
    const [assigned, available] = await Promise.all([
      loadTagCodes([id]),
      db().propertyTag.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { code: true, labelEl: true } }),
    ]);
    return { codes: assigned.get(id) ?? [], available };
  });

  app.put("/properties/:id/tags", { preHandler: requireRole("MANAGER") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const body = parseInput(tagsBodySchema, request.body);

    const property = await db().property.findUnique({ where: { id }, select: { id: true } });
    if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");

    const wanted = [...new Set(body.codes)];
    const tags = await db().propertyTag.findMany({ where: { code: { in: wanted }, active: true }, select: { id: true, code: true } });
    const unknown = wanted.filter((code) => !tags.some((t) => t.code === code));
    if (unknown.length > 0) throw conflict(`Άγνωστη ετικέτα: ${unknown.join(", ")}.`);

    const before = (await loadTagCodes([id])).get(id) ?? [];
    await db().$transaction(async (tx) => {
      await tx.propertyTagAssignment.deleteMany({ where: { propertyId: id } });
      if (tags.length > 0) {
        await tx.propertyTagAssignment.createMany({ data: tags.map((t) => ({ propertyId: id, tagId: t.id, createdById: actor.id })) });
      }
    });
    await writeAudit({ entity: "PROPERTY", entityId: id, action: "tags_changed", actorId: actor.id, changes: { before, after: wanted } });

    // Tags decide portal eligibility, so listings must be re-judged now. A
    // failure here must not undo the tag change the manager just made.
    let outcomes: Awaited<ReturnType<typeof syncPropertyPortals>> = [];
    try {
      outcomes = await syncPropertyPortals(id, actor.id);
    } catch {
      outcomes = [];
    }
    return { codes: wanted, outcomes };
  });

  /**
   * Per-property distribution: for every portal that exists in the database,
   * where the listing stands and, when it is not going out, why not.
   */
  app.get("/properties/:id/portals", { preHandler: requireRole("AGENT") }, async (request) => {
    const { id } = request.params as { id: string };
    const property = await db().property.findUnique({ where: { id }, include: { media: true } });
    if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");

    const base = mediaBase(loadConfig());
    const view = toPortalProperty(property, base);
    const tagCodes = (await loadTagCodes([id])).get(id) ?? [];
    const role = request.auth!.user.role;
    const [portals, mayView, showErrors, perms] = await Promise.all([
      db().portal.findMany({ orderBy: { name: "asc" }, include: { listings: { where: { propertyId: id } }, accounts: { orderBy: [{ environment: "asc" }, { accountName: "asc" }] } } }),
      settings().can(request.auth!.user.role, "portals.view"),
      settings().can(request.auth!.user.role, "portals.view_sensitive_errors"),
      Promise.all(["preview", "publish", "update", "unpublish", "retry", "view_sync_history", "configure"].map(async (p) => [p, await settings().can(role, `portals.${p}`)] as const)),
    ]);
    const actorIds = [...new Set(portals.map((p) => p.listings[0]?.lastActionById).filter((v): v is string => Boolean(v)))];
    const actors = actorIds.length ? await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } }) : [];

    const rows = [];
    for (const portal of portals) {
      const listing = portal.listings[0] ?? null;
      const verdict = evaluateCandidate({ property: view, tagCodes }, await loadCandidateContext(portal));
      const actor = actors.find((a) => a.id === listing?.lastActionById);
      const hasAdapter = Boolean(getAdapter(portal.code));
      rows.push({
        portalId: portal.id,
        code: portal.code,
        name: portal.name,
        enabled: portal.enabled,
        state: listing?.state ?? "NOT_PUBLISHED",
        externalId: listing?.externalId ?? null,
        externalUrl: listing?.externalUrl ?? null,
        lastSyncedAt: listing?.lastSyncedAt?.toISOString() ?? null,
        lastError: listing?.lastError ? (showErrors ? listing.lastError : "Η τελευταία ενέργεια απέτυχε.") : null,
        lastErrorCode: listing?.lastErrorCode ?? null,
        needsReview: listing?.needsReview ?? false,
        nextRetryAt: listing?.nextRetryAt?.toISOString() ?? null,
        // What would happen on the next sync, and the reasons when it is not READY.
        outcome: verdict.outcome,
        reasons: verdict.reasons,
        warnings: verdict.warnings.map((w) => w.message),
        // Manual operations
        hasAdapter,
        portalAccountId: listing?.portalAccountId ?? null,
        lastAction: listing?.lastAction ?? null,
        lastActionAt: listing?.lastActionAt?.toISOString() ?? null,
        lastActionBy: actor ? `${actor.firstName} ${actor.lastName}`.trim() : null,
        lastSuccessfulSyncAt: listing?.lastSuccessfulSyncAt?.toISOString() ?? null,
        lastFailedAt: listing?.lastFailedAt?.toISOString() ?? null,
        accounts: mayView
          ? portal.accounts.map((a) => ({
              id: a.id,
              accountName: a.accountName,
              environment: a.environment,
              status: a.status,
              enabled: a.enabled,
              // Only the in-process mock exists today; PRODUCTION never has a provider.
              providerKind: resolvePortalProvider(portal, a) ? (resolvePortalProvider(portal, a)!.mock ? "mock" : "real") : "none",
            }))
          : [],
      });
    }
    return { portals: rows, permissions: Object.fromEntries(perms), catalogSize: PORTAL_CATALOG.length, flags: SYSTEM_PROPERTY_TAGS.map((t) => t.code) };
  });
}
