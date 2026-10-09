/**
 * The unified publication view and operations for one property.
 *
 * One panel, one set of rules: the website and every portal are channels of the
 * same property. This module only COMBINES existing services:
 *
 *   website  → lib/website-publication (the single writer of website state)
 *   portals  → lib/portal-overview (state, rules, accounts) for reading and
 *              lib/portal-actions (runPortalOperation) for preview, publish,
 *              update and unpublish, with the same permissions, audit, retry and
 *              provider boundary as the per-portal routes.
 *
 * Channels are independent. Each one is judged, authorised and run on its own; a
 * result for one never undoes another, and there is no shared transaction. The
 * server calculates every state, blocker and permitted action, and the screen
 * shows them as given.
 */

import {
  canPublishWebsite,
  can,
  isPublicStatus,
  isWebsiteLive,
  PERMISSIONS,
  websiteActionsFor,
  WEBSITE_BLOCKING_TAGS,
  WEBSITE_TAG_REASONS,
  type ChannelAccountChoice,
  type ChannelOperation,
  type ChannelRequest,
  type ChannelResult,
  type ChannelView,
  type PublicationsOperationResponse,
  type PublicationsPayload,
} from "@home88/domain";
import { resolvePortalProvider } from "./portal-accounts";

import { settings } from "../settings";
import { badRequest, forbidden, HttpError, notFound } from "./errors";
import { PORTAL_OPERATION_PERMISSION, runPortalOperation, NO_ADAPTER_MESSAGE, type OperationResult, type PortalOperation } from "./portal-actions";
import { loadPortalOverview } from "./portal-overview";
import { db } from "./prisma";
import {
  effectiveWebsiteStatus,
  evaluateWebsite,
  isPubliclyVisible,
  loadWebsiteContext,
  loadWebsiteRules,
  previewWebsite,
  publishWebsite,
  sitemapEligibleNow,
  unpublishWebsite,
  updateWebsite,
  validateWebsite,
  type OperationContext,
  type WebsiteResult,
} from "./website-publication";
import { revalidationMessage } from "./website-revalidate";

export const WEBSITE_CODE = "WEBSITE";

export type Viewer = { id: string; role: string };

const LIVE_PORTAL_STATES = ["PUBLISHED", "OUTDATED", "IN_FEED"];

// --- Reading -------------------------------------------------------------------------------------------------------------

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function websiteChannelView(propertyId: string, viewer: Viewer): Promise<{ channel: ChannelView; reference: string; status: string; listingType: string; scope: { agentId: string | null; createdById: string | null } }> {
  const ctx = await loadWebsiteContext(db(), propertyId, await loadWebsiteRules());
  const evaluation = evaluateWebsite(ctx);
  const pub = ctx.publication;
  const status = effectiveWebsiteStatus(pub, evaluation.hash);
  const enabled = pub?.enabled ?? false;
  const baseActions = websiteActionsFor(pub?.status ?? "DRAFT", enabled);
  const mayPublish = canPublishWebsite(viewer, ctx.property);
  const visible = isPubliclyVisible(ctx);
  const live = pub ? isWebsiteLive(pub.status, pub.enabled) : false;

  let note: string | null = null;
  if (live && !visible) {
    const tag = ctx.tagCodes.find((c) => (WEBSITE_BLOCKING_TAGS as readonly string[]).includes(c));
    note = tag
      ? `Δημοσιευμένο, αλλά δεν εμφανίζεται: ${WEBSITE_TAG_REASONS[tag]}`
      : !isPublicStatus(ctx.property.status)
        ? "Δημοσιευμένο, αλλά δεν εμφανίζεται ενώ το ακίνητο δεν είναι Ενεργό, Υπό προσφορά ή Δεσμευμένο."
        : "Δημοσιευμένο, αλλά η ορατότητα είναι ιδιωτική.";
  } else if (status === "SOLD" || status === "RENTED") {
    note = "Το ακίνητο έχει κλείσει· η σελίδα δεν εμφανίζεται. Επανέρχεται αν ξανανοίξει.";
  }

  const last = pub ? await db().channelPublicationEvent.findFirst({ where: { websitePublicationId: pub.id }, orderBy: { createdAt: "desc" }, select: { action: true, createdAt: true, triggeredById: true } }) : null;
  const actor = last?.triggeredById ? await db().user.findUnique({ where: { id: last.triggeredById }, select: { firstName: true, lastName: true } }) : null;

  const channel: ChannelView = {
    kind: "WEBSITE",
    code: WEBSITE_CODE,
    name: "Ιστότοπος HOME88",
    status,
    selected: enabled,
    readiness: evaluation.readiness.outcome,
    blockers: evaluation.readiness.blockers,
    warnings: evaluation.readiness.warnings,
    url: visible ? evaluation.url : null,
    externalId: null,
    lastSuccessAt: iso(pub?.lastGeneratedAt ?? pub?.lastPublishedAt),
    lastFailedAt: iso(pub?.lastFailedAt),
    lastAction: last?.action ?? null,
    lastActionAt: iso(last?.createdAt),
    lastActionBy: actor ? `${actor.firstName} ${actor.lastName}`.trim() : null,
    lastError: pub?.lastErrorMessage ?? null,
    needsReview: false,
    nextRetryAt: null,
    mock: false,
    operational: true,
    note,
    actions: { validate: true, preview: true, publish: baseActions.publish && mayPublish, update: baseActions.update && mayPublish, unpublish: baseActions.unpublish && mayPublish, retry: false },
    accountId: null,
    accounts: [],
    website: {
      visibility: pub?.visibility ?? "NOINDEX",
      noIndex: pub?.noIndex ?? true,
      // Derived now from the rules, never read from the stored column.
      sitemapIncluded: pub ? sitemapEligibleNow(ctx, pub.status, pub.enabled, pub.visibility, pub.noIndex) : false,
      contentChanged: Boolean(pub?.lastPayloadHash) && pub?.lastPayloadHash !== evaluation.hash,
      visible,
      seoTitle: pub?.seoTitle ?? null,
      seoDescription: pub?.seoDescription ?? null,
      lastPublishedAt: iso(pub?.lastPublishedAt),
      lastUnpublishedAt: iso(pub?.lastUnpublishedAt),
      hash: evaluation.hash,
      photoCount: evaluation.photoCount,
    },
  };
  return { channel, reference: ctx.property.reference, status: ctx.property.status, listingType: ctx.property.listingType, scope: { agentId: ctx.property.agentId, createdById: ctx.property.createdById } };
}

