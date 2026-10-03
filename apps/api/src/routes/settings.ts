/**
 * Settings API.
 *
 * Section values go through the settings service (authorise → validate →
 * write with audit → refresh cache → sanitised reply). The list screens
 * (tags, areas, portals, mandate templates, notifications) write their own
 * rows but use the same permission checks and the same audit trail.
 *
 * No response from this module ever contains a secret: secrets are accepted
 * on write and reported back only as configured / not configured.
 */

import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@home88/database";
import {
  childLevel,
  defaultNotificationEnabled,
  MANDATE_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  PORTAL_CATALOG,
  portalCatalogEntry,
  portalStatus,
  PUBLIC_COMPANY_FIELDS,
  SETTINGS_AUDIT_VIEW,
  settingsPermission,
  settingsSection,
  slugify,
  subscriptionCountdown,
  TEMPLATE_LOCALES,
  type AreaLevel,
  type SettingsSectionKey,
} from "@home88/domain";
import {
  areaMappingsSchema,
  areaSchema,
  areaUpdateSchema,
  mandateTemplateDraftSchema,
  mandateTypeSchema,
  notificationToggleSchema,
  portalUpdateSchema,
  propertyTagSchema,
  propertyTagUpdateSchema,
  templateLocaleSchema,
} from "@home88/validation";
import { capabilitiesFor, availableActions, getAdapter, parseConditions, type IntegrationStatus } from "@home88/portals";
import { loadConfig } from "../config";
import { badRequest, conflict, forbidden, HttpError, notFound, tooManyRequests, validationFailed } from "../lib/errors";
import { clientIp, parseInput } from "../lib/http";
import { sendMail } from "../lib/mailer";
import { db } from "../lib/prisma";
import { consume } from "../lib/rate-limit";
import { requireAuth } from "../plugins/auth";
import { portalProvider } from "../providers/portal";
import { calendarConfig, requestConfig, settings } from "../settings";
import { secretBoxFromEnv } from "../settings/secret-box";
import type { SettingsActor } from "../settings/service";
import type { SettingsAuditEntry } from "../settings/store";

function actorOf(request: FastifyRequest): SettingsActor {
  const user = request.auth!.user;
  return { id: user.id, role: user.role, name: `${user.firstName} ${user.lastName}`.trim() || user.email };
}

function auditBase(request: FastifyRequest, section: string) {
  const actor = actorOf(request);
  return { section, actorId: actor.id, actorName: actor.name, ipAddress: clientIp(request) };
}

async function requireView(request: FastifyRequest, key: SettingsSectionKey) {
  await settings().assertView(actorOf(request), key);
}

