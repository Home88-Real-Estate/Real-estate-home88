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
  decideRetry,
  evaluateCandidate,
  getAdapter,
  isRetryDue,
  normaliseErrorCode,
  retryPolicyFromSettings,
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
import { loadCandidateContext, loadTagCodes } from "./portal-distribution";
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

type Outcome = { state: PortalSyncState; detail: string; errorCode: string | null };

/**
 * What a transport does with a plan. A feed portal reads our document on its own
 * schedule, so being in the feed is `IN_FEED`, never `PUBLISHED`: that word is
 * kept for a listing the portal has confirmed. Manual portals stay queued until
 * a human posts them; the API transport is not implemented yet, so it fails
 * loudly rather than pretending success.
 */
export function executeTransport(transport: string, action: SyncAction): Outcome {
  if (action === "REMOVE") {
    return transport === "API"
      ? { state: "FAILED", detail: "API transport is not configured", errorCode: "TRANSPORT_UNAVAILABLE" }
      : { state: "REMOVED", detail: "delisted from portal", errorCode: null };
  }

  switch (transport) {
    case "XML_FEED":
    case "CSV_FEED":
      return {
        state: "IN_FEED",
        detail: `in ${transport === "XML_FEED" ? "XML" : "CSV"} feed, awaiting portal import`,
        errorCode: null,
      };
    case "JSON_FEED":
      return { state: "IN_FEED", detail: "in JSON feed, awaiting portal import", errorCode: null };
    case "MANUAL":
      return { state: "QUEUED", detail: "posting sheet ready for manual upload", errorCode: null };
    default:
      return { state: "FAILED", detail: "API transport is not configured", errorCode: "TRANSPORT_UNAVAILABLE" };
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
  const tagCodes = (await loadTagCodes([propertyId])).get(propertyId) ?? [];
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

    // A listing parked for review, or still backing off, is left alone until a
    // person republishes it (force) or the backoff elapses.
    if (existing?.state === "FAILED" && !options.force && !isRetryDue({ needsReview: existing.needsReview, nextRetryAt: existing.nextRetryAt })) {
      outcomes.push({
        portalId: portal.id,
        portalCode: portal.code,
        action: null,
        state: "FAILED",
        detail: existing.needsReview ? "needs review — fix the cause, then republish" : "retry scheduled",
      });
      continue;
    }

    // The same gate the dry run and the feed use: market status, this portal's
    // publication rule and flags, its validation profile and taxonomy mapping.
    const verdict = evaluateCandidate({ property: view, tagCodes }, await loadCandidateContext(portal));
    const plan = planSync({
      eligible: verdict.outcome === "READY",
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
        detail: verdict.outcome === "READY" ? plan.reason : [plan.reason, ...verdict.reasons].join(" — "),
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

    // Failures are classified: permanent ones are parked for review at once,
    // transient ones back off, and neither is retried forever.
    const attempts = ok ? 0 : (existing?.retryCount ?? 0) + 1;
    const retry = ok
      ? null
      : decideRetry({ attempts, errorCode: outcome.errorCode, policy: retryPolicyFromSettings((portal.settings ?? {}) as Record<string, unknown>) });
    const failureFields = ok
      ? { lastErrorCode: null, needsReview: false, nextRetryAt: null }
      : {
          lastErrorCode: normaliseErrorCode(outcome.errorCode),
          needsReview: retry!.action === "DEAD_LETTER",
          nextRetryAt: retry!.nextRetryAt,
        };

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
          ...failureFields,
        },
        update: {
          state: outcome.state,
          externalId: payload?.externalId ?? null,
          externalUrl: portal.feedUrl ?? null,
          lastPayloadHash: payload?.hash ?? null,
          lastSyncedAt: ok ? now : undefined,
          lastError: ok ? null : outcome.detail,
          retryCount: ok ? 0 : { increment: 1 },
          ...failureFields,
        },
      });

      await tx.portalSyncLog.create({
        data: {
          portalId: portal.id,
          portalListingId: saved.id,
          propertyId,
          action,
          ok,
          detail: retry ? `${outcome.detail} (${retry.reason})` : outcome.detail,
          errorCode: normaliseErrorCode(outcome.errorCode),
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
