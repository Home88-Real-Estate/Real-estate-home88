/**
 * Where one property stands on every portal, and why not where it is held back:
 * the per-property portal overview shared by `GET /properties/:id/portals` and
 * the unified publications endpoint, so there is exactly one implementation.
 */

import { PORTAL_CATALOG, SYSTEM_PROPERTY_TAGS } from "@home88/domain";
import { evaluateCandidate, getAdapter } from "@home88/portals";

import { loadConfig } from "../config";
import { settings } from "../settings";
import { notFound } from "./errors";
import { loadCandidateContext, loadTagCodes } from "./portal-distribution";
import { mediaBase, toPortalProperty } from "./portal-map";
import { resolvePortalProvider } from "./portal-accounts";
import { db } from "./prisma";

export async function loadPortalOverview(id: string, role: string) {
    const property = await db().property.findUnique({ where: { id }, include: { media: true } });
    if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");

    const base = mediaBase(loadConfig());
    const view = toPortalProperty(property, base);
    const tagCodes = (await loadTagCodes([id])).get(id) ?? [];
    const [portals, mayView, showErrors, perms] = await Promise.all([
      db().portal.findMany({ orderBy: { name: "asc" }, include: { listings: { where: { propertyId: id } }, accounts: { orderBy: [{ environment: "asc" }, { accountName: "asc" }] } } }),
      settings().can(role, "portals.view"),
      settings().can(role, "portals.view_sensitive_errors"),
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
}
