/**
 * The website publication service. The ONLY writer of website publication state.
 *
 * `WebsitePublication.status` is the authoritative state of a property on the
 * public website. `Property.publishedOnWebsite` still exists because older code
 * reads it; it is derived here, in the same transaction as every change
 * (`syncLegacyFlag`), and written nowhere else (a test scans the sources for
 * that). Routes, the property lifecycle and the tag editor all come through the
 * functions below, so the rules cannot be bypassed or drift.
 *
 * Every operation:
 *   - decides on the server (readiness, tags, the property's own status);
 *   - writes its state, the compatibility flag and an append-only
 *     channel_publication_events row in one transaction, plus an audit entry for
 *     anything that changes what visitors can see;
 *   - then, outside the transaction, asks the website to refresh the affected
 *     pages. That call can fail without undoing the (correct) database change.
 *
 * Nothing here touches portal listings: the website and the portals are
 * independent channels.
 */

import type { ChannelAction, Prisma, WebsitePublication, WebsitePublicationStatus } from "@home88/database";
import {
  backfillWebsiteState,
  evaluateWebsiteReadiness,
  isPublicMedia,
  isPublicStatus,
  isWebsiteLive,
  legacyPublishedFlag,
  publicWebsiteView,
  websiteSitemapEligible,
  websiteStateForProperty,
  websiteStateForTags,
  WEBSITE_BLOCKING_TAGS,
  type WebsiteReadiness,
  type WebsiteRules,
  type WebsiteStateChange,
} from "@home88/domain";
import { canonicalJson, sha256 } from "@home88/portals";

import { loadConfig } from "../config";
import { settings } from "../settings";
import { writeAudit } from "./audit";
import { conflict, notFound } from "./errors";
import { db } from "./prisma";
import { revalidateWebsite, type Revalidation } from "./website-revalidate";

type Client = Prisma.TransactionClient;

