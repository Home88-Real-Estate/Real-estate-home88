/**
 * Portal synchronisation service.
 *
 * This is the thin, database-aware shell around the pure `@home88/portals`
 * engine: it loads a property and the enabled portals, asks the engine what to
 * do, persists the resulting `PortalListing` state and writes a `PortalSyncLog`
 * for every action. The decision logic itself lives in the engine so it stays
 * testable without a database.
 */

import type { Portal } from "@home88/database";
import {
  evaluatePublishEligibility,
  getAdapter,
  planSync,
  propertyContentHash,
  type AgencyConfig,
  type BuildContext,
  type PortalConfig,
  type PortalSyncState,
  type SyncAction,
} from "@home88/portals";
import { loadConfig, type ApiConfig } from "../config";
import { writeAudit } from "./audit";
import { notFound } from "./errors";
import { mediaBase, toPortalProperty } from "./portal-map";
import { db } from "./prisma";

export function portalConfigFromRow(portal: Portal): PortalConfig {
  return {
    code: portal.code,
    name: portal.name,
    transport: portal.transport,
    baseUrl: portal.baseUrl,
    feedUrl: portal.feedUrl,
    defaultAgentExternalId: portal.defaultAgentExternalId,
    settings: (portal.settings ?? null) as unknown as PortalConfig["settings"],
  };
}

export function agencyFromConfig(cfg: ApiConfig): AgencyConfig {
  return {
    name: cfg.COMPANY_LEGAL_NAME,
    email: cfg.COMPANY_PRIVACY_EMAIL,
    phone: null,
    website: cfg.SITE_URL,
    license: null,
  };
}

export function buildContext(portal: Portal, cfg: ApiConfig): BuildContext {
  return {
    portal: portalConfigFromRow(portal),
    agency: agencyFromConfig(cfg),
    mediaBaseUrl: mediaBase(cfg),
  };
}

/** Per-portal overrides read from `Portal.settings`. */
export function eligibilityOptions(portal: Portal): { allowAssignment: boolean; requirePhoto: boolean } {
  const settings = (portal.settings ?? {}) as unknown as Record<string, unknown>;
  return {
    allowAssignment: settings.allowAssignment !== false,
    requirePhoto: settings.requirePhoto !== false,
  };
}

type Outcome = { state: PortalSyncState; detail: string; errorCode: string | null };

/**
 * What a transport does with a plan. Feed portals are considered published once
 * the listing is in the feed we serve; manual portals stay queued until a human
 * posts them; the API transport is not implemented yet, so it fails loudly
 * rather than pretending success.
 */
export function executeTransport(transport: string, action: SyncAction): Outcome {
  if (action === "REMOVE") {
    return transport === "API"
      ? { state: "FAILED", detail: "API transport is not configured", errorCode: "api_transport_unavailable" }
      : { state: "REMOVED", detail: "delisted from portal", errorCode: null };
  }

  switch (transport) {
    case "XML_FEED":
    case "CSV_FEED":
      return {
        state: "PUBLISHED",
        detail: `exported to ${transport === "XML_FEED" ? "XML" : "CSV"} feed`,
        errorCode: null,
      };
    case "MANUAL":
      return { state: "QUEUED", detail: "posting sheet ready for manual upload", errorCode: null };
    default:
      return { state: "FAILED", detail: "API transport is not configured", errorCode: "api_transport_unavailable" };
  }
}

export type PortalSyncOutcome = {
  portalId: string;
  portalCode: string;
  action: SyncAction | null;
  state: PortalSyncState;
  detail: string;
};

export type SyncOptions = { force?: boolean; portalCode?: string };

export async function syncPropertyPortals(
  propertyId: string,
  actorId: string | null,
  options: SyncOptions = {},
): Promise<PortalSyncOutcome[]> {
  const cfg = loadConfig();
  const base = mediaBase(cfg);

  const property = await db().property.findUnique({
    where: { id: propertyId },
    include: { media: true },
  });
  if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");

  const portals = await db().portal.findMany({
    where: { enabled: true, ...(options.portalCode ? { code: options.portalCode } : {}) },
    orderBy: { name: "asc" },
  });

  const view = toPortalProperty(property, base);
  const currentHash = propertyContentHash(view);
  const outcomes: PortalSyncOutcome[] = [];

  for (const portal of portals) {
    const adapter = getAdapter(portal.code);
    if (!adapter) {
      outcomes.push({
        portalId: portal.id,
        portalCode: portal.code,
        action: null,
        state: "NOT_PUBLISHED",
        detail: "no adapter registered",
      });
      continue;
    }

    const existing = await db().portalListing.findUnique({
      where: { portalId_propertyId: { portalId: portal.id, propertyId } },
    });

    const eligibility = evaluatePublishEligibility(view, eligibilityOptions(portal));
    const plan = planSync({
      eligible: eligibility.eligible,
      currentHash,
      lastPayloadHash: existing?.lastPayloadHash ?? null,
      state: existing?.state ?? "NOT_PUBLISHED",
      force: options.force,
    });

    if (!plan.action) {
      outcomes.push({
        portalId: portal.id,
        portalCode: portal.code,
        action: null,
        state: existing?.state ?? "NOT_PUBLISHED",
        detail: plan.reason,
      });
      continue;
    }

    const action = plan.action;
    const payload = action === "REMOVE" ? null : adapter.build(view, buildContext(portal, cfg));
    const started = Date.now();
    const outcome = executeTransport(adapter.transport, action);
    const durationMs = Date.now() - started;
    const ok = outcome.state !== "FAILED";
    const now = new Date();

    const listing = await db().$transaction(async (tx) => {
      const saved = await tx.portalListing.upsert({
        where: { portalId_propertyId: { portalId: portal.id, propertyId } },
        create: {
          portalId: portal.id,
          propertyId,
          state: outcome.state,
          externalId: payload?.externalId ?? null,
          externalUrl: portal.feedUrl ?? null,
          lastPayloadHash: payload?.hash ?? null,
          lastSyncedAt: ok ? now : null,
          lastError: ok ? null : outcome.detail,
          retryCount: ok ? 0 : 1,
        },
        update: {
          state: outcome.state,
          externalId: payload?.externalId ?? null,
          externalUrl: portal.feedUrl ?? null,
          lastPayloadHash: payload?.hash ?? null,
          lastSyncedAt: ok ? now : undefined,
          lastError: ok ? null : outcome.detail,
          retryCount: ok ? 0 : { increment: 1 },
        },
      });

      await tx.portalSyncLog.create({
        data: {
          portalId: portal.id,
          portalListingId: saved.id,
          propertyId,
          action,
          ok,
          detail: outcome.detail,
          errorCode: outcome.errorCode,
          durationMs,
          actorId,
        },
      });

      return saved;
    });

    await writeAudit({
      entity: "PORTAL_LISTING",
      entityId: listing.id,
      action: action.toLowerCase(),
      actorId,
      changes: { portal: portal.code, state: outcome.state, hash: payload?.hash ?? null },
    });

    outcomes.push({
      portalId: portal.id,
      portalCode: portal.code,
      action,
      state: outcome.state,
      detail: outcome.detail,
    });
  }

  return outcomes;
}
