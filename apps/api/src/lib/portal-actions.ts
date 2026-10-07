/**
 * Manual portal operations on one property: preview, publish, update,
 * unpublish and retry.
 *
 * This extends the existing portal subsystem rather than replacing it. The
 * decisions come from the same engine as the feed and the dry run (market
 * status, publication rule and tags, validation profile, taxonomy mapping), the
 * payload hash is the same content hash, failures are classified and backed off
 * by the same retry policy, and every step lands in portal_listings and
 * portal_sync_logs. What is new is the run record that groups one operation and
 * the provider call, which today is only ever the in-process mock: there is no
 * XE or Spitogatos client in this repository.
 *
 * Nothing here runs on a schedule, on property save or in bulk.
 */

import { createHash } from "node:crypto";

import type { Portal, PortalAccount, PortalListing } from "@home88/database";
import {
  checkEnvironment,
  decideRetry,
  evaluateCandidate,
  getAdapter,
  normaliseErrorCode,
  planSync,
  propertyContentHash,
  retryPolicyFromSettings,
  type PortalEnvironment,
  type PortalProperty,
  type ProviderCallContext,
  type ProviderResult,
} from "@home88/portals";
import { loadConfig } from "../config";
import { writeAudit } from "./audit";
import { HttpError, conflict, notFound } from "./errors";
import { loadCandidateContext, loadTagCodes } from "./portal-distribution";
import { mediaBase, toPortalProperty } from "./portal-map";
import { portalMediaUrl } from "./portal-media";
import { readCredentials, resolvePortalProvider } from "./portal-accounts";
import { buildContext } from "./portal-sync";
import { db } from "./prisma";

export type PortalOperation = "PREVIEW" | "PUBLISH" | "UPDATE" | "UNPUBLISH" | "RETRY";

export const NO_ADAPTER_MESSAGE = "Δεν υπάρχει ακόμη adapter για αυτό το portal.";

export type OperationInput = {
  propertyId: string;
  portalCode: string;
  accountId: string;
  /** Always supplied by the caller: an account is only ever used on the environment it names. */
  environment: PortalEnvironment | null | undefined;
  operation: PortalOperation;
  actorId: string;
  requestId?: string | null;
};

export type OperationResult =
  | {
      status: "PREVIEWED";
      runId: string;
      hash: string;
      externalId: string;
      outcome: string;
      reasons: string[];
      warnings: string[];
      providerErrors: string[];
      contentType: string;
      body: string;
      mock: boolean;
      mediaCount: number;
    }
  | { status: "BLOCKED"; runId: string; reasons: string[] }
  | { status: "UNCHANGED"; runId: string; hash: string }
  | { status: "PUBLISHED" | "UPDATED" | "UNPUBLISHED"; runId: string; listingId: string; externalId: string | null; mock: boolean; adopted?: boolean }
  | { status: "FAILED"; runId: string; listingId: string; errorCode: string; message: string; needsReview: boolean; nextRetryAt: string | null };

const BODY_PREVIEW_LIMIT = 6000;

function idempotencyKey(accountId: string, propertyId: string, hash: string): string {
  return createHash("sha256").update(`home88:${accountId}:${propertyId}:${hash}`).digest("hex").slice(0, 40);
}

async function finishRun(runId: string, counts: { created?: number; updated?: number; withdrawn?: number; failed?: number }, status: "SUCCEEDED" | "FAILED", errorSummary: string | null) {
  await db().portalSyncRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      totalListings: 1,
      createdCount: counts.created ?? 0,
      updatedCount: counts.updated ?? 0,
      withdrawnCount: counts.withdrawn ?? 0,
      failedCount: counts.failed ?? 0,
      errorSummary,
    },
  });
}

type Loaded = {
  portal: Portal;
  account: PortalAccount;
};

async function loadPortalAndAccount(portalCode: string, accountId: string, environment: PortalEnvironment | null | undefined): Promise<Loaded> {
  const portal = await db().portal.findUnique({ where: { code: portalCode.toUpperCase() } });
  if (!portal) throw notFound("Το portal δεν βρέθηκε.");
  const account = await db().portalAccount.findFirst({ where: { id: accountId, portalId: portal.id } });
  if (!account) throw notFound("Ο λογαριασμός portal δεν βρέθηκε.");
  const env = checkEnvironment(account.environment, environment);
  if (!env.ok) throw new HttpError(409, "environment_mismatch", env.reason);
  return { portal, account };
}