type OverviewRow = Awaited<ReturnType<typeof loadPortalOverview>>["portals"][number];

function portalChannelView(row: OverviewRow, perms: Record<string, boolean>, mayEdit: boolean): ChannelView {
  const accounts = row.accounts as ChannelAccountChoice[];
  const usable = accounts.filter((a) => a.providerKind !== "none");
  const operational = row.hasAdapter && usable.length > 0;
  const chosen = accounts.find((a) => a.id === row.portalAccountId) ?? usable.find((a) => a.enabled) ?? usable[0] ?? null;
  const live = LIVE_PORTAL_STATES.includes(row.state);

  let note: string | null = null;
  if (!row.hasAdapter) note = NO_ADAPTER_MESSAGE;
  else if (accounts.length === 0) note = "Δεν έχει ρυθμιστεί λογαριασμός για αυτό το portal.";
  else if (usable.length === 0) note = `Δεν υπάρχει διαθέσιμος πάροχος: ${NO_ADAPTER_MESSAGE.toLowerCase()}`;
  else if (chosen?.providerKind === "mock") note = "Λογαριασμός δοκιμής (mock): δεν γίνεται επικοινωνία με πραγματικό portal.";

  return {
    kind: "PORTAL",
    code: row.code,
    name: row.name,
    status: row.state,
    selected: row.outcome !== "NOT_SELECTED",
    readiness: !row.hasAdapter ? "NOT_CONFIGURED" : (row.outcome as ChannelView["readiness"]),
    blockers: row.reasons,
    warnings: row.warnings,
    url: row.externalUrl,
    externalId: row.externalId,
    lastSuccessAt: row.lastSuccessfulSyncAt,
    lastFailedAt: row.lastFailedAt,
    lastAction: row.lastAction,
    lastActionAt: row.lastActionAt,
    lastActionBy: row.lastActionBy,
    lastError: row.lastError,
    needsReview: row.needsReview,
    nextRetryAt: row.nextRetryAt,
    mock: chosen?.providerKind === "mock",
    operational,
    note,
    actions: {
      validate: true,
      preview: perms.preview === true && row.hasAdapter && accounts.length > 0,
      publish: operational && perms.publish === true && mayEdit && !live && row.state !== "FAILED",
      update: operational && perms.update === true && mayEdit && live,
      unpublish: operational && perms.unpublish === true && mayEdit && live,
      retry: operational && perms.retry === true && mayEdit && row.state === "FAILED",
    },
    accountId: row.portalAccountId,
    accounts,
  };
}

