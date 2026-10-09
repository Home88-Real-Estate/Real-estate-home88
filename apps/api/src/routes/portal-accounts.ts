/**
 * Portal accounts and manual portal operations.
 *
 * Every route checks a `portals.*` permission on the server (the settings
 * permission matrix, not a hidden button). Credentials are accepted here and
 * sealed; no response ever contains one. Nothing in this file runs on a
 * schedule, on property save or in bulk.
 */

import { createHash } from "node:crypto";

import { can, PERMISSIONS, PORTAL_ACTIVATE_PRODUCTION, portalCatalogEntry } from "@home88/domain";
import { verifyPortalMediaToken } from "@home88/portals";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { RATE_LIMITS } from "@home88/validation";
import { z } from "zod";
import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import { assertSafeEndpointUrl } from "../lib/endpoint";
import { forbidden, notFound, conflict, HttpError, tooManyRequests } from "../lib/errors";
import { consume } from "../lib/rate-limit";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { accountView, storeCredentials } from "../lib/portal-accounts";
import { PORTAL_OPERATION_PERMISSION as PERMISSION_FOR, runPortalOperation, testPortalAccount, type PortalOperation } from "../lib/portal-actions";
import { portalMediaKey } from "../lib/portal-media";
import { db } from "../lib/prisma";
import { getObjectBytes, storageConfigured } from "../lib/storage";
import { requireRole } from "../plugins/auth";
import { settings } from "../settings";

const allow = (request: FastifyRequest, permission: string) => settings().can(request.auth!.user.role, permission);

async function require_(request: FastifyRequest, permission: string, message = "Δεν έχετε δικαίωμα για αυτή την ενέργεια."): Promise<void> {
  if (!(await allow(request, permission))) throw forbidden(message);
}

const environmentSchema = z.enum(["TEST", "PRODUCTION"]);
const accountName = z.string().trim().min(2).max(80);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const createSchema = z
  .object({
    accountName,
    environment: environmentSchema,
    agencyExternalId: optionalText(120),
    endpointUrl: z.string().trim().url().max(300).nullable().optional(),
  })
  .strict();

const patchSchema = z
  .object({
    accountName: accountName.optional(),
    agencyExternalId: optionalText(120),
    endpointUrl: z.string().trim().url().max(300).nullable().optional(),
    enabled: z.boolean().optional(),
    mockMode: z.enum(["success", "validation_error", "temporary_failure", "authentication_failure", "rate_limit", "duplicate", "timeout"]).nullable().optional(),
  })
  .strict();

const credentialsSchema = z
  .object({
    secrets: z.record(z.string().max(80), z.string().max(2000)).default({}),
    clear: z.array(z.string().max(80)).max(20).default([]),
  })
  .strict();

const operationSchema = z.object({ accountId: z.string().min(1), environment: environmentSchema }).strict();

function auditCtx(request: FastifyRequest) {
  return { actorId: request.auth!.user.id, ipAddress: clientIp(request), userAgent: userAgent(request) };
}

/**
 * Endpoint overrides never carry credentials, and never point at a private
 * network: https-only, no userinfo, and the host must not be a loopback,
 * private, link-local, CGNAT, metadata or otherwise-reserved address — as a
 * literal or after DNS resolution (all resolved addresses are checked).
 */
async function checkEndpoint(url: string | null | undefined): Promise<void> {
  if (!url) return;
  await assertSafeEndpointUrl(url);
}