/** Operations that change something on the portal need an enabled, healthy account. */
function requireUsable(account: PortalAccount, operation: PortalOperation): void {
  if (operation === "PREVIEW") return;
  if (!account.enabled || account.status === "PAUSED") throw conflict("Ο λογαριασμός portal είναι ανενεργός.");
  if (account.status === "ERROR") throw conflict("Ο λογαριασμός portal έχει σφάλμα σύνδεσης· ελέγξτε τη σύνδεση πρώτα.");
}

export async function runPortalOperation(input: OperationInput): Promise<OperationResult> {
  const { portal, account } = await loadPortalAndAccount(input.portalCode, input.accountId, input.environment);
  const adapter = getAdapter(portal.code);
  const resolved = resolvePortalProvider(portal, account);
  if (!adapter || (input.operation !== "PREVIEW" && !resolved)) {
    throw new HttpError(409, "no_adapter", NO_ADAPTER_MESSAGE);
  }
  requireUsable(account, input.operation);

  const cfg = loadConfig();
  const base = mediaBase(cfg);
  const property = await db().property.findUnique({ where: { id: input.propertyId }, include: { media: true } });
  if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");

  const existing = await db().portalListing.findUnique({ where: { portalId_propertyId: { portalId: portal.id, propertyId: input.propertyId } } });
  if (existing?.portalAccountId && existing.portalAccountId !== account.id && existing.externalId && !["REMOVED", "NOT_PUBLISHED"].includes(existing.state)) {
    throw conflict("Το ακίνητο έχει ήδη αγγελία σε άλλον λογαριασμό αυτού του portal· αποσύρετέ την πρώτα.");
  }

  // The retry operation repeats whatever failed last.
  const operation = input.operation;
  let effective: Exclude<PortalOperation, "RETRY"> = input.operation === "RETRY" ? "PUBLISH" : input.operation;
  if (input.operation === "RETRY") {
    if (!existing || existing.state !== "FAILED") throw conflict("Δεν υπάρχει αποτυχημένη αποστολή προς επανάληψη.");
    effective = existing.lastAction === "UNPUBLISH" ? "UNPUBLISH" : existing.lastAction === "UPDATE" || existing.externalId ? "UPDATE" : "PUBLISH";
    if (effective === "UPDATE" && !existing.externalId) effective = "PUBLISH";
  }

  // State preconditions.
  const live = existing?.externalId && ["PUBLISHED", "OUTDATED", "IN_FEED"].includes(existing.state);
  if (effective === "PUBLISH" && live && input.operation !== "RETRY") throw conflict("Η αγγελία είναι ήδη δημοσιευμένη· χρησιμοποιήστε «Ενημέρωση».");
  const onPortal = Boolean(existing?.externalId) && !["REMOVED", "NOT_PUBLISHED"].includes(existing?.state ?? "NOT_PUBLISHED");
  if (effective === "UPDATE" && !onPortal) throw conflict("Η αγγελία δεν είναι δημοσιευμένη· δημοσιεύστε την πρώτα.");
  if (effective === "UNPUBLISH" && !onPortal) throw conflict("Δεν υπάρχει δημοσιευμένη αγγελία για απόσυρση.");
  // A person pressing "retry" overrides the automatic backoff (and a review hold) on purpose.

  // The content hash comes from the stable projection, so fresh media tokens never look like a change.
  // What is judged and rendered is the projection a portal would actually receive: media on scoped,
  // expiring links at the CRM's own https origin. A preview shows the shape of those links but mints none.
  const hashView = toPortalProperty(property, base);
  const hash = propertyContentHash(hashView);
  const forSending = input.operation !== "PREVIEW";
  const sendView: PortalProperty = toPortalProperty(property, base, (item) =>
    forSending
      ? portalMediaUrl({ propertyId: input.propertyId, mediaId: item.id, portalCode: portal.code })
      : `${cfg.CRM_URL.replace(/\/+$/, "")}${cfg.CRM_BASE_PATH}/api/portal-media/preview-${item.id.slice(-6)}`,
  );
  const tagCodes = (await loadTagCodes([input.propertyId])).get(input.propertyId) ?? [];
  const verdict = evaluateCandidate({ property: sendView, tagCodes }, await loadCandidateContext(portal));
  const payload = adapter.build(sendView, buildContext(portal, cfg));

  const run = await db().portalSyncRun.create({
    data: {
      portalId: portal.id,
      portalAccountId: account.id,
      propertyId: input.propertyId,
      trigger: input.operation === "RETRY" ? "RETRY" : "MANUAL",
      operation: operation,
      createdById: input.actorId,
      requestId: input.requestId ?? null,
    },
  });
  const mock = resolved?.mock ?? true;

  // --- Preview: judge and render, change nothing ----------------------------------------------------------
  if (input.operation === "PREVIEW") {
    const providerErrors = resolved?.provider.validateProperty?.(sendView).errors ?? [];
    await finishRun(run.id, {}, "SUCCEEDED", null);
    return {
      status: "PREVIEWED",
      runId: run.id,
      hash,
      externalId: payload.externalId,
      outcome: verdict.outcome,
      reasons: verdict.reasons,
      warnings: verdict.warnings.map((w) => w.message),
      providerErrors,
      contentType: payload.contentType,
      body: payload.body.length > BODY_PREVIEW_LIMIT ? `${payload.body.slice(0, BODY_PREVIEW_LIMIT)}\n…` : payload.body,
      mock,
      mediaCount: sendView.media.length,
    };
  }

  const act = effective as Exclude<typeof effective, "PREVIEW">;

  // --- Gate: publishing and updating need the property to qualify; withdrawing never does ----------------------------
  if (act !== "UNPUBLISH") {
    const providerErrors = resolved!.provider.validateProperty?.(sendView).errors ?? [];
    const reasons = [...(verdict.outcome === "READY" ? [] : verdict.reasons), ...providerErrors];
    if (reasons.length > 0) {
      await db().portalSyncLog.create({
        data: { portalId: portal.id, portalListingId: existing?.id ?? null, propertyId: input.propertyId, syncRunId: run.id, action: act === "UPDATE" ? "UPDATE" : "PUBLISH", ok: false, detail: reasons.join(" — ").slice(0, 500), errorCode: "VALIDATION_FAILED", actorId: input.actorId },
      });
      await finishRun(run.id, { failed: 1 }, "FAILED", reasons.join(" — ").slice(0, 500));
      await writeAudit({ entity: "PORTAL_LISTING", entityId: existing?.id ?? input.propertyId, action: "PORTAL_SYNC_FAILED", actorId: input.actorId, changes: { portal: portal.code, account: account.id, environment: account.environment, operation, runId: run.id, reason: "validation" } });
      return { status: "BLOCKED", runId: run.id, reasons };
    }
  }

  // An unchanged payload is not re-sent.
  const plan = planSync({ eligible: true, currentHash: hash, lastPayloadHash: existing?.lastPayloadHash ?? null, state: existing?.state ?? "NOT_PUBLISHED" });
  if (act === "UPDATE" && existing?.state === "PUBLISHED" && !plan.action && input.operation !== "RETRY") {
    await finishRun(run.id, {}, "SUCCEEDED", null);
    return { status: "UNCHANGED", runId: run.id, hash };
  }

  // --- Provider call -----------------------------------------------------------------------------------------------
  const provider = resolved!.provider;
  const credentials = await readCredentials(account.id);
  const ctx: ProviderCallContext = {
    environment: account.environment,
    idempotencyKey: idempotencyKey(account.id, input.propertyId, hash),
    agencyExternalId: account.agencyExternalId,
    endpointUrl: account.endpointUrl,
    credentials,
  };

  await db().portalListing.upsert({
    where: { portalId_propertyId: { portalId: portal.id, propertyId: input.propertyId } },
    create: { portalId: portal.id, propertyId: input.propertyId, portalAccountId: account.id, state: "PUBLISHING", lastAction: act, lastActionAt: new Date(), lastActionById: input.actorId },
    update: { portalAccountId: account.id, state: act === "UNPUBLISH" ? existing!.state : "PUBLISHING", lastAction: act, lastActionAt: new Date(), lastActionById: input.actorId },
  });

  const started = Date.now();
  let adopted = false;
  let result: ProviderResult;
  try {
    result = await callProvider(provider, act, sendView, existing, ctx);
    if (!result.ok && result.code === "DUPLICATE_LISTING" && result.externalId && act === "PUBLISH") {
      // The portal already holds this listing (an earlier attempt went through but its answer was lost).
      // Adopt its id and bring the content up to date rather than creating a second listing.
      adopted = true;
      result = await provider.updateProperty!(result.externalId, sendView, ctx);
    }
  } catch {
    result = { ok: false, code: "REMOTE_SERVER_ERROR", message: "Η επικοινωνία με το portal απέτυχε." };
  }
  const durationMs = Date.now() - started;
  const now = new Date();
  const syncAction = act === "UNPUBLISH" ? "REMOVE" : act === "UPDATE" ? "UPDATE" : "PUBLISH";

  if (result.ok) {
    const state = act === "UNPUBLISH" ? "REMOVED" : "PUBLISHED";
    const externalId = result.externalId ?? existing?.externalId ?? payload.externalId;
    const listing = await db().$transaction(async (tx) => {
      const saved = await tx.portalListing.update({
        where: { portalId_propertyId: { portalId: portal.id, propertyId: input.propertyId } },
        data: {
          state,
          externalId,
          externalUrl: result.ok ? (result.externalUrl ?? existing?.externalUrl ?? null) : null,
          lastPayloadHash: act === "UNPUBLISH" ? existing?.lastPayloadHash ?? null : hash,
          payloadSnapshot: act === "UNPUBLISH" ? undefined : { hash, externalId, mediaCount: sendView.media.length, environment: account.environment, mock, reference: sendView.reference },
          lastSyncedAt: now,
          lastSuccessfulSyncAt: now,
          lastError: null,
          lastErrorCode: null,
          needsReview: false,
          nextRetryAt: null,
          retryCount: 0,
        },
      });
      await tx.portalSyncLog.create({ data: { portalId: portal.id, portalListingId: saved.id, propertyId: input.propertyId, syncRunId: run.id, action: syncAction, ok: true, detail: `${mock ? "mock · " : ""}${act.toLowerCase()}${adopted ? " (adopted existing listing)" : ""}`, durationMs, actorId: input.actorId } });
      await tx.portalAccount.update({ where: { id: account.id }, data: { lastSuccessfulSyncAt: now, lastErrorCode: null, lastErrorMessage: null } });
      return saved;
    });
    await finishRun(run.id, act === "PUBLISH" ? { created: 1 } : act === "UPDATE" ? { updated: 1 } : { withdrawn: 1 }, "SUCCEEDED", null);
    await writeAudit({
      entity: "PORTAL_LISTING",
      entityId: listing.id,
      action: input.operation === "RETRY" ? "PORTAL_SYNC_RETRIED" : act === "PUBLISH" ? "PROPERTY_PUBLISHED" : act === "UPDATE" ? "PROPERTY_UPDATED" : "PROPERTY_UNPUBLISHED",
      actorId: input.actorId,
      changes: { portal: portal.code, account: account.id, environment: account.environment, mock, operation, act, runId: run.id, hash, state, externalId },
    });
    return { status: act === "PUBLISH" ? "PUBLISHED" : act === "UPDATE" ? "UPDATED" : "UNPUBLISHED", runId: run.id, listingId: listing.id, externalId, mock, adopted: adopted || undefined };
  }

  // --- Failure -------------------------------------------------------------------------------------------------------------
  const attempts = (existing?.retryCount ?? 0) + 1;
  const code = normaliseErrorCode(result.code) ?? "REMOTE_SERVER_ERROR";
  const retry = decideRetry({ attempts, errorCode: code, policy: retryPolicyFromSettings((portal.settings ?? {}) as Record<string, unknown>) });
  const needsReview = retry.action === "DEAD_LETTER";
  const authProblem = code === "AUTH_FAILED" || code === "INVALID_CREDENTIALS";
  const listing = await db().$transaction(async (tx) => {
    const saved = await tx.portalListing.update({
      where: { portalId_propertyId: { portalId: portal.id, propertyId: input.propertyId } },
      data: {
        // A failed withdrawal leaves the listing live on the portal; anything else is simply failed.
        state: "FAILED",
        lastError: result.ok ? null : result.message,
        lastErrorCode: code,
        lastFailedAt: now,
        retryCount: attempts,
        needsReview,
        nextRetryAt: retry.nextRetryAt,
      },
    });
    await tx.portalSyncLog.create({ data: { portalId: portal.id, portalListingId: saved.id, propertyId: input.propertyId, syncRunId: run.id, action: syncAction, ok: false, detail: `${result.message} (${retry.reason})`.slice(0, 500), errorCode: code, durationMs, actorId: input.actorId } });
    await tx.portalAccount.update({ where: { id: account.id }, data: { lastErrorCode: code, lastErrorMessage: result.message, ...(authProblem ? { status: "ERROR" as const } : {}) } });
    return saved;
  });
  await finishRun(run.id, { failed: 1 }, "FAILED", `${code}: ${result.message}`.slice(0, 500));
  await writeAudit({ entity: "PORTAL_LISTING", entityId: listing.id, action: "PORTAL_SYNC_FAILED", actorId: input.actorId, changes: { portal: portal.code, account: account.id, environment: account.environment, mock, operation, act, runId: run.id, errorCode: code, needsReview } });
  return { status: "FAILED", runId: run.id, listingId: listing.id, errorCode: code, message: result.message, needsReview, nextRetryAt: retry.nextRetryAt?.toISOString() ?? null };
}