async function requireManage(request: FastifyRequest, key: SettingsSectionKey) {
  await settings().assertManage(actorOf(request), key);
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // --- Overview --------------------------------------------------------------

  app.get("/settings", async (request) => {
    const actor = actorOf(request);
    const service = settings();
    const sections = await service.visible(actor);
    if (sections.length === 0) throw forbidden("Δεν έχετε πρόσβαση στις ρυθμίσεις.");
    const canSee = (key: SettingsSectionKey) => sections.some((s) => s.key === key);

    // Public-site fields still empty: shown to administrators instead of
    // letting the website display placeholders.
    const missing: Array<{ section: string; key: string; label: string }> = [];
    if (canSee("company")) {
      for (const f of PUBLIC_COMPANY_FIELDS) {
        const values = await service.config(f.section);
        if (values[f.key] === null || values[f.key] === "") {
          const label = settingsSection(f.section)?.fields.find((x) => x.key === f.key)?.label ?? f.key;
          missing.push({ section: f.section, key: f.key, label });
        }
      }
    }

    let subscription: { status: unknown; plan: unknown; expiresAt: unknown; countdown: unknown } | null = null;
    if (canSee("subscription")) {
      const v = await service.config("subscription");
      subscription = { status: v.status, plan: v.plan, expiresAt: v.expiresAt, countdown: subscriptionCountdown(v.expiresAt as string | null) };
    }

    return {
      sections,
      missingPublicFields: missing,
      subscription,
      canViewHistory: await service.can(actor.role, SETTINGS_AUDIT_VIEW),
    };
  });

  /** Operational values every signed-in user's screens need (no business secrets). */
  app.get("/settings/runtime", async () => {
    const [calendar, requests] = await Promise.all([calendarConfig(), requestConfig()]);
    return { calendar, requests: { minMatchScore: requests.minMatchScore } };
  });

  // --- Form sections -------------------------------------------------------

  app.get("/settings/sections/:key", async (request) => {
    const { key } = request.params as { key: string };
    return settings().view(actorOf(request), key);
  });

  app.put("/settings/sections/:key", async (request) => {
    const { key } = request.params as { key: string };
    return settings().update(actorOf(request), key, request.body, { ip: clientIp(request) });
  });

  // --- Email test ----------------------------------------------------------

  app.post("/settings/email/test", async (request) => {
    await requireManage(request, "email");
    const actor = request.auth!.user;
    const limit = consume(`settings-email-test:${actor.id}`, { points: 5, durationSeconds: 900 });
    if (!limit.allowed) throw tooManyRequests("Πολλές δοκιμές. Δοκιμάστε ξανά σε λίγα λεπτά.");
    try {
      const result = await sendMail({
        to: actor.email,
        subject: "HOME88 CRM — δοκιμαστικό email",
        text: "Αυτό είναι δοκιμαστικό μήνυμα από τις Ρυθμίσεις → Email του HOME88 CRM. Αν το λάβατε, η αποστολή λειτουργεί.",
        category: "TRANSACTIONAL",
        template: "settings_email_test",
      });
      await settings().appendAudit([
        { ...auditBase(request, "email"), field: null, action: "TEST_SENT", masked: false, summary: result.ok && result.delivered ? "Δοκιμαστικό email στάλθηκε" : "Δοκιμαστικό email δεν στάλθηκε (χωρίς πάροχο)" },
      ]);
      if (!result.ok || !result.delivered) {
        return { delivered: false, message: "Δεν υπάρχει ενεργός πάροχος email: το μήνυμα καταγράφηκε αλλά δεν στάλθηκε." };
      }
      return { delivered: true, message: `Στάλθηκε δοκιμαστικό email στο ${actor.email}.` };
    } catch (error) {
      // Provider errors can echo host names or usernames; report the kind only.
      const code = (error as { code?: string }).code ?? (error instanceof Error ? error.name : "Error");
      return { delivered: false, message: `Η αποστολή απέτυχε (${code}). Ελέγξτε host, port, TLS και τα στοιχεία σύνδεσης.` };
    }
  });

  // --- Permissions ---------------------------------------------------------

  app.get("/settings/permissions", async (request) => {
    await requireView(request, "permissions");
    const matrix = await settings().matrix();
    const canManage = await settings().can(request.auth!.user.role, settingsPermission("permissions", "manage"));
    return { ...matrix, canManage };
  });

  app.put("/settings/permissions", async (request) => {
    const matrix = await settings().setPermission(actorOf(request), request.body, { ip: clientIp(request) });
    return { ...matrix, canManage: true };
  });

  // --- Audit trail -----------------------------------------------------------

  app.get("/settings/audit", async (request) => {
    const actor = actorOf(request);
    if (!(await settings().can(actor.role, SETTINGS_AUDIT_VIEW))) throw forbidden("Δεν έχετε πρόσβαση στο ιστορικό ρυθμίσεων.");
    const q = parseInput(
      z.object({
        section: z.string().regex(/^[a-z]+$/).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      }),
      request.query,
    );
    const where = q.section ? { section: q.section } : {};
    const take = 50;
    const [rows, total] = await Promise.all([
      db().settingsAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, take, skip: (q.page - 1) * take }),
      db().settingsAuditLog.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id,
        section: r.section,
        field: r.field,
        action: r.action,
        summary: r.summary,
        masked: r.masked,
        // Defence in depth: a masked row is never returned with a value.
        oldValue: r.masked ? null : r.oldValue,
        newValue: r.masked ? null : r.newValue,
        actorName: r.actorName,
        createdAt: r.createdAt.toISOString(),
      })),
      page: q.page,
      pages: Math.max(1, Math.ceil(total / take)),
      total,
    };
  });

  // --- Notifications ---------------------------------------------------------

  async function providerStates() {
    const actorless = settings();
    const email = await actorless.config("email");
    const sms = await actorless.config("sms");
    const emailSecrets = await actorless.secretStatuses(settingsSection("email")!);
    const smsSecrets = await actorless.secretStatuses(settingsSection("sms")!);
    const emailReady =
      (email.mode === "SMTP" && Boolean(email.smtpHost) && Boolean(email.fromEmail) && (!email.smtpUsername || (emailSecrets.smtpPassword?.configured && !emailSecrets.smtpPassword.needsReentry))) ||
      Boolean(process.env.SMTP_HOST?.trim());
    const smsReady = Boolean(sms.provider) && Boolean(smsSecrets.apiKey?.configured && !smsSecrets.apiKey.needsReentry);
    return { EMAIL: Boolean(emailReady), SMS: smsReady, CRM: true } as Record<string, boolean>;
  }

  app.get("/settings/notifications", async (request) => {
    await requireView(request, "notifications");
    const rows = await db().notificationSetting.findMany();
    const enabled: Record<string, Record<string, boolean>> = {};
    for (const e of NOTIFICATION_EVENTS) {
      enabled[e.value] = {};
      for (const c of NOTIFICATION_CHANNELS) {
        const row = rows.find((r) => r.event === e.value && r.channel === c.value);
        enabled[e.value]![c.value] = row ? row.enabled : defaultNotificationEnabled(c.value);
      }
    }
    return {
      events: NOTIFICATION_EVENTS,
      channels: NOTIFICATION_CHANNELS,
      enabled,
      available: await providerStates(),
      canManage: await settings().can(request.auth!.user.role, settingsPermission("notifications", "manage")),
    };
  });

  app.put("/settings/notifications", async (request) => {
    await requireManage(request, "notifications");
    const input = parseInput(notificationToggleSchema, request.body);
    if (input.enabled && !(await providerStates())[input.channel]) {
      throw conflict(input.channel === "EMAIL" ? "Ρυθμίστε πρώτα τον πάροχο email." : "Ρυθμίστε πρώτα τον πάροχο SMS.");
    }
    const actor = actorOf(request);
    const existing = await db().notificationSetting.findUnique({ where: { event_channel: { event: input.event, channel: input.channel } } });
    const was = existing ? existing.enabled : defaultNotificationEnabled(input.channel);
    await db().notificationSetting.upsert({
      where: { event_channel: { event: input.event, channel: input.channel } },
      create: { event: input.event, channel: input.channel, enabled: input.enabled, updatedById: actor.id },
      update: { enabled: input.enabled, updatedById: actor.id },
    });
    if (was !== input.enabled) {
      const eventLabel = NOTIFICATION_EVENTS.find((e) => e.value === input.event)?.label ?? input.event;
      await settings().appendAudit([
        { ...auditBase(request, "notifications"), field: `${input.event}:${input.channel}`, action: "UPDATED", masked: false, oldValue: was, newValue: input.enabled, summary: `${eventLabel} · ${input.channel}` },
      ]);
    }
    return { ok: true };
  });

  // --- Property tags ---------------------------------------------------------

  app.get("/settings/property-tags", async (request) => {
    await requireView(request, "properties");
    const tags = await db().propertyTag.findMany({ orderBy: [{ sortOrder: "asc" }, { labelEl: "asc" }] });
    return { data: tags };
  });

  app.post("/settings/property-tags", async (request) => {
    await requireManage(request, "properties");
    const input = parseInput(propertyTagSchema, request.body);
    if (await db().propertyTag.findUnique({ where: { code: input.code } })) {
      throw validationFailed("Ο κωδικός υπάρχει ήδη.", { code: ["Ο κωδικός υπάρχει ήδη."] });
    }
    const last = await db().propertyTag.aggregate({ _max: { sortOrder: true } });
    const tag = await db().propertyTag.create({ data: { ...input, sortOrder: (last._max.sortOrder ?? 0) + 10 } });
    await settings().appendAudit([{ ...auditBase(request, "properties"), field: `tag:${tag.code}`, action: "CREATED", masked: false, newValue: { labelEl: tag.labelEl, color: tag.color }, summary: `Ετικέτα ${tag.code}` }]);
    return { tag };
  });

  app.patch("/settings/property-tags/:id", async (request) => {
    await requireManage(request, "properties");
    const { id } = request.params as { id: string };
    const input = parseInput(propertyTagUpdateSchema, request.body);
    const before = await db().propertyTag.findUnique({ where: { id } });
    if (!before) throw notFound("Η ετικέτα δεν βρέθηκε.");
    const tag = await db().propertyTag.update({ where: { id }, data: input });
    const changed = Object.fromEntries(
      Object.entries(input).filter(([k, v]) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify(v)),
    );
    if (Object.keys(changed).length > 0) {
      const old = Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]]));
      await settings().appendAudit([{ ...auditBase(request, "properties"), field: `tag:${tag.code}`, action: "UPDATED", masked: false, oldValue: old, newValue: changed, summary: `Ετικέτα ${tag.code}` }]);
    }
    return { tag };
  });

  // --- Areas ---------------------------------------------------------------

  app.get("/settings/areas", async (request) => {
    await requireView(request, "areas");
    const areas = await db().area.findMany({
      orderBy: [{ sortOrder: "asc" }, { nameEl: "asc" }],
      include: { mappings: { select: { portalCode: true, externalId: true } } },
    });
    return {
      data: areas.map((a) => ({
        id: a.id,
        level: a.level,
        parentId: a.parentId,
        nameEl: a.nameEl,
        nameEn: a.nameEn,
        slug: a.slug,
        active: a.active,
        mappings: a.mappings,
      })),
      portals: PORTAL_CATALOG.map((p) => ({ code: p.code, name: p.name })),
    };
  });

  async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
    const root = base || "area";
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const clash = await db().area.findUnique({ where: { slug: candidate } });
      if (!clash || clash.id === excludeId) return candidate;
    }
    return `${root}-${randomBytes(3).toString("hex")}`;
  }

  app.post("/settings/areas", async (request) => {
    await requireManage(request, "areas");
    const input = parseInput(areaSchema, request.body);
    const parent = input.parentId ? await db().area.findUnique({ where: { id: input.parentId } }) : null;
    if (input.parentId && !parent) throw validationFailed("Ο γονέας δεν βρέθηκε.", { parentId: ["Ο γονέας δεν βρέθηκε."] });
    const expected = childLevel((parent?.level as AreaLevel | undefined) ?? null);
    if (expected !== input.level) {
      throw validationFailed("Λάθος επίπεδο για αυτόν τον γονέα.", {
        level: [parent ? "Επιλέξτε το επόμενο επίπεδο κάτω από τον γονέα." : "Χωρίς γονέα, το επίπεδο είναι Περιφέρεια."],
      });
    }
    const slug = input.slug ?? (await uniqueSlug(slugify(input.nameEn || input.nameEl)));
    if (input.slug && (await db().area.findUnique({ where: { slug: input.slug } }))) {
      throw validationFailed("Το slug χρησιμοποιείται ήδη.", { slug: ["Το slug χρησιμοποιείται ήδη."] });
    }
    const area = await db().area.create({
      data: { level: input.level, parentId: input.parentId, nameEl: input.nameEl, nameEn: input.nameEn, slug, active: input.active },
    });
    await settings().appendAudit([{ ...auditBase(request, "areas"), field: `area:${area.slug}`, action: "CREATED", masked: false, newValue: { nameEl: area.nameEl, level: area.level }, summary: `Περιοχή ${area.nameEl}` }]);
    return { area };
  });

  app.patch("/settings/areas/:id", async (request) => {
    await requireManage(request, "areas");
    const { id } = request.params as { id: string };
    const input = parseInput(areaUpdateSchema, request.body);
    const before = await db().area.findUnique({ where: { id } });
    if (!before) throw notFound("Η περιοχή δεν βρέθηκε.");
    if (input.parentId !== undefined && input.parentId !== before.parentId) {
      throw badRequest("Η μετακίνηση σε άλλο γονέα δεν υποστηρίζεται· δημιουργήστε νέα εγγραφή.");
    }
    if (input.slug && input.slug !== before.slug && (await db().area.findUnique({ where: { slug: input.slug } }))) {
      throw validationFailed("Το slug χρησιμοποιείται ήδη.", { slug: ["Το slug χρησιμοποιείται ήδη."] });
    }
    if (input.active === false && before.active) {
      const activeChildren = await db().area.count({ where: { parentId: id, active: true } });
      if (activeChildren > 0) throw conflict("Απενεργοποιήστε πρώτα τις υποπεριοχές της.");
    }
    const { parentId: _ignored, ...data } = input;
    const area = await db().area.update({ where: { id }, data });
    const changed = Object.fromEntries(
      Object.entries(data).filter(([k, v]) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify(v)),
    );
    if (Object.keys(changed).length > 0) {
      const old = Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]]));
      await settings().appendAudit([{ ...auditBase(request, "areas"), field: `area:${area.slug}`, action: "UPDATED", masked: false, oldValue: old, newValue: changed, summary: `Περιοχή ${area.nameEl}` }]);
    }
    return { area };
  });

  app.put("/settings/areas/:id/mappings", async (request) => {
    await requireManage(request, "areas");
    const { id } = request.params as { id: string };
    const input = parseInput(areaMappingsSchema, request.body);
    const area = await db().area.findUnique({ where: { id }, include: { mappings: true } });
    if (!area) throw notFound("Η περιοχή δεν βρέθηκε.");
    const codes = new Set(PORTAL_CATALOG.map((p) => p.code));
    for (const m of input.mappings) {
      if (!codes.has(m.portalCode)) throw validationFailed("Άγνωστο portal.", { mappings: [`Άγνωστο portal ${m.portalCode}.`] });
    }
    await db().$transaction([
      db().areaExternalMapping.deleteMany({ where: { areaId: id } }),
      ...input.mappings.map((m) => db().areaExternalMapping.create({ data: { areaId: id, portalCode: m.portalCode, externalId: m.externalId } })),
    ]);
    await settings().appendAudit([
      {
        ...auditBase(request, "areas"),
        field: `area:${area.slug}:mappings`,
        action: "UPDATED",
        masked: false,
        oldValue: area.mappings.map((m) => ({ portalCode: m.portalCode, externalId: m.externalId })),
        newValue: input.mappings,
        summary: `Αντιστοιχίσεις portals · ${area.nameEl}`,
      },
    ]);
    return { ok: true };
  });

  // --- Portals ---------------------------------------------------------------

  const portalScope = (code: string) => `portal:${code}`;

  async function portalView(code: string, includeFeedUrl: boolean) {
    const entry = portalCatalogEntry(code);
    if (!entry) throw notFound("Το portal δεν υποστηρίζεται.");
    const row = await db().portal.findUnique({ where: { code: entry.code }, include: { publicationRule: true } });
    const meta = await db().providerCredential.findMany({ where: { scope: portalScope(entry.code) }, select: { field: true, updatedAt: true } });
    const stored = ((row?.settings ?? {}) as Record<string, unknown>) ?? {};
    const values: Record<string, unknown> = {};
    for (const f of entry.fields) if (f.type !== "secret") values[f.key] = typeof stored[f.key] === "string" ? stored[f.key] : null;
    const secrets: Record<string, { configured: boolean; updatedAt: string | null }> = {};
    for (const f of entry.fields) {
      if (f.type !== "secret") continue;
      const m = meta.find((x) => x.field === f.key);
      secrets[f.key] = { configured: Boolean(m), updatedAt: m ? m.updatedAt.toISOString() : null };
    }
    const provider = portalProvider(entry.code)!;
    const missing = provider.missing(values, Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v.configured])));
    const configured = Boolean(row) && missing.length === 0;
    const adapter = getAdapter(entry.code);
    const feedToken = typeof stored.feedToken === "string" ? stored.feedToken : null;
    let feedUrl: string | null = null;
    if (includeFeedUrl && adapter && typeof adapter.compose === "function" && feedToken) {
      const cfg = loadConfig();
      feedUrl = `${cfg.CRM_URL.replace(/\/+$/, "")}${cfg.CRM_BASE_PATH}/api/feeds/${entry.code}?token=${feedToken}`;
    }
    const status = portalStatus({ configured, enabled: row?.enabled ?? false, lastSuccessAt: row?.lastSuccessAt, lastErrorAt: row?.lastErrorAt });
    // A portal with no adapter cannot do anything yet, whatever its fields say.
    const integrationStatus: IntegrationStatus = adapter ? status : "PLANNED";
    const capabilities = capabilitiesFor(entry.transport, adapter);
    return {
      code: entry.code,
      name: entry.name,
      transport: entry.transport,
      note: entry.note ?? null,
      capabilities,
      integrationStatus,
      actions: availableActions(capabilities, integrationStatus),
      fields: entry.fields,
      enabled: row?.enabled ?? false,
      values,
      secrets,
      missing,
      hasAdapter: provider.hasAdapter,
      feedUrl,
      status,
      lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      rule: row?.publicationRule
        ? {
            mode: row.publicationRule.mode,
            propertyTypes: row.publicationRule.propertyTypes,
            includeTags: row.publicationRule.includeTags,
            excludeTags: row.publicationRule.excludeTags,
            conditions: parseConditions(row.publicationRule.conditions),
          }
        : { mode: "NONE", propertyTypes: [], includeTags: [], excludeTags: [], conditions: null },
    };
  }

  app.get("/settings/portals", async (request) => {
    await requireView(request, "portals");
    const data = [];
    for (const p of PORTAL_CATALOG) {
      const v = await portalView(p.code, false);
      data.push({ code: v.code, name: v.name, transport: v.transport, enabled: v.enabled, status: v.integrationStatus, hasAdapter: v.hasAdapter, lastSuccessAt: v.lastSuccessAt, lastError: v.lastError });
    }
    return { data };
  });

  app.get("/settings/portals/:code", async (request) => {
    await requireView(request, "portals");
    const { code } = request.params as { code: string };
    const canManage = await settings().can(request.auth!.user.role, settingsPermission("portals", "manage"));
    const tags = await db().propertyTag.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { code: true, labelEl: true } });
    return { portal: await portalView(code, canManage), canManage, tags };
  });

  app.put("/settings/portals/:code", async (request) => {
    await requireManage(request, "portals");
    const { code } = request.params as { code: string };
    const entry = portalCatalogEntry(code);
    if (!entry) throw notFound("Το portal δεν υποστηρίζεται.");
    const input = parseInput(portalUpdateSchema, request.body);

    const fieldKeys = new Set(entry.fields.filter((f) => f.type !== "secret").map((f) => f.key));
    const secretKeys = new Set(entry.fields.filter((f) => f.type === "secret").map((f) => f.key));
    for (const k of Object.keys(input.values)) if (!fieldKeys.has(k)) throw badRequest(`Άγνωστο πεδίο ${k}.`);
    for (const k of [...Object.keys(input.secrets ?? {}), ...(input.clearSecrets ?? [])]) {
      if (!secretKeys.has(k)) throw badRequest(`Άγνωστο πεδίο ${k}.`);
    }
    const puts = Object.entries(input.secrets ?? {});
    const box = secretBoxFromEnv();
    if (puts.length > 0 && !box) {
      throw new HttpError(409, "encryption_key_missing", "Δεν μπορεί να αποθηκευτεί κωδικός ή κλειδί: λείπει το SETTINGS_ENCRYPTION_KEY από τον server.");
    }

    const before = await portalView(entry.code, false);
    const row = await db().portal.findUnique({ where: { code: entry.code } });
    const stored = { ...((row?.settings ?? {}) as Record<string, unknown>) };
    for (const [k, v] of Object.entries(input.values)) {
      if (v === null) delete stored[k];
      else stored[k] = v;
    }
    const adapter = getAdapter(entry.code);
    if (input.enabled && adapter && typeof adapter.compose === "function" && typeof stored.feedToken !== "string") {
      stored.feedToken = randomBytes(24).toString("base64url");
    }

    // Enabling needs every required field, counting secrets being set now.
    const secretState = Object.fromEntries(
      Object.entries(before.secrets).map(([k, v]) => [k, (v.configured || k in (input.secrets ?? {})) && !(input.clearSecrets ?? []).includes(k)]),
    );
    const missing = portalProvider(entry.code)!.missing(stored, secretState);
    if (input.enabled && missing.length > 0) {
      throw validationFailed(`Για ενεργοποίηση συμπληρώστε: ${missing.join(", ")}.`);
    }

    const actor = actorOf(request);
    const base = auditBase(request, "portals");
    const audit: SettingsAuditEntry[] = [];
    if (before.enabled !== input.enabled) {
      audit.push({ ...base, field: `${entry.code}:enabled`, action: "UPDATED", masked: false, oldValue: before.enabled, newValue: input.enabled, summary: `${entry.name}: ${input.enabled ? "ενεργοποιήθηκε" : "απενεργοποιήθηκε"}` });
    }
    for (const [k, v] of Object.entries(input.values)) {
      if ((before.values[k] ?? null) !== v) {
        audit.push({ ...base, field: `${entry.code}:${k}`, action: "UPDATED", masked: false, oldValue: before.values[k] ?? null, newValue: v, summary: `${entry.name}: ${entry.fields.find((f) => f.key === k)?.label ?? k}` });
      }
    }
    for (const [k] of puts) {
      audit.push({ ...base, field: `${entry.code}:${k}`, action: before.secrets[k]?.configured ? "SECRET_CHANGED" : "SECRET_SET", masked: true, summary: `${entry.name}: ${entry.fields.find((f) => f.key === k)?.label ?? k} ενημερώθηκε — μυστική τιμή` });
    }
    for (const k of input.clearSecrets ?? []) {
      if (before.secrets[k]?.configured && !(k in (input.secrets ?? {}))) {
        audit.push({ ...base, field: `${entry.code}:${k}`, action: "SECRET_CLEARED", masked: true, summary: `${entry.name}: ${entry.fields.find((f) => f.key === k)?.label ?? k} αφαιρέθηκε` });
      }
    }
    if (JSON.stringify(before.rule) !== JSON.stringify(input.rule)) {
      audit.push({ ...base, field: `${entry.code}:rule`, action: "UPDATED", masked: false, oldValue: before.rule, newValue: input.rule, summary: `${entry.name}: κανόνας δημοσίευσης` });
    }

    await db().$transaction(async (tx) => {
      const portal = await tx.portal.upsert({
        where: { code: entry.code },
        create: { code: entry.code, name: entry.name, transport: entry.transport, enabled: input.enabled, settings: stored as object },
        update: { enabled: input.enabled, settings: stored as object, transport: entry.transport },
      });
      const { conditions, ...ruleFields } = input.rule;
      const conditionsJson = conditions ? (conditions as Prisma.InputJsonValue) : Prisma.DbNull;
      await tx.portalPublicationRule.upsert({
        where: { portalId: portal.id },
        create: { portalId: portal.id, ...ruleFields, conditions: conditionsJson, updatedById: actor.id },
        update: { ...ruleFields, conditions: conditionsJson, updatedById: actor.id },
      });
      for (const [field, value] of puts) {
        const envelope = box!.seal(portalScope(entry.code), field, value);
        await tx.providerCredential.upsert({
          where: { scope_field: { scope: portalScope(entry.code), field } },
          create: { scope: portalScope(entry.code), field, ...envelope, updatedById: actor.id },
          update: { ...envelope, updatedById: actor.id },
        });
      }
      const clears = (input.clearSecrets ?? []).filter((k) => !(k in (input.secrets ?? {})));
      if (clears.length > 0) await tx.providerCredential.deleteMany({ where: { scope: portalScope(entry.code), field: { in: clears } } });
    });
    if (audit.length > 0) await settings().appendAudit(audit);

    return { portal: await portalView(entry.code, true), canManage: true };
  });

  // --- Mandate templates ---------------------------------------------------

  app.get("/settings/mandates/templates", async (request) => {
    await requireView(request, "mandates");
    const templates = await db().mandateTemplate.findMany({
      include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, checksum: true, notes: true, createdAt: true, activatedAt: true, retiredAt: true } } },
    });
    const data = MANDATE_TYPES.flatMap((t) =>
      TEMPLATE_LOCALES.map((l) => {
        const tpl = templates.find((x) => x.type === t.value && x.locale === l.value);
        return {
          type: t.value,
          typeLabel: t.label,
          locale: l.value,
          localeLabel: l.label,
          versions: (tpl?.versions ?? []).map((v) => ({
            ...v,
            createdAt: v.createdAt.toISOString(),
            activatedAt: v.activatedAt?.toISOString() ?? null,
            retiredAt: v.retiredAt?.toISOString() ?? null,
          })),
        };
      }),
    );
    return { data, canManage: await settings().can(request.auth!.user.role, settingsPermission("mandates", "manage")) };
  });

  app.get("/settings/mandates/versions/:id", async (request) => {
    await requireView(request, "mandates");
    const { id } = request.params as { id: string };
    const version = await db().mandateTemplateVersion.findUnique({ where: { id }, include: { template: true } });
    if (!version) throw notFound("Η έκδοση δεν βρέθηκε.");
    return {
      version: {
        id: version.id,
        type: version.template.type,
        locale: version.template.locale,
        version: version.version,
        status: version.status,
        body: version.body,
        checksum: version.checksum,
        notes: version.notes,
        createdAt: version.createdAt.toISOString(),
        activatedAt: version.activatedAt?.toISOString() ?? null,
      },
    };
  });

  app.post("/settings/mandates/templates/:type/:locale/versions", async (request) => {
    await requireManage(request, "mandates");
    const params = request.params as { type: string; locale: string };
    const type = parseInput(mandateTypeSchema, params.type);
    const locale = parseInput(templateLocaleSchema, params.locale);
    const input = parseInput(mandateTemplateDraftSchema, request.body);
    const actor = actorOf(request);
    const version = await db().$transaction(async (tx) => {
      const template = await tx.mandateTemplate.upsert({ where: { type_locale: { type, locale } }, create: { type, locale }, update: {} });
      const draft = await tx.mandateTemplateVersion.findFirst({ where: { templateId: template.id, status: "DRAFT" } });
      if (draft) throw conflict("Υπάρχει ήδη πρόχειρη έκδοση. Επεξεργαστείτε ή ενεργοποιήστε εκείνη.");
      const last = await tx.mandateTemplateVersion.aggregate({ where: { templateId: template.id }, _max: { version: true } });
      return tx.mandateTemplateVersion.create({
        data: { templateId: template.id, version: (last._max.version ?? 0) + 1, status: "DRAFT", body: input.body, checksum: sha256(input.body), notes: input.notes, createdById: actor.id },
      });
    });
    await settings().appendAudit([
      { ...auditBase(request, "mandates"), field: `template:${type}:${locale}`, action: "VERSION_CREATED", masked: false, newValue: { version: version.version, checksum: version.checksum }, summary: `Πρόχειρη έκδοση ${version.version}` },
    ]);
    return { version: { id: version.id, version: version.version, status: version.status } };
  });

  app.patch("/settings/mandates/versions/:id", async (request) => {
    await requireManage(request, "mandates");
    const { id } = request.params as { id: string };
    const input = parseInput(mandateTemplateDraftSchema, request.body);
    const version = await db().mandateTemplateVersion.findUnique({ where: { id }, include: { template: true } });
    if (!version) throw notFound("Η έκδοση δεν βρέθηκε.");
    if (version.status !== "DRAFT") throw conflict("Μόνο πρόχειρη έκδοση αλλάζει. Για αλλαγή σε ενεργό κείμενο δημιουργήστε νέα έκδοση.");
    const updated = await db().mandateTemplateVersion.update({ where: { id }, data: { body: input.body, checksum: sha256(input.body), notes: input.notes } });
    await settings().appendAudit([
      { ...auditBase(request, "mandates"), field: `template:${version.template.type}:${version.template.locale}`, action: "VERSION_EDITED", masked: false, oldValue: { checksum: version.checksum }, newValue: { checksum: updated.checksum }, summary: `Πρόχειρη έκδοση ${version.version}` },
    ]);
    return { ok: true };
  });

  app.post("/settings/mandates/versions/:id/activate", async (request) => {
    await requireManage(request, "mandates");
    const { id } = request.params as { id: string };
    const actor = actorOf(request);
    const version = await db().mandateTemplateVersion.findUnique({ where: { id }, include: { template: true } });
    if (!version) throw notFound("Η έκδοση δεν βρέθηκε.");
    if (version.status !== "DRAFT") throw conflict("Ενεργοποιείται μόνο πρόχειρη έκδοση.");
    const at = new Date();
    await db().$transaction([
      db().mandateTemplateVersion.updateMany({ where: { templateId: version.templateId, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: at } }),
      db().mandateTemplateVersion.update({ where: { id }, data: { status: "ACTIVE", activatedAt: at, activatedById: actor.id } }),
    ]);
    await settings().appendAudit([
      { ...auditBase(request, "mandates"), field: `template:${version.template.type}:${version.template.locale}`, action: "VERSION_ACTIVATED", masked: false, newValue: { version: version.version, checksum: version.checksum }, summary: `Ενεργή η έκδοση ${version.version}` },
    ]);
    return { ok: true };
  });
}
