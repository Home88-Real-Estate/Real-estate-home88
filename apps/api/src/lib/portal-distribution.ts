/**
 * Database-aware pieces of portal distribution: loading a portal's rule,
 * validation profile and mappings, judging properties against them, and keeping
 * feed versions with the mass-unpublish guard.
 *
 * The decisions themselves are in @home88/portals; this file only fetches what
 * they need and persists what they return.
 */

import { PUBLIC_PROPERTY_STATUSES } from "@home88/domain";
import { Prisma, type Portal } from "@home88/database";
import {
  buildPublicationPreview,
  evaluateCandidate,
  getAdapter,
  guardConfigFromSettings,
  guardPublicationChange,
  parseConditions,
  profileFromSettings,
  type CandidateContext,
  type FeedDocument,
  type GuardVerdict,
  type MappingEntry,
  type PreviewCandidate,
  type PreviewResult,
} from "@home88/portals";
import { loadConfig } from "../config";
import { mediaBase, toPortalProperty } from "./portal-map";
import { db } from "./prisma";

/** Bumped when an adapter changes what a feed contains, so history stays interpretable. */
export const FEED_SCHEMA_VERSION = "1";

function settingsOf(portal: Portal): Record<string, unknown> {
  return ((portal.settings ?? {}) as unknown as Record<string, unknown>) ?? {};
}

export async function loadCandidateContext(portal: Portal): Promise<CandidateContext> {
  const [rule, mappings] = await Promise.all([
    db().portalPublicationRule.findUnique({ where: { portalId: portal.id } }),
    db().portalMapping.findMany({ where: { portalId: portal.id } }),
  ]);
  return {
    adapter: getAdapter(portal.code) ?? null,
    rule: rule
      ? {
          mode: rule.mode,
          propertyTypes: rule.propertyTypes,
          includeTags: rule.includeTags,
          excludeTags: rule.excludeTags,
          conditions: parseConditions(rule.conditions),
        }
      : null,
    profile: profileFromSettings(settingsOf(portal)),
    mappings: mappings.map(
      (m): MappingEntry => ({ kind: m.kind, internalCode: m.internalCode, status: m.status, externalValue: m.externalValue }),
    ),
    allowAssignment: settingsOf(portal).allowAssignment !== false,
  };
}

/** Stable tag codes per property id. */
export async function loadTagCodes(propertyIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (propertyIds.length === 0) return out;
  const rows = await db().propertyTagAssignment.findMany({
    where: { propertyId: { in: propertyIds } },
    select: { propertyId: true, tag: { select: { code: true } } },
  });
  for (const row of rows) out.set(row.propertyId, [...(out.get(row.propertyId) ?? []), row.tag.code]);
  return out;
}

/** Every property that is on the market, with its tags, ready to be judged. */
export async function loadCandidates(): Promise<PreviewCandidate[]> {
  const base = mediaBase(loadConfig());
  const properties = await db().property.findMany({
    where: { status: { in: [...PUBLIC_PROPERTY_STATUSES] } },
    include: { media: true },
    orderBy: { reference: "asc" },
  });
  const tags = await loadTagCodes(properties.map((p) => p.id));
  return properties.map((p) => ({ property: toPortalProperty(p, base), tagCodes: tags.get(p.id) ?? [] }));
}

/**
 * The last publication size a person (or an unblocked serve) established. A
 * blocked feed becomes the baseline only once a manager approves it.
 */
async function baselineCount(portalId: string): Promise<number | null> {
  const row = await db().portalFeedVersion.findFirst({
    where: { portalId, OR: [{ blocked: false }, { approvedAt: { not: null } }] },
    orderBy: { version: "desc" },
    select: { propertyCount: true },
  });
  return row?.propertyCount ?? null;
}

export async function previewPortal(portal: Portal): Promise<PreviewResult> {
  const [ctx, candidates, previousCount] = await Promise.all([
    loadCandidateContext(portal),
    loadCandidates(),
    baselineCount(portal.id),
  ]);
  return buildPublicationPreview({
    ...ctx,
    candidates,
    previousCount,
    guard: guardConfigFromSettings(settingsOf(portal)),
  });
}

export { evaluateCandidate };

export type FeedGate = { blocked: boolean; verdict: GuardVerdict; version: number };

/**
 * Records the feed about to be served and decides whether it may be. Polling an
 * unchanged feed does not create new rows; a changed one is compared with the
 * last confirmed size.
 */
export async function gateFeed(portal: Portal, feed: Pick<FeedDocument, "hash" | "propertyCount">): Promise<FeedGate> {
  const config = guardConfigFromSettings(settingsOf(portal));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const last = await db().portalFeedVersion.findFirst({ where: { portalId: portal.id }, orderBy: { version: "desc" } });

    if (last && last.checksum === feed.hash) {
      const verdict = guardPublicationChange(await baselineCount(portal.id), feed.propertyCount, config);
      return { blocked: last.blocked && !last.approvedAt, verdict: { ...verdict, blocked: last.blocked && !last.approvedAt }, version: last.version };
    }

    const verdict = guardPublicationChange(await baselineCount(portal.id), feed.propertyCount, config);
    try {
      const created = await db().portalFeedVersion.create({
        data: {
          portalId: portal.id,
          version: (last?.version ?? 0) + 1,
          schemaVersion: FEED_SCHEMA_VERSION,
          propertyCount: feed.propertyCount,
          checksum: feed.hash,
          blocked: verdict.blocked,
          blockReason: verdict.message,
        },
      });
      return { blocked: verdict.blocked, verdict, version: created.version };
    } catch (error) {
      // Two pollers raced for the same version number; read again and compare.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  // Could not record the version. Refuse to serve rather than serve unrecorded.
  return { blocked: true, verdict: guardPublicationChange(null, 0), version: 0 };
}
