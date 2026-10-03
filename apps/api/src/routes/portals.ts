/**
 * Portal routes.
 *
 * Reading the portal catalogue and triggering a push are internal, agent-only
 * operations. The feed endpoints are public by design: a portal polls them
 * server-to-server, with no session. They are gated instead by an optional
 * `feedToken` stored on the portal so a guessed URL is not enough to scrape the
 * full book.
 */

import { PUBLIC_PROPERTY_STATUSES } from "@home88/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  evaluatePublishEligibility,
  getAdapter,
  type AdapterPayload,
  type PortalAdapter,
} from "@home88/portals";
import { loadConfig } from "../config";
import { forbidden, notFound } from "../lib/errors";
import { parseInput } from "../lib/http";
import { db } from "../lib/prisma";
import { mediaBase, toPortalProperty } from "../lib/portal-map";
import {
  buildContext,
  eligibilityOptions,
  syncPropertyPortals,
} from "../lib/portal-sync";
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
 * Assembles a portal's feed from every property that is currently for sale or
 * rent and passes that portal's own eligibility rules.
 */
async function buildFeed(portal: Portal, adapter: PortalAdapter) {
  const cfg = loadConfig();
  const base = mediaBase(cfg);
  const options = eligibilityOptions(portal);
  const context = buildContext(portal, cfg);

  const properties = await db().property.findMany({
    where: { status: { in: [...PUBLIC_PROPERTY_STATUSES] } },
    include: { media: true },
    orderBy: { reference: "asc" },
  });

  const payloads: AdapterPayload[] = [];
  for (const property of properties) {
    const view = toPortalProperty(property, base);
    if (!adapter.supports(view)) continue;
    if (!evaluatePublishEligibility(view, options).eligible) continue;
    payloads.push(adapter.build(view, context));
  }

  return adapter.compose!(payloads);
}

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
}