/** Who is acting and how to trace it. Never contains personal data beyond the actor's id. */
export type OperationContext = {
  actorId: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const HASH_VERSION = 1;

// --- Loading ----------------------------------------------------------------------------------------------

const propertyInclude = {
  media: { select: { id: true, status: true, lifecycle: true, kind: true, isPrimary: true, sortOrder: true, altEl: true, altEn: true } },
} satisfies Prisma.PropertyInclude;

type PropertyRow = Prisma.PropertyGetPayload<{ include: typeof propertyInclude }>;

export type WebsiteContext = {
  property: PropertyRow;
  tagCodes: string[];
  publication: WebsitePublication | null;
  rules: WebsiteRules;
};

/**
 * The office's publication settings. Read through the global client, so it must
 * run BEFORE a transaction opens, never inside one (on a small serverless pool a
 * second connection requested mid-transaction can wait on the one it holds).
 */
export async function loadWebsiteRules(): Promise<WebsiteRules> {
  const values = await settings().config("properties");
  const minPhotos = Number(values.minPhotosToPublish);
  return {
    minPhotosToPublish: Number.isFinite(minPhotos) ? minPhotos : 0,
    requireEnglishDescription: values.requireEnglishDescription === true,
    requireEnergyClass: values.requireEnergyClass === true,
  };
}

export async function loadWebsiteContext(client: Client, propertyId: string, rules: WebsiteRules): Promise<WebsiteContext> {
  const property = await client.property.findUnique({ where: { id: propertyId }, include: propertyInclude });
  if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");
  const tags = await client.propertyTagAssignment.findMany({ where: { propertyId }, select: { tag: { select: { code: true } } } });
  const publication = await client.websitePublication.findUnique({ where: { propertyId } });
  return { property, tagCodes: tags.map((t) => t.tag.code), publication, rules };
}

// --- Evaluation (pure over a loaded context) ---------------------------------------------------------------

export type WebsiteEvaluation = {
  readiness: WebsiteReadiness;
  /** Hash of everything a visitor can see, plus the SEO text. Changes only when that changes. */
  hash: string;
  /** The page's public address (the existing /property/[reference] route). */
  url: string;
  view: ReturnType<typeof publicWebsiteView>;
  photoCount: number;
};

export function publicUrlFor(reference: string): string {
  return `${loadConfig().SITE_URL.replace(/\/+$/, "")}/property/${encodeURIComponent(reference)}`;
}

export function evaluateWebsite(ctx: WebsiteContext): WebsiteEvaluation {
  const { property, publication } = ctx;
  const view = publicWebsiteView(property as unknown as Record<string, unknown>, property.media);
  const readiness = evaluateWebsiteReadiness({
    propertyStatus: property.status,
    tagCodes: ctx.tagCodes,
    listingType: property.listingType,
    titleEl: property.titleEl,
    titleEn: property.titleEn,
    descriptionEl: property.descriptionEl,
    descriptionEn: property.descriptionEn,
    price: property.price,
    monthlyRent: property.monthlyRent,
    priceOnRequest: property.priceOnRequest,
    energyClass: property.energyClass,
    publicPhotoCount: property.media.filter(isPublicMedia).length,
    rules: ctx.rules,
  });
  const hash = sha256(
    canonicalJson({ v: HASH_VERSION, view, seo: { title: publication?.seoTitle ?? null, description: publication?.seoDescription ?? null } }),
  );
  return { readiness, hash, url: publicUrlFor(property.reference), view, photoCount: view.media.length };
}

/** OUTDATED is computed, never stored by a read: a live page whose content moved since the last generation. */
export function effectiveWebsiteStatus(publication: WebsitePublication | null, hash: string): string {
  if (!publication) return "DRAFT";
  if (isWebsiteLive(publication.status, publication.enabled) && publication.status === "PUBLISHED" && publication.lastPayloadHash && publication.lastPayloadHash !== hash) {
    return "OUTDATED";
  }
  return publication.status;
}

/** Whether a visitor can open the page right now: live, a public property status, no blocking tag, not PRIVATE. */
export function isPubliclyVisible(ctx: WebsiteContext): boolean {
  const p = ctx.publication;
  if (!p) return false;
  return (
    isWebsiteLive(p.status, p.enabled) &&
    p.visibility !== "PRIVATE" &&
    isPublicStatus(ctx.property.status) &&
    !ctx.tagCodes.some((c) => (WEBSITE_BLOCKING_TAGS as readonly string[]).includes(c))
  );
}

export function sitemapEligibleNow(ctx: WebsiteContext, status: string, enabled: boolean, visibility: string, noIndex: boolean): boolean {
  return websiteSitemapEligible({ status, enabled, visibility, noIndex, propertyStatus: ctx.property.status, tagCodes: ctx.tagCodes });
}

// --- Writing primitives -----------------------------------------------------------------------------------------

/**
 * The compatibility flag. Derived from the publication in the same transaction
 * as every change, and written nowhere else. `publishedAt` (the first time the
 * page went live) is kept for the legacy ordering and set once.
 */
async function syncLegacyFlag(tx: Client, propertyId: string, status: string, enabled: boolean, firstPublish: boolean): Promise<void> {
  const flag = legacyPublishedFlag(status, enabled);
  await tx.property.update({
    where: { id: propertyId },
    data: { publishedOnWebsite: flag, ...(firstPublish ? { publishedAt: new Date() } : {}) },
  });
}

async function writeEvent(
  tx: Client,
  e: { propertyId: string; publicationId: string; action: ChannelAction; ok: boolean; state: WebsitePublicationStatus; detail?: string | null; errorCode?: string | null; hash?: string | null },
  ctx: OperationContext,
): Promise<void> {
  await tx.channelPublicationEvent.create({
    data: {
      propertyId: e.propertyId,
      channelType: "WEBSITE",
      websitePublicationId: e.publicationId,
      action: e.action,
      ok: e.ok,
      websiteState: e.state,
      detail: e.detail ? e.detail.slice(0, 500) : null,
      errorCode: e.errorCode ?? null,
      payloadHash: e.hash ?? null,
      triggeredById: ctx.actorId,
      requestId: ctx.requestId ?? null,
    },
  });
}

async function audit(tx: Client, action: string, propertyId: string, ctx: OperationContext, changes: Record<string, unknown>): Promise<void> {
  await writeAudit({ entity: "PROPERTY", entityId: propertyId, action, actorId: ctx.actorId, ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null, changes }, tx);
}

/**
 * Every property has exactly one publication. A missing row is created from the
 * legacy state with the same rule the migration used (idempotent: a concurrent
 * create or the migration's own row wins, nothing is overwritten).
 */
export async function ensureWebsitePublication(
  tx: Client,
  property: { id: string; slug: string; status: string; publishedOnWebsite: boolean },
): Promise<WebsitePublication> {
  const existing = await tx.websitePublication.findUnique({ where: { propertyId: property.id } });
  if (existing) return existing;
  const b = backfillWebsiteState(property.publishedOnWebsite, property.status);
  await tx.websitePublication.createMany({
    data: [{
      id: `wp_${property.id}`,
      propertyId: property.id,
      status: b.status as WebsitePublicationStatus,
      enabled: b.enabled,
      slug: property.slug,
      visibility: b.visibility as "PUBLIC" | "NOINDEX",
      sitemapIncluded: b.sitemapIncluded,
      noIndex: b.noIndex,
      lastPublishedAt: b.status === "PUBLISHED" ? new Date() : null,
    }],
    skipDuplicates: true,
  });
  const created = await tx.websitePublication.findUniqueOrThrow({ where: { propertyId: property.id } });
  await tx.websiteSlugHistory.createMany({
    data: [{ id: `wsh_${property.id}`, websitePublicationId: created.id, propertyId: property.id, slug: created.slug, kind: "ORIGINAL" }],
    skipDuplicates: true,
  });
  return created;
}

async function ensureFor(tx: Client, ctx: WebsiteContext): Promise<WebsitePublication> {
  return ctx.publication ?? ensureWebsitePublication(tx, ctx.property);
}

/** Keeps the publication's slug equal to the property's, remembering the old one for redirects. */
async function reconcileSlug(tx: Client, pub: WebsitePublication, propertySlug: string, actorId: string | null): Promise<string> {
  if (pub.slug === propertySlug) return pub.slug;
  await tx.websiteSlugHistory.create({
    data: { websitePublicationId: pub.id, propertyId: pub.propertyId, slug: pub.slug, kind: "RENAMED", redirectedTo: propertySlug, changedById: actorId },
  });
  return propertySlug;
}

// --- Operations -------------------------------------------------------------------------------------------------------

export type WebsiteResult =
  | { status: "VALIDATED"; ready: boolean; blockers: string[]; warnings: string[]; hash: string }
  | {
      status: "PREVIEWED";
      ready: boolean;
      blockers: string[];
      warnings: string[];
      hash: string;
      url: string;
      wouldChange: boolean;
      sitemapIncluded: boolean;
      photoCount: number;
      view: { fields: Record<string, unknown>; media: Array<{ id: string | null; kind: string; primary: boolean; altEl: string | null; altEn: string | null }> };
    }
  | { status: "BLOCKED"; blockers: string[]; warnings: string[] }
  | { status: "UNCHANGED"; hash: string }
  | { status: "PUBLISHED" | "UPDATED" | "UNPUBLISHED"; hash: string | null; url: string; sitemapIncluded: boolean; revalidation: Revalidation };

/** Checks readiness. Records the verdict; changes the page's visibility never. */
export async function validateWebsite(propertyId: string, ctx: OperationContext): Promise<WebsiteResult> {
  const rules = await loadWebsiteRules();
  return db().$transaction(async (tx) => {
    const loaded = await loadWebsiteContext(tx, propertyId, rules);
    const pub = await ensureFor(tx, loaded);
    const evaluation = evaluateWebsite({ ...loaded, publication: pub });
    const ready = evaluation.readiness.outcome === "READY";
    const live = isWebsiteLive(pub.status, pub.enabled);

    // A page that is not live moves between READY and VALIDATION_FAILED; a live one keeps its state.
    let state = pub.status;
    if (!live && (pub.status === "DRAFT" || pub.status === "READY" || pub.status === "VALIDATION_FAILED" || pub.status === "UNPUBLISHED" || pub.status === "FAILED")) {
      state = ready ? "READY" : "VALIDATION_FAILED";
      await tx.websitePublication.update({
        where: { id: pub.id },
        data: {
          status: state,
          updatedById: ctx.actorId,
          ...(ready ? { lastErrorCode: null, lastErrorMessage: null } : { lastFailedAt: new Date(), lastErrorCode: "VALIDATION_FAILED", lastErrorMessage: evaluation.readiness.blockers.join(" · ").slice(0, 500) }),
        },
      });
    }
    await writeEvent(tx, { propertyId, publicationId: pub.id, action: "VALIDATE", ok: ready, state, detail: ready ? "ready" : evaluation.readiness.blockers.join(" · "), errorCode: ready ? null : "VALIDATION_FAILED", hash: evaluation.hash }, ctx);
    return { status: "VALIDATED" as const, ready, blockers: evaluation.readiness.blockers, warnings: evaluation.readiness.warnings, hash: evaluation.hash };
  });
}

/** What visitors would see. Reads and records a preview event; changes no state. */
export async function previewWebsite(propertyId: string, ctx: OperationContext): Promise<WebsiteResult> {
  const rules = await loadWebsiteRules();
  return db().$transaction(async (tx) => {
    const loaded = await loadWebsiteContext(tx, propertyId, rules);
    const pub = await ensureFor(tx, loaded);
    const evaluation = evaluateWebsite({ ...loaded, publication: pub });
    const ready = evaluation.readiness.outcome === "READY";
    await writeEvent(tx, { propertyId, publicationId: pub.id, action: "PREVIEW", ok: true, state: pub.status, detail: ready ? "ready" : "blocked", hash: evaluation.hash }, ctx);
    return {
      status: "PREVIEWED" as const,
      ready,
      blockers: evaluation.readiness.blockers,
      warnings: evaluation.readiness.warnings,
      hash: evaluation.hash,
      url: evaluation.url,
      wouldChange: pub.lastPayloadHash !== evaluation.hash,
      sitemapIncluded: sitemapEligibleNow(loaded, "PUBLISHED", true, "PUBLIC", false),
      photoCount: evaluation.photoCount,
      view: evaluation.view,
    };
  });
}

/** Puts the property on the website. Refused (never forced) when it is not ready or already live. */
export async function publishWebsite(propertyId: string, ctx: OperationContext): Promise<WebsiteResult> {
  const rules = await loadWebsiteRules();
  const out = await db().$transaction(async (tx) => {
    const loaded = await loadWebsiteContext(tx, propertyId, rules);
    const pub = await ensureFor(tx, loaded);
    if (isWebsiteLive(pub.status, pub.enabled)) throw conflict("Το ακίνητο είναι ήδη δημοσιευμένο στον ιστότοπο· χρησιμοποιήστε «Ενημέρωση».");

    const evaluation = evaluateWebsite({ ...loaded, publication: pub });
    if (evaluation.readiness.outcome !== "READY") {
      await tx.websitePublication.update({
        where: { id: pub.id },
        data: { status: "VALIDATION_FAILED", lastFailedAt: new Date(), lastErrorCode: "VALIDATION_FAILED", lastErrorMessage: evaluation.readiness.blockers.join(" · ").slice(0, 500), updatedById: ctx.actorId },
      });
      await writeEvent(tx, { propertyId, publicationId: pub.id, action: "PUBLISH", ok: false, state: "VALIDATION_FAILED", detail: evaluation.readiness.blockers.join(" · "), errorCode: "VALIDATION_FAILED", hash: evaluation.hash }, ctx);
      await audit(tx, "website_publish_blocked", propertyId, ctx, { blockers: evaluation.readiness.blockers });
      return { result: { status: "BLOCKED", blockers: evaluation.readiness.blockers, warnings: evaluation.readiness.warnings } as WebsiteResult, reference: null as string | null };
    }

    const now = new Date();
    const slug = await reconcileSlug(tx, pub, loaded.property.slug, ctx.actorId);
    const sitemapIncluded = sitemapEligibleNow(loaded, "PUBLISHED", true, "PUBLIC", false);
    await tx.websitePublication.update({
      where: { id: pub.id },
      data: {
        status: "PUBLISHED",
        enabled: true,
        slug,
        canonicalUrl: evaluation.url,
        visibility: "PUBLIC",
        noIndex: false,
        sitemapIncluded,
        lastPublishedAt: now,
        lastGeneratedAt: now,
        lastPayloadHash: evaluation.hash,
        lastFailedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedById: ctx.actorId,
        ...(pub.createdById ? {} : { createdById: ctx.actorId }),
      },
    });
    await syncLegacyFlag(tx, propertyId, "PUBLISHED", true, loaded.property.publishedAt == null);
    await writeEvent(tx, { propertyId, publicationId: pub.id, action: "PUBLISH", ok: true, state: "PUBLISHED", detail: "published", hash: evaluation.hash }, ctx);
    await audit(tx, "website_published", propertyId, ctx, { from: pub.status, to: "PUBLISHED", hash: evaluation.hash, sitemapIncluded });
    return { result: { status: "PUBLISHED", hash: evaluation.hash, url: evaluation.url, sitemapIncluded } as unknown as WebsiteResult, reference: loaded.property.reference };
  });
  if (out.result.status !== "PUBLISHED" || !out.reference) return out.result;
  return { ...out.result, revalidation: await revalidateWebsite([out.reference]) };
}

/**
 * Regenerates a live page's state after the property changed. Skips all work when
 * nothing a visitor can see has changed (unless `force`), so repeated presses are
 * cheap and cause no needless refreshes.
 */
export async function updateWebsite(propertyId: string, ctx: OperationContext, options: { force?: boolean } = {}): Promise<WebsiteResult> {
  const rules = await loadWebsiteRules();
  const out = await db().$transaction(async (tx) => {
    const loaded = await loadWebsiteContext(tx, propertyId, rules);
    const pub = loaded.publication ?? (await ensureWebsitePublication(tx, loaded.property));
    if (!isWebsiteLive(pub.status, pub.enabled)) throw conflict("Το ακίνητο δεν είναι δημοσιευμένο στον ιστότοπο· δημοσιεύστε το πρώτα.");

    const evaluation = evaluateWebsite({ ...loaded, publication: pub });
    if (evaluation.readiness.outcome !== "READY") {
      await writeEvent(tx, { propertyId, publicationId: pub.id, action: "UPDATE", ok: false, state: pub.status, detail: evaluation.readiness.blockers.join(" · "), errorCode: "VALIDATION_FAILED", hash: evaluation.hash }, ctx);
      return { result: { status: "BLOCKED", blockers: evaluation.readiness.blockers, warnings: evaluation.readiness.warnings } as WebsiteResult, reference: null as string | null };
    }
    if (!options.force && pub.status === "PUBLISHED" && pub.lastPayloadHash === evaluation.hash) {
      return { result: { status: "UNCHANGED", hash: evaluation.hash } as WebsiteResult, reference: null };
    }

    const now = new Date();
    const slug = await reconcileSlug(tx, pub, loaded.property.slug, ctx.actorId);
    const sitemapIncluded = sitemapEligibleNow(loaded, "PUBLISHED", true, pub.visibility, pub.noIndex);
    await tx.websitePublication.update({
      where: { id: pub.id },
      data: { status: "PUBLISHED", slug, canonicalUrl: evaluation.url, sitemapIncluded, lastGeneratedAt: now, lastPayloadHash: evaluation.hash, lastErrorCode: null, lastErrorMessage: null, updatedById: ctx.actorId },
    });
    await syncLegacyFlag(tx, propertyId, "PUBLISHED", true, false);
    await writeEvent(tx, { propertyId, publicationId: pub.id, action: "UPDATE", ok: true, state: "PUBLISHED", detail: options.force ? "regenerated (forced)" : "updated", hash: evaluation.hash }, ctx);
    await audit(tx, "website_updated", propertyId, ctx, { from: pub.lastPayloadHash, to: evaluation.hash, forced: options.force === true, sitemapIncluded });
    return { result: { status: "UPDATED", hash: evaluation.hash, url: evaluation.url, sitemapIncluded } as unknown as WebsiteResult, reference: loaded.property.reference };
  });
  if (out.result.status !== "UPDATED" || !out.reference) return out.result;
  return { ...out.result, revalidation: await revalidateWebsite([out.reference]) };
}

/** Takes the page off the website. Portal listings are not touched. */
export async function unpublishWebsite(propertyId: string, ctx: OperationContext): Promise<WebsiteResult> {
  const out = await db().$transaction(async (tx) => {
    // Taking a page down never evaluates readiness, so the office rules are not needed.
    const loaded = await loadWebsiteContext(tx, propertyId, {});
    const pub = loaded.publication ?? (await ensureWebsitePublication(tx, loaded.property));
    const onSite = isWebsiteLive(pub.status, pub.enabled) || pub.status === "PAUSED" || pub.status === "FAILED" || pub.status === "SOLD" || pub.status === "RENTED";
    if (!onSite) throw conflict("Το ακίνητο δεν είναι δημοσιευμένο στον ιστότοπο.");

    const now = new Date();
    await tx.websitePublication.update({
      where: { id: pub.id },
      data: { status: "UNPUBLISHED", enabled: false, visibility: "NOINDEX", noIndex: true, sitemapIncluded: false, lastUnpublishedAt: now, updatedById: ctx.actorId },
    });
    await tx.websiteSlugHistory.create({ data: { websitePublicationId: pub.id, propertyId, slug: pub.slug, kind: "UNPUBLISHED", changedById: ctx.actorId } });
    await syncLegacyFlag(tx, propertyId, "UNPUBLISHED", false, false);
    await writeEvent(tx, { propertyId, publicationId: pub.id, action: "UNPUBLISH", ok: true, state: "UNPUBLISHED", detail: "unpublished", hash: pub.lastPayloadHash }, ctx);
    await audit(tx, "website_unpublished", propertyId, ctx, { from: pub.status, to: "UNPUBLISHED" });
    return { reference: loaded.property.reference, url: publicUrlFor(loaded.property.reference), hash: pub.lastPayloadHash };
  });
  return { status: "UNPUBLISHED", hash: out.hash, url: out.url, sitemapIncluded: false, revalidation: await revalidateWebsite([out.reference]) };
}

// --- Reactions to other changes (called from the property lifecycle and the tag editor) ----------------------------------

async function applyChange(tx: Client, loaded: WebsiteContext, pub: WebsitePublication, change: NonNullable<WebsiteStateChange>, ctx: OperationContext): Promise<void> {
  const wasLive = isWebsiteLive(pub.status, pub.enabled);
  const visibility = change.status === "PUBLISHED" ? "PUBLIC" : "NOINDEX";
  const noIndex = change.status !== "PUBLISHED";
  const sitemapIncluded = sitemapEligibleNow(loaded, change.status, change.enabled, visibility, noIndex);
  const now = new Date();
  await tx.websitePublication.update({
    where: { id: pub.id },
    data: {
      status: change.status as WebsitePublicationStatus,
      enabled: change.enabled,
      visibility,
      noIndex,
      sitemapIncluded,
      ...(change.status === "UNPUBLISHED" || change.status === "ARCHIVED" ? { lastUnpublishedAt: now } : {}),
      updatedById: ctx.actorId,
    },
  });
  await syncLegacyFlag(tx, loaded.property.id, change.status, change.enabled, false);
  await writeEvent(tx, { propertyId: loaded.property.id, publicationId: pub.id, action: "STATUS_CHANGED", ok: true, state: change.status as WebsitePublicationStatus, detail: change.reason, hash: pub.lastPayloadHash }, ctx);
  await audit(tx, "website_state_changed", loaded.property.id, ctx, { from: pub.status, to: change.status, enabled: change.enabled, reason: change.reason, wasLive });
}

/**
 * The property's own status changed (the caller has already saved it, inside the
 * same transaction). Applies the public-site policy to the publication. Returns
 * the reference to refresh when the visible state changed, else null.
 */
export async function onPropertyStatusChanged(tx: Client, propertyId: string, ctx: OperationContext): Promise<string | null> {
  // Policy only (no readiness), so no settings are read inside the caller's transaction.
  const loaded = await loadWebsiteContext(tx, propertyId, {});
  const pub = loaded.publication ?? (await ensureWebsitePublication(tx, loaded.property));
  const blocked = loaded.tagCodes.some((c) => (WEBSITE_BLOCKING_TAGS as readonly string[]).includes(c));
  const change = websiteStateForProperty({ status: pub.status, enabled: pub.enabled }, loaded.property.status, blocked);
  if (!change) {
    // The compatibility flag must still agree with the publication (it may have been created just now).
    await syncLegacyFlag(tx, propertyId, pub.status, pub.enabled, false);
    return null;
  }
  await applyChange(tx, loaded, pub, change, ctx);
  return loaded.property.reference;
}

/** Tags changed: a blocking tag takes a live page down at once. Returns the reference to refresh, else null. */
export async function onTagsChanged(propertyId: string, ctx: OperationContext): Promise<string | null> {
  return db().$transaction(async (tx) => {
    const loaded = await loadWebsiteContext(tx, propertyId, {});
    const pub = loaded.publication;
    if (!pub) return null;
    const change = websiteStateForTags({ status: pub.status, enabled: pub.enabled }, loaded.tagCodes);
    if (!change) return null;
    await applyChange(tx, loaded, pub, change, ctx);
    return loaded.property.reference;
  });
}

/**
 * Permanent deletion of a property must dispose of its publication. The event
 * history is append-only and the database refuses to delete a property that has
 * events, so a property that was ever validated, previewed or published keeps its
 * history and cannot be removed for good; one that never was can.
 */
export async function disposeWebsitePublication(tx: Client, propertyId: string): Promise<void> {
  const events = await tx.channelPublicationEvent.count({ where: { propertyId } });
  if (events > 0) {
    throw conflict("Το ακίνητο έχει ιστορικό δημοσιεύσεων που διατηρείται και δεν διαγράφεται οριστικά. Παραμένει στα διαγραμμένα.");
  }
  // The slug history goes with the publication (ON DELETE CASCADE).
  await tx.websitePublication.deleteMany({ where: { propertyId } });
}