/** The whole panel for one property: authoritative, server-calculated, one call. */
export async function loadPublications(propertyId: string, viewer: Viewer): Promise<PublicationsPayload> {
  const website = await websiteChannelView(propertyId, viewer);
  const overview = await loadPortalOverview(propertyId, viewer.role);
  const mayEdit = can(viewer, PERMISSIONS.PROPERTY_UPDATE, website.scope);
  return {
    property: { id: propertyId, reference: website.reference, status: website.status, listingType: website.listingType },
    website: website.channel,
    portals: overview.portals.map((row) => portalChannelView(row, overview.permissions as Record<string, boolean>, mayEdit)),
    generatedAt: new Date().toISOString(),
  };
}

// --- Operating ----------------------------------------------------------------------------------------------------------------

const OPERATION_TO_PORTAL: Record<Exclude<ChannelOperation, "validate">, PortalOperation> = {
  preview: "PREVIEW",
  publish: "PUBLISH",
  update: "UPDATE",
  unpublish: "UNPUBLISH",
};

const WEBSITE_TEXT: Record<string, string> = {
  VALIDATED: "Ο έλεγχος ολοκληρώθηκε.",
  PREVIEWED: "Προεπισκόπηση της δημόσιας σελίδας.",
  BLOCKED: "Δεν δημοσιεύτηκε: το ακίνητο δεν πληροί τους όρους.",
  UNCHANGED: "Δεν υπάρχει αλλαγή στο περιεχόμενο· δεν χρειάζεται ενημέρωση.",
  PUBLISHED: "Δημοσιεύτηκε στον ιστότοπο.",
  UPDATED: "Η σελίδα ενημερώθηκε.",
  UNPUBLISHED: "Το ακίνητο αποσύρθηκε από τον ιστότοπο.",
};

function emptyResult(channel: string, kind: ChannelResult["kind"]): ChannelResult {
  return { channel, kind, ok: false, status: "", message: "", blockers: [], warnings: [], mock: false, url: null, externalId: null, hash: null, revalidation: null, preview: null, errorCode: null, needsReview: false };
}

function fromWebsite(r: WebsiteResult): ChannelResult {
  const base = { ...emptyResult(WEBSITE_CODE, "WEBSITE"), status: r.status, message: WEBSITE_TEXT[r.status] ?? r.status };
  switch (r.status) {
    case "VALIDATED":
      return { ...base, ok: r.ready, blockers: r.blockers, warnings: r.warnings, hash: r.hash, message: r.ready ? "Ο έλεγχος πέρασε." : "Υπάρχουν εκκρεμότητες πριν τη δημοσίευση." };
    case "PREVIEWED":
      return { ...base, ok: true, blockers: r.blockers, warnings: r.warnings, hash: r.hash, url: r.url, preview: { ready: r.ready, wouldChange: r.wouldChange, sitemapIncluded: r.sitemapIncluded, photoCount: r.photoCount, view: r.view } };
    case "BLOCKED":
      return { ...base, ok: false, blockers: r.blockers, warnings: r.warnings, errorCode: "VALIDATION_FAILED" };
    case "UNCHANGED":
      return { ...base, ok: true, hash: r.hash };
    default:
      return { ...base, ok: true, hash: r.hash, url: r.url, revalidation: r.revalidation, message: `${WEBSITE_TEXT[r.status]} ${revalidationMessage(r.revalidation)}` };
  }
}

async function accountMock(accountId: string | undefined): Promise<boolean> {
  if (!accountId) return false;
  const account = await db().portalAccount.findUnique({ where: { id: accountId }, include: { portal: true } });
  if (!account) return false;
  return resolvePortalProvider(account.portal, account)?.mock ?? false;
}

const PORTAL_TEXT: Record<string, string> = {
  PREVIEWED: "Προεπισκόπηση για το portal.",
  BLOCKED: "Δεν δημοσιεύτηκε: το ακίνητο δεν πληροί τους όρους του portal.",
  UNCHANGED: "Δεν υπάρχει αλλαγή· δεν στάλθηκε τίποτα.",
  PUBLISHED: "Δημοσιεύτηκε στο portal.",
  UPDATED: "Η αγγελία ενημερώθηκε στο portal.",
  UNPUBLISHED: "Η αγγελία αποσύρθηκε από το portal.",
  FAILED: "Η ενέργεια απέτυχε.",
};