async function callProvider(
  provider: NonNullable<ReturnType<typeof resolvePortalProvider>>["provider"],
  act: Exclude<PortalOperation, "RETRY" | "PREVIEW">,
  view: PortalProperty,
  existing: PortalListing | null,
  ctx: ProviderCallContext,
): Promise<ProviderResult> {
  if (act === "PUBLISH") return provider.publishProperty!(view, ctx);
  if (act === "UPDATE") return provider.updateProperty!(existing!.externalId!, view, ctx);
  return provider.unpublishProperty!(existing!.externalId!, ctx);
}

/** Connection test through the provider's own supported call. Creates nothing on the portal. */
export async function testPortalAccount(accountId: string, environment: PortalEnvironment | null | undefined, portalCode: string, actorId: string, requestId?: string | null) {
  const { portal, account } = await loadPortalAndAccount(portalCode, accountId, environment);
  const resolved = resolvePortalProvider(portal, account);
  if (!resolved) throw new HttpError(409, "no_adapter", NO_ADAPTER_MESSAGE);

  const run = await db().portalSyncRun.create({ data: { portalId: portal.id, portalAccountId: account.id, trigger: "MANUAL", operation: "CONNECTION_TEST", createdById: actorId, requestId: requestId ?? null } });
  await db().portalAccount.update({ where: { id: account.id }, data: { status: "TESTING" } });

  let result: ProviderResult;
  if (!resolved.mock && Object.keys(await readCredentials(account.id)).length === 0) {
    result = { ok: false, code: "INVALID_CREDENTIALS", message: "Δεν έχουν οριστεί διαπιστευτήρια για αυτόν τον λογαριασμό." };
  } else {
    try {
      result = await resolved.provider.testConnection!(account.environment === "PRODUCTION" ? "PRODUCTION" : "SANDBOX", {
        environment: account.environment,
        idempotencyKey: `test:${run.id}`,
        agencyExternalId: account.agencyExternalId,
        endpointUrl: account.endpointUrl,
        credentials: resolved.mock ? undefined : await readCredentials(account.id),
      });
    } catch {
      result = { ok: false, code: "REMOTE_SERVER_ERROR", message: "Η επικοινωνία με το portal απέτυχε." };
    }
  }

  const now = new Date();
  await db().portalAccount.update({
    where: { id: account.id },
    data: result.ok
      ? { status: account.enabled ? "ACTIVE" : "CONFIGURED", lastConnectionTestAt: now, lastConnectionTestStatus: "OK", lastErrorCode: null, lastErrorMessage: null, updatedById: actorId }
      : { status: "ERROR", lastConnectionTestAt: now, lastConnectionTestStatus: "FAILED", lastErrorCode: result.code, lastErrorMessage: result.message, updatedById: actorId },
  });
  await db().portalSyncRun.update({ where: { id: run.id }, data: { status: result.ok ? "SUCCEEDED" : "FAILED", finishedAt: now, errorSummary: result.ok ? null : `${result.code}: ${result.message}`.slice(0, 500) } });
  await writeAudit({ entity: "PORTAL", entityId: account.id, action: "PORTAL_CONNECTION_TESTED", actorId, changes: { portal: portal.code, environment: account.environment, mock: resolved.mock, ok: result.ok, errorCode: result.ok ? null : result.code, runId: run.id } });
  return result.ok ? { ok: true as const, mock: resolved.mock } : { ok: false as const, mock: resolved.mock, code: result.code, message: result.message };
}