export async function portalAccountRoutes(app: FastifyInstance): Promise<void> {
  // --- Accounts -----------------------------------------------------------------------------------------------------------------

  app.get("/portal-accounts", { preHandler: requireRole("AGENT") }, async (request) => {
    await require_(request, "portals.view");
    const showErrors = await allow(request, "portals.view_sensitive_errors");
    const rows = await db().portalAccount.findMany({ include: { portal: { select: { code: true, name: true, transport: true } } }, orderBy: [{ portal: { name: "asc" } }, { environment: "asc" }, { accountName: "asc" }] });
    const perms = Object.fromEntries(await Promise.all(["configure", "manage_credentials", "test_connection", "activate_production"].map(async (p) => [p, await allow(request, `portals.${p}`)] as const)));
    return { accounts: await Promise.all(rows.map((r) => accountView(r, showErrors))), permissions: perms };
  });

  app.post("/portals/:code/accounts", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    await require_(request, "portals.configure");
    const { code } = request.params as { code: string };
    const input = parseInput(createSchema, request.body);
    if (input.environment === "PRODUCTION") await require_(request, PORTAL_ACTIVATE_PRODUCTION, "Μόνο ο Super Admin μπορεί να δημιουργήσει λογαριασμό παραγωγής.");
    await checkEndpoint(input.endpointUrl);

    // A catalogued portal gets its (disabled) row on first use; an unknown code is not a portal.
    const entry = portalCatalogEntry(code);
    if (!entry) throw notFound("Το portal δεν υποστηρίζεται.");
    const portal =
      (await db().portal.findUnique({ where: { code: entry.code } })) ??
      (await db().portal.create({ data: { code: entry.code, name: entry.name, transport: entry.transport, enabled: false } }));
    const duplicate = await db().portalAccount.findUnique({ where: { portalId_accountName_environment: { portalId: portal.id, accountName: input.accountName, environment: input.environment } } });
    if (duplicate) throw conflict("Υπάρχει ήδη λογαριασμός με αυτό το όνομα και περιβάλλον.");

    const actor = request.auth!.user;
    const account = await db().portalAccount.create({
      data: { portalId: portal.id, accountName: input.accountName, environment: input.environment, agencyExternalId: input.agencyExternalId ?? null, endpointUrl: input.endpointUrl ?? null, createdById: actor.id, updatedById: actor.id },
      include: { portal: { select: { code: true, name: true, transport: true } } },
    });
    await writeAudit({ entity: "PORTAL", entityId: account.id, action: "PORTAL_ACCOUNT_UPDATED", changes: { portal: portal.code, event: "created", environment: account.environment, accountName: account.accountName }, ...auditCtx(request) });
    reply.status(201);
    return { account: await accountView(account, true) };
  });

  app.patch("/portal-accounts/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    await require_(request, "portals.configure");
    const { id } = request.params as { id: string };
    const input = parseInput(patchSchema, request.body);
    const account = await db().portalAccount.findUnique({ where: { id }, include: { portal: { select: { code: true, name: true, transport: true } } } });
    if (!account) throw notFound("Ο λογαριασμός portal δεν βρέθηκε.");
    if (account.environment === "PRODUCTION") await require_(request, PORTAL_ACTIVATE_PRODUCTION, "Οι αλλαγές σε λογαριασμό παραγωγής γίνονται μόνο από Super Admin.");
    if (input.endpointUrl !== undefined) await checkEndpoint(input.endpointUrl);
    if (input.mockMode && account.environment !== "TEST") throw conflict("Η λειτουργία mock επιτρέπεται μόνο σε λογαριασμό TEST.");

    // Switching an account on needs a connection test that succeeded.
    if (input.enabled === true && !account.enabled && account.lastConnectionTestStatus !== "OK") {
      throw conflict("Ο λογαριασμός ενεργοποιείται μόνο μετά από επιτυχή έλεγχο σύνδεσης.");
    }

    const settingsJson = { ...((account.settings ?? {}) as Record<string, unknown>) };
    if (input.mockMode !== undefined) {
      if (input.mockMode === null) delete settingsJson.mockMode;
      else settingsJson.mockMode = input.mockMode;
    }
    const actor = request.auth!.user;
    const updated = await db().portalAccount.update({
      where: { id },
      data: {
        ...(input.accountName !== undefined ? { accountName: input.accountName } : {}),
        ...(input.agencyExternalId !== undefined ? { agencyExternalId: input.agencyExternalId } : {}),
        ...(input.endpointUrl !== undefined ? { endpointUrl: input.endpointUrl } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled, status: input.enabled ? "ACTIVE" : "PAUSED" } : {}),
        settings: settingsJson as never,
        updatedById: actor.id,
      },
      include: { portal: { select: { code: true, name: true, transport: true } } },
    });
    await writeAudit({ entity: "PORTAL", entityId: id, action: "PORTAL_ACCOUNT_UPDATED", changes: { portal: account.portal.code, environment: account.environment, fields: Object.keys(input), enabled: updated.enabled }, ...auditCtx(request) });
    return { account: await accountView(updated, true) };
  });

  /** New or replaced credentials. The values are sealed and never echoed; the reply carries only the masked summary. */
  app.put("/portal-accounts/:id/credentials", { preHandler: requireRole("AGENT") }, async (request) => {
    await require_(request, "portals.manage_credentials");
    const { id } = request.params as { id: string };
    const input = parseInput(credentialsSchema, request.body);
    const account = await db().portalAccount.findUnique({ where: { id }, include: { portal: { select: { code: true, name: true, transport: true } } } });
    if (!account) throw notFound("Ο λογαριασμός portal δεν βρέθηκε.");
    if (account.environment === "PRODUCTION") await require_(request, PORTAL_ACTIVATE_PRODUCTION, "Τα διαπιστευτήρια παραγωγής αλλάζουν μόνο από Super Admin.");

    const changed = await storeCredentials(account, account.portal.code, input.secrets, input.clear, request.auth!.user.id);
    // New credentials have not been proven yet.
    if (changed.length > 0) await db().portalAccount.update({ where: { id }, data: { lastConnectionTestStatus: null, enabled: false, status: "CONFIGURED" } });
    // The audit records which fields changed, never a value.
    await writeAudit({ entity: "PORTAL", entityId: id, action: "PORTAL_ACCOUNT_UPDATED", changes: { portal: account.portal.code, environment: account.environment, event: "credentials_changed", fields: changed }, ...auditCtx(request) });
    const fresh = await db().portalAccount.findUniqueOrThrow({ where: { id }, include: { portal: { select: { code: true, name: true, transport: true } } } });
    return { account: await accountView(fresh, true) };
  });

  app.post("/portal-accounts/:id/test", { preHandler: requireRole("AGENT") }, async (request) => {
    await require_(request, "portals.test_connection");
    const { id } = request.params as { id: string };
    const body = parseInput(z.object({ environment: environmentSchema }).strict(), request.body);
    const account = await db().portalAccount.findUnique({ where: { id }, include: { portal: { select: { code: true } } } });
    if (!account) throw notFound("Ο λογαριασμός portal δεν βρέθηκε.");
    const result = await testPortalAccount(id, body.environment, account.portal.code, request.auth!.user.id, request.id);
    return result;
  });

  // --- Per-property operations ------------------------------------------------------------------------------------------------

  for (const op of ["preview", "publish", "update", "unpublish", "retry"] as const) {
    const operation = op.toUpperCase() as PortalOperation;
    app.post(`/properties/:id/portals/:code/${op}`, { preHandler: requireRole("AGENT") }, async (request) => {
      const actor = request.auth!.user;
      const { id, code } = request.params as { id: string; code: string };
      await require_(request, PERMISSION_FOR[operation]);
      const body = parseInput(operationSchema, request.body);

      // Changing anything on a portal needs the same standing as editing the property.
      const property = await db().property.findUnique({ where: { id }, select: { id: true, agentId: true, createdById: true } });
      if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");
      if (operation !== "PREVIEW" && !can(actor, PERMISSIONS.PROPERTY_UPDATE, property)) {
        throw forbidden("Μόνο ο ανατεθειμένος σύμβουλος, ο δημιουργός ή ένας υπεύθυνος μπορεί να δημοσιεύσει αυτό το ακίνητο.");
      }

      const result = await runPortalOperation({ propertyId: id, portalCode: code, accountId: body.accountId, environment: body.environment, operation, actorId: actor.id, requestId: request.id });
      // A property the portal would not take is a 422; a provider failure is a 502. The details a
      // person needs (reasons, error code, whether it is parked, the run) travel in `fields`, and the
      // CRM shows them. The portal's own wording is for those allowed to read it.
      if (result.status === "BLOCKED") {
        throw new HttpError(422, "portal_blocked", `Δεν δημοσιεύτηκε: ${result.reasons.join(" · ")}`, { reasons: result.reasons, runId: [result.runId] });
      }
      if (result.status === "FAILED") {
        const message = (await allow(request, "portals.view_sensitive_errors")) ? result.message : "Η ενέργεια απέτυχε. Ζητήστε από έναν υπεύθυνο να δει τις λεπτομέρειες.";
        throw new HttpError(502, "portal_failed", message, {
          runId: [result.runId],
          errorCode: [result.errorCode],
          needsReview: [String(result.needsReview)],
          nextRetryAt: result.nextRetryAt ? [result.nextRetryAt] : [],
        });
      }
      return result;
    });
  }

  /** Events for one property on one portal, newest first. Provider wording only for those allowed to read it. */
  app.get("/properties/:id/portals/:code/logs", { preHandler: requireRole("AGENT") }, async (request) => {
    await require_(request, "portals.view_sync_history");
    const { id, code } = request.params as { id: string; code: string };
    const showErrors = await allow(request, "portals.view_sensitive_errors");
    const portal = await db().portal.findUnique({ where: { code: code.toUpperCase() }, select: { id: true } });
    if (!portal) throw notFound("Το portal δεν βρέθηκε.");
    const logs = await db().portalSyncLog.findMany({ where: { portalId: portal.id, propertyId: id }, orderBy: { createdAt: "desc" }, take: 50 });
    const actors = await db().user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.actorId).filter((v): v is string => Boolean(v)))] } }, select: { id: true, firstName: true, lastName: true } });
    return {
      logs: logs.map((l) => ({
        id: l.id,
        runId: l.syncRunId,
        action: l.action,
        ok: l.ok,
        errorCode: l.errorCode,
        detail: l.ok || showErrors ? l.detail : "Η ενέργεια απέτυχε.",
        durationMs: l.durationMs,
        actor: actors.find((a) => a.id === l.actorId) ? `${actors.find((a) => a.id === l.actorId)!.firstName} ${actors.find((a) => a.id === l.actorId)!.lastName}`.trim() : null,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  });

  app.get("/portal-sync-runs", { preHandler: requireRole("AGENT") }, async (request) => {
    await require_(request, "portals.view_sync_history");
    const q = parseInput(z.object({ portal: z.string().max(40).optional(), property: z.string().max(40).optional() }).strict(), request.query);
    const showErrors = await allow(request, "portals.view_sensitive_errors");
    const portal = q.portal ? await db().portal.findUnique({ where: { code: q.portal.toUpperCase() }, select: { id: true } }) : null;
    const runs = await db().portalSyncRun.findMany({
      where: { ...(portal ? { portalId: portal.id } : {}), ...(q.property ? { propertyId: q.property } : {}) },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return { runs: runs.map((r) => ({ ...r, errorSummary: showErrors ? r.errorSummary : r.errorSummary ? "Η ενέργεια απέτυχε." : null })) };
  });

  // --- Photo delivery for portals ---------------------------------------------------------------------------------------

  /**
   * Anonymous by design: a portal has no session. The token is the authority and it is
   * narrow: one media item of one property for one portal, expiring. The media must still be
   * approved at the moment of the request; anything else is a plain 404 that does not say why.
   */
  // A wildcard, not a `:token` parameter: a signed token is longer than Fastify's default parameter limit.
  app.get("/portal-media/*", async (request, reply) => {
    const ip = clientIp(request);
    const token = ((request.params as { "*": string })["*"] ?? "").replace(/^\/+/, "");

    // Every refusal is the same plain 404, and failed attempts are counted per client, so the
    // route cannot be used to probe for tokens or to learn why one was refused.
    const miss = (): never => {
      const limit = consume(`portal-media-miss:${ip}`, RATE_LIMITS.portalMediaMiss);
      if (!limit.allowed) throw tooManyRequests();
      throw notFound();
    };
    if (!token || token.length > 600 || token.includes("/")) return miss();

    let verified;
    try {
      verified = verifyPortalMediaToken(token, portalMediaKey());
    } catch (error) {
      if (error instanceof HttpError) throw error; // no signing key configured: 503
      return miss();
    }
    if (!verified.ok) return miss();
    const { p, m, c } = verified.claims;

    const perToken = consume(`portal-media:${createHash("sha256").update(token).digest("hex").slice(0, 24)}`, RATE_LIMITS.portalMediaToken);
    if (!perToken.allowed) throw tooManyRequests();

    const row = await db().propertyMedia.findFirst({
      where: { id: m, propertyId: p, status: { in: ["approved", "published"] }, kind: { not: "DOCUMENT" } },
      select: { storageKey: true, previewKey: true, mimeType: true, byteSize: true },
    });
    const portal = await db().portal.findUnique({ where: { code: c }, select: { id: true } });
    if (!row || !portal || !storageConfigured(loadConfig())) return miss();
    // The portal must actually have an operation under way (or done) for this property.
    const listing = await db().portalListing.findUnique({ where: { portalId_propertyId: { portalId: portal.id, propertyId: p } }, select: { id: true } });
    if (!listing) return miss();

    // Vercel caps a response near 4.5 MB: serve the original when it fits, else the preview variant.
    const useOriginal = row.byteSize <= 4_000_000 || !row.previewKey;
    const key = useOriginal ? row.storageKey : row.previewKey!;
    const object = await getObjectBytes(key);
    if (!object) return miss();
    reply
      .header("content-type", useOriginal ? row.mimeType : "image/jpeg")
      .header("cache-control", "private, max-age=300")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return reply.send(object.bytes);
  });
}