function fromPortal(code: string, r: OperationResult, mock: boolean, showErrors: boolean): ChannelResult {
  const base = { ...emptyResult(code, "PORTAL"), status: r.status, mock, message: PORTAL_TEXT[r.status] ?? r.status };
  switch (r.status) {
    case "PREVIEWED":
      return { ...base, ok: true, blockers: r.reasons, warnings: r.warnings, hash: r.hash, externalId: r.externalId, mock: r.mock, preview: { outcome: r.outcome, providerErrors: r.providerErrors, contentType: r.contentType, body: r.body, mediaCount: r.mediaCount } };
    case "BLOCKED":
      return { ...base, ok: false, blockers: r.reasons, errorCode: "VALIDATION_FAILED" };
    case "UNCHANGED":
      return { ...base, ok: true, hash: r.hash };
    case "FAILED":
      return { ...base, ok: false, errorCode: r.errorCode, needsReview: r.needsReview, message: showErrors ? r.message : PORTAL_TEXT.FAILED! };
    default:
      return { ...base, ok: true, externalId: r.externalId, mock: r.mock };
  }
}

/**
 * Mirrors a portal operation into the unified, append-only event history. It is
 * a record of what the person did here, not part of the operation, so a failure
 * to write it is logged and never turns a successful operation into an error.
 */
async function mirrorPortalEvent(propertyId: string, code: string, operation: PortalOperation, result: OperationResult, ctx: OperationContext): Promise<void> {
  try {
    const portal = await db().portal.findUnique({ where: { code }, select: { id: true } });
    if (!portal) return;
    const listing = await db().portalListing.findUnique({ where: { portalId_propertyId: { portalId: portal.id, propertyId } }, select: { id: true, state: true, lastPayloadHash: true, externalId: true } });
    if (!listing) return; // no listing yet: nothing for the event to point at (the portal's own sync log has the attempt)
    const ok = result.status !== "BLOCKED" && result.status !== "FAILED";
    await db().channelPublicationEvent.create({
      data: {
        propertyId,
        channelType: "PORTAL",
        portalId: portal.id,
        portalListingId: listing.id,
        action: operation === "PREVIEW" ? "PREVIEW" : operation === "PUBLISH" ? "PUBLISH" : operation === "UPDATE" ? "UPDATE" : operation === "UNPUBLISH" ? "UNPUBLISH" : "ERROR",
        ok,
        portalState: listing.state,
        detail: result.status === "FAILED" ? result.message.slice(0, 500) : result.status === "BLOCKED" ? result.reasons.join(" · ").slice(0, 500) : result.status.toLowerCase(),
        errorCode: result.status === "FAILED" ? result.errorCode : result.status === "BLOCKED" ? "VALIDATION_FAILED" : null,
        needsReview: result.status === "FAILED" ? result.needsReview : false,
        payloadHash: "hash" in result ? result.hash : listing.lastPayloadHash,
        externalListingId: listing.externalId,
        triggeredById: ctx.actorId,
        requestId: ctx.requestId ?? null,
      },
    });
  } catch (error) {
    console.error("[home88:publications] portal event not recorded:", error instanceof Error ? error.message : "unknown");
  }
}

export type RunInput = {
  propertyId: string;
  operation: ChannelOperation;
  channels: ChannelRequest[];
  force?: boolean;
  viewer: Viewer;
  ctx: OperationContext;
};

/**
 * Runs one operation on the selected channels. Authorisation is decided for every
 * channel before anything runs (fail closed: one forbidden channel stops the whole
 * request), and then each channel runs on its own, in order, with its own result.
 */
export async function runPublicationOperation(input: RunInput): Promise<PublicationsOperationResponse> {
  const { propertyId, operation, viewer, ctx } = input;
  const property = await db().property.findUnique({ where: { id: propertyId }, select: { id: true, agentId: true, createdById: true } });
  if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");

  const codes = input.channels.map((c) => c.code.toUpperCase());
  if (new Set(codes).size !== codes.length) throw badRequest("Κάθε κανάλι μπορεί να εμφανίζεται μία φορά.", { channels: ["Διπλό κανάλι."] });
  const portalCodes = codes.filter((c) => c !== WEBSITE_CODE);
  if (portalCodes.length > 0) {
    const known = await db().portal.findMany({ where: { code: { in: portalCodes } }, select: { code: true } });
    const unknown = portalCodes.filter((c) => !known.some((k) => k.code === c));
    if (unknown.length > 0) throw notFound(`Το κανάλι δεν βρέθηκε: ${unknown.join(", ")}.`);
  }

  // --- Authorise everything first ---------------------------------------------------------------------------------------
  const mutating = operation === "publish" || operation === "update" || operation === "unpublish";
  const denied: string[] = [];
  for (const code of codes) {
    if (code === WEBSITE_CODE) {
      if (mutating && !canPublishWebsite(viewer, property)) denied.push("Ιστότοπος");
      continue;
    }
    const permission = operation === "validate" ? "portals.view" : PORTAL_OPERATION_PERMISSION[OPERATION_TO_PORTAL[operation]];
    const allowed = await settings().can(viewer.role, permission);
    const mayEdit = !mutating || can(viewer, PERMISSIONS.PROPERTY_UPDATE, property);
    if (!allowed || !mayEdit) denied.push(code);
  }
  if (denied.length > 0) {
    throw forbidden(`Δεν έχετε δικαίωμα για αυτή την ενέργεια στα κανάλια: ${denied.join(", ")}.`);
  }

  // --- Run each channel on its own ---------------------------------------------------------------------------------------
  const showErrors = await settings().can(viewer.role, "portals.view_sensitive_errors");
  const overview = portalCodes.length > 0 && operation === "validate" ? await loadPortalOverview(propertyId, viewer.role) : null;
  const results: ChannelResult[] = [];

  for (const request of input.channels) {
    const code = request.code.toUpperCase();
    try {
      if (code === WEBSITE_CODE) {
        const outcome =
          operation === "validate" ? await validateWebsite(propertyId, ctx)
          : operation === "preview" ? await previewWebsite(propertyId, ctx)
          : operation === "publish" ? await publishWebsite(propertyId, ctx)
          : operation === "update" ? await updateWebsite(propertyId, ctx, { force: input.force })
          : await unpublishWebsite(propertyId, ctx);
        results.push(fromWebsite(outcome));
        continue;
      }

      if (operation === "validate") {
        const row = overview!.portals.find((p) => p.code === code)!;
        const blockedOrNot = row.outcome === "BLOCKED";
        results.push({
          ...emptyResult(code, "PORTAL"),
          ok: row.outcome === "READY",
          status: row.outcome === "READY" ? "VALIDATED" : row.outcome === "BLOCKED" ? "BLOCKED" : "NOT_SELECTED",
          message: row.outcome === "READY" ? "Ο έλεγχος πέρασε." : blockedOrNot ? "Υπάρχουν εκκρεμότητες για αυτό το portal." : "Το ακίνητο δεν επιλέγεται για αυτό το portal.",
          blockers: row.reasons,
          warnings: row.warnings,
          mock: (row.accounts.find((a) => a.id === row.portalAccountId)?.providerKind ?? "none") === "mock",
        });
        continue;
      }

      if (!request.accountId) {
        results.push({ ...emptyResult(code, "PORTAL"), status: "REJECTED", errorCode: "account_required", message: "Επιλέξτε λογαριασμό portal.", blockers: ["Επιλέξτε λογαριασμό portal."] });
        continue;
      }
      const op = OPERATION_TO_PORTAL[operation];
      const mock = await accountMock(request.accountId);
      const outcome = await runPortalOperation({ propertyId, portalCode: code, accountId: request.accountId, environment: request.environment, operation: op, actorId: viewer.id, requestId: ctx.requestId ?? null });
      results.push(fromPortal(code, outcome, mock, showErrors));
      await mirrorPortalEvent(propertyId, code, op, outcome, ctx);
    } catch (error) {
      if (error instanceof HttpError) {
        results.push({ ...emptyResult(code, code === WEBSITE_CODE ? "WEBSITE" : "PORTAL"), status: "REJECTED", errorCode: error.code, message: error.message, blockers: [error.message] });
      } else {
        // Unexpected: record that this channel failed without taking the others down, and say nothing internal.
        console.error(`[home88:publications] ${code} ${operation} failed:`, error instanceof Error ? error.message : "unknown");
        results.push({ ...emptyResult(code, code === WEBSITE_CODE ? "WEBSITE" : "PORTAL"), status: "ERROR", errorCode: "internal_error", message: "Η ενέργεια δεν ολοκληρώθηκε. Δοκιμάστε ξανά." });
      }
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return { operation, ok: okCount === results.length, summary: { ok: okCount, failed: results.length - okCount }, results };
}
