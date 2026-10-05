/**
 * The one settings service.
 *
 * Every read of configuration, every save and every permission decision about
 * settings goes through here. A save runs in a fixed order:
 *
 *   1. authorise (server-side, from the role's effective grants)
 *   2. validate (schema generated from the catalogue)
 *   3. write values, secret envelopes and audit entries in one transaction
 *   4. drop the cached copy, so the next read sees the change
 *   5. return a sanitised view: never a secret, only whether one is set
 *
 * Values are cached per process for a short time; a save in this process is
 * visible immediately, other server instances pick it up within the TTL.
 */

import {
  DEFAULT_SETTINGS_GRANTS,
  RESERVED_PERMISSIONS,
  SETTINGS_PERMISSIONS,
  SETTINGS_SECTIONS,
  secretFieldKeys,
  settingsPermission,
  settingsSection,
  storedFields,
  type SettingsField,
  type SettingsSection,
  type SettingsSectionKey,
} from "@home88/domain";
import { permissionGrantSchema, sectionUpdateSchema } from "@home88/validation";
import { conflict, forbidden, HttpError, notFound } from "../lib/errors";
import { parseInput } from "../lib/http";
import { SecretUnreadableError, type SecretBox } from "./secret-box";
import { hasSectionTable, type SectionRecord, type SettingsAuditEntry, type SettingsStore } from "./store";

export type SettingsActor = { id: string; role: string; name: string };

export type SecretStatus = {
  configured: boolean;
  updatedAt: string | null;
  /** Stored, but written with a different (or no) encryption key: must be entered again. */
  needsReentry: boolean;
};

export type ProviderState = "configured" | "partial" | "not_configured" | "environment";

export type SectionView = {
  section: SettingsSectionKey;
  values: Record<string, unknown>;
  secrets: Record<string, SecretStatus>;
  updatedAt: string | null;
  updatedById: string | null;
  canManage: boolean;
  provider: ProviderState | null;
  encryptionReady: boolean;
};

const ROLES_WITH_GRANTS = ["ADMIN", "MANAGER", "AGENT", "MARKETING", "VIEWER"] as const;
const ALL_PERMISSIONS = new Set(SETTINGS_PERMISSIONS.map((p) => p.code));

const AUDIT_TEXT_LIMIT = 1000;

function effectiveValue(field: SettingsField, raw: unknown): unknown {
  if (field.readOnly) return field.default ?? null;
  if (Array.isArray(raw)) {
    return raw.length === 0 && Array.isArray(field.default) ? [...field.default] : raw;
  }
  if (raw === null || raw === undefined) return field.default ?? (field.type === "multiselect" || field.type === "weekdays" || field.type === "intList" ? [] : null);
  return raw;
}

export function effectiveValues(section: SettingsSection, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of storedFields(section)) out[field.key] = effectiveValue(field, raw[field.key]);
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function forAudit(value: unknown): unknown {
  if (typeof value === "string" && value.length > AUDIT_TEXT_LIMIT) return `${value.slice(0, AUDIT_TEXT_LIMIT)}…`;
  return value ?? null;
}

export type SettingsServiceDeps = {
  store: SettingsStore;
  /** Read at call time so a key added to the environment takes effect without a restart. */
  box: () => SecretBox | null;
  ttlMs?: number;
  now?: () => number;
  /** Whether outbound mail is configured through the environment (SMTP_HOST), as a fallback. */
  envSmtpConfigured?: () => boolean;
};

export function createSettingsService(deps: SettingsServiceDeps) {
  const ttl = deps.ttlMs ?? 30_000;
  const now = deps.now ?? Date.now;
  const envSmtp = deps.envSmtpConfigured ?? (() => Boolean(process.env.SMTP_HOST?.trim()));

  const sectionCache = new Map<string, { at: number; record: SectionRecord }>();
  let overridesCache: { at: number; value: Awaited<ReturnType<SettingsStore["roleOverrides"]>> } | null = null;

  async function record(key: SettingsSectionKey): Promise<SectionRecord> {
    const hit = sectionCache.get(key);
    if (hit && now() - hit.at < ttl) return hit.record;
    const fresh = await deps.store.readSection(key);
    sectionCache.set(key, { at: now(), record: fresh });
    return fresh;
  }

  function invalidate(key?: SettingsSectionKey): void {
    if (key) sectionCache.delete(key);
    else sectionCache.clear();
  }

  function requireSection(key: string): SettingsSection {
    const section = settingsSection(key);
    if (!section) throw notFound("Η ενότητα ρυθμίσεων δεν υπάρχει.");
    return section;
  }

  // --- Permissions -----------------------------------------------------------

  async function overrides() {
    if (overridesCache && now() - overridesCache.at < ttl) return overridesCache.value;
    const value = await deps.store.roleOverrides();
    overridesCache = { at: now(), value };
    return value;
  }

  async function grantsFor(role: string): Promise<Set<string>> {
    if (role === "SUPER_ADMIN") return new Set(ALL_PERMISSIONS);
    const granted = new Set(DEFAULT_SETTINGS_GRANTS[role] ?? []);
    for (const o of await overrides()) {
      if (o.role !== role || !ALL_PERMISSIONS.has(o.permission)) continue;
      if (o.granted) granted.add(o.permission);
      else granted.delete(o.permission);
    }
    for (const reserved of RESERVED_PERMISSIONS) granted.delete(reserved);
    return granted;
  }

  async function can(role: string, permission: string): Promise<boolean> {
    return (await grantsFor(role)).has(permission);
  }

  async function canView(role: string, key: SettingsSectionKey): Promise<boolean> {
    const grants = await grantsFor(role);
    return grants.has(settingsPermission(key, "view")) || grants.has(settingsPermission(key, "manage"));
  }

  async function assertView(actor: SettingsActor, key: SettingsSectionKey) {
    if (!(await canView(actor.role, key))) throw forbidden("Δεν έχετε πρόσβαση σε αυτή την ενότητα ρυθμίσεων.");
  }

  async function assertManage(actor: SettingsActor, key: SettingsSectionKey) {
    if (!(await can(actor.role, settingsPermission(key, "manage")))) {
      throw forbidden("Δεν έχετε δικαίωμα να αλλάξετε αυτή την ενότητα ρυθμίσεων.");
    }
  }

  // --- Secrets ---------------------------------------------------------------

  async function secretStatuses(section: SettingsSection): Promise<Record<string, SecretStatus>> {
    const keys = secretFieldKeys(section);
    if (keys.length === 0 || !section.secretScope) return {};
    const meta = await deps.store.secretMeta(section.secretScope);
    const box = deps.box();
    const out: Record<string, SecretStatus> = {};
    for (const key of keys) {
      const m = meta.find((x) => x.field === key);
      out[key] = {
        configured: Boolean(m),
        updatedAt: m ? m.updatedAt.toISOString() : null,
        needsReentry: Boolean(m) && (!box || m!.keyId !== box.keyId),
      };
    }
    return out;
  }

  /** Decrypted secret for server-side provider use only. Never returned by any route. */
  async function secret(scope: string, field: string): Promise<string | null> {
    const box = deps.box();
    if (!box) return null;
    const envelope = await deps.store.readSecret(scope, field);
    if (!envelope) return null;
    try {
      return box.open(scope, field, envelope);
    } catch (error) {
      if (error instanceof SecretUnreadableError) {
        console.error(`[home88:settings] secret ${scope}/${field} is unreadable; it must be entered again.`);
        return null;
      }
      throw error;
    }
  }

  // --- Provider state --------------------------------------------------------

  function providerState(key: SettingsSectionKey, v: Record<string, unknown>, s: Record<string, SecretStatus>): ProviderState | null {
    const has = (k: string) => v[k] !== null && v[k] !== undefined && v[k] !== "";
    const ok = (k: string) => Boolean(s[k]?.configured && !s[k]?.needsReentry);
    if (key === "email") {
      const smtpReady = v.mode === "SMTP" && has("smtpHost") && has("smtpPort") && has("fromEmail") && (!has("smtpUsername") || ok("smtpPassword"));
      if (smtpReady) return "configured";
      if (has("mode") || has("smtpHost") || has("fromEmail")) return "partial";
      return envSmtp() ? "environment" : "not_configured";
    }
    if (key === "sms") {
      if (has("provider") && has("senderName") && ok("apiKey")) return "configured";
      return has("provider") || has("senderName") ? "partial" : "not_configured";
    }
    if (key === "ai") {
      if (v.enabled === true && has("provider") && has("model") && ok("apiKey")) return "configured";
      return v.enabled === true || has("provider") || has("model") ? "partial" : "not_configured";
    }
    if (key === "mandates") {
      if (has("signatureProvider") && has("signatureLevel") && ok("signatureApiKey")) return "configured";
      return has("signatureProvider") ? "partial" : "not_configured";
    }
    return null;
  }

  // --- Reads -----------------------------------------------------------------

  /** Effective values of a section for server-side use (no authorisation: callers are trusted code). */
  async function config(key: SettingsSectionKey): Promise<Record<string, unknown>> {
    const section = requireSection(key);
    return effectiveValues(section, (await record(key)).values);
  }

  async function view(actor: SettingsActor, key: string): Promise<SectionView> {
    const section = requireSection(key);
    await assertView(actor, section.key);
    const rec = await record(section.key);
    const values = effectiveValues(section, rec.values);
    const secrets = await secretStatuses(section);
    return {
      section: section.key,
      values,
      secrets,
      updatedAt: rec.updatedAt ? rec.updatedAt.toISOString() : null,
      updatedById: rec.updatedById,
      canManage: await can(actor.role, settingsPermission(section.key, "manage")),
      provider: providerState(section.key, values, secrets),
      encryptionReady: deps.box() !== null,
    };
  }

  /** Sections the actor may open, for the navigation. */
  async function visible(actor: SettingsActor) {
    const grants = await grantsFor(actor.role);
    return SETTINGS_SECTIONS.filter(
      (s) => grants.has(settingsPermission(s.key, "view")) || grants.has(settingsPermission(s.key, "manage")),
    ).map((s) => ({
      key: s.key,
      title: s.title,
      navGroup: s.navGroup,
      canManage: grants.has(settingsPermission(s.key, "manage")),
    }));
  }

  // --- Writes ----------------------------------------------------------------

  async function update(actor: SettingsActor, key: string, body: unknown, meta: { ip: string | null }): Promise<SectionView> {
    const section = requireSection(key);
    if (!hasSectionTable(section.key)) throw notFound("Αυτή η ενότητα αποθηκεύεται από τη δική της οθόνη.");
    await assertManage(actor, section.key);
    const input = parseInput(sectionUpdateSchema(section.key), body) as {
      values: Record<string, unknown>;
      secrets?: Record<string, string>;
      clearSecrets?: string[];
    };

    const puts = Object.entries(input.secrets ?? {});
    const clears = (input.clearSecrets ?? []).filter((f) => !(f in (input.secrets ?? {})));
    const box = deps.box();
    if (puts.length > 0 && !box) {
      throw new HttpError(
        409,
        "encryption_key_missing",
        "Δεν μπορεί να αποθηκευτεί κωδικός ή κλειδί: ο server δεν έχει κλειδί κρυπτογράφησης (SETTINGS_ENCRYPTION_KEY). Τα υπόλοιπα πεδία μπορούν να αποθηκευτούν.",
      );
    }

    const before = await deps.store.readSection(section.key);
    const existingSecrets = await secretStatuses(section);
    const base = { section: section.key, actorId: actor.id, actorName: actor.name, ipAddress: meta.ip };
    const audit: SettingsAuditEntry[] = [];

    for (const field of storedFields(section)) {
      if (field.readOnly) continue;
      // Compared as the system sees them, so saving a form that only restates
      // defaults is not reported as a change.
      const oldValue = effectiveValue(field, before.values[field.key]);
      const newValue = effectiveValue(field, input.values[field.key]);
      if (same(oldValue, newValue)) continue;
      audit.push(
        field.sensitive
          ? { ...base, field: field.key, action: "UPDATED", masked: true, summary: `${field.label}: άλλαξε — η τιμή δεν καταγράφεται` }
          : { ...base, field: field.key, action: "UPDATED", masked: false, oldValue: forAudit(oldValue), newValue: forAudit(newValue), summary: field.label },
      );
    }
    const labelOf = (k: string) => section.fields.find((f) => f.key === k)?.label ?? k;
    for (const [field] of puts) {
      audit.push({
        ...base,
        field,
        action: existingSecrets[field]?.configured ? "SECRET_CHANGED" : "SECRET_SET",
        masked: true,
        summary: `${labelOf(field)}: ${existingSecrets[field]?.configured ? "άλλαξε" : "ορίστηκε"} — μυστική τιμή, δεν καταγράφεται`,
      });
    }
    for (const field of clears) {
      if (!existingSecrets[field]?.configured) continue;
      audit.push({ ...base, field, action: "SECRET_CLEARED", masked: true, summary: `${labelOf(field)}: αφαιρέθηκε` });
    }

    const valuesChanged = audit.some((a) => a.action === "UPDATED");
    if (audit.length > 0) {
      await deps.store.commit({
        section: section.key,
        values: valuesChanged || !before.updatedAt ? input.values : undefined,
        secretScope: section.secretScope,
        putSecrets: puts.map(([field, value]) => ({ field, envelope: box!.seal(section.secretScope!, field, value) })),
        deleteSecrets: clears,
        audit,
        actorId: actor.id,
      });
    }
    invalidate(section.key);
    return view(actor, section.key);
  }

  async function setPermission(actor: SettingsActor, body: unknown, meta: { ip: string | null }) {
    if (!(await can(actor.role, settingsPermission("permissions", "manage")))) {
      throw forbidden("Μόνο ο Super Admin αλλάζει δικαιώματα.");
    }
    const input = parseInput(permissionGrantSchema, body);
    if (!ALL_PERMISSIONS.has(input.permission)) throw notFound("Άγνωστο δικαίωμα.");
    if (RESERVED_PERMISSIONS.has(input.permission)) {
      throw conflict("Αυτό το δικαίωμα ανήκει μόνο στον Super Admin και δεν παραχωρείται.");
    }
    const was = (await grantsFor(input.role)).has(input.permission);
    if (was === input.granted) return matrix();
    await deps.store.setRoleOverride({ role: input.role, permission: input.permission, granted: input.granted }, actor.id, {
      section: "permissions",
      field: `${input.role}:${input.permission}`,
      action: input.granted ? "GRANTED" : "REVOKED",
      masked: false,
      oldValue: was,
      newValue: input.granted,
      summary: `${input.role}: ${SETTINGS_PERMISSIONS.find((p) => p.code === input.permission)?.label ?? input.permission}`,
      actorId: actor.id,
      actorName: actor.name,
      ipAddress: meta.ip,
    });
    overridesCache = null;
    return matrix();
  }

  async function matrix() {
    const grants: Record<string, string[]> = {};
    for (const role of ROLES_WITH_GRANTS) grants[role] = [...(await grantsFor(role))];
    return {
      roles: ["SUPER_ADMIN", ...ROLES_WITH_GRANTS],
      permissions: SETTINGS_PERMISSIONS.map((p) => ({ ...p, reserved: RESERVED_PERMISSIONS.has(p.code) })),
      grants: { SUPER_ADMIN: [...ALL_PERMISSIONS], ...grants },
      defaults: DEFAULT_SETTINGS_GRANTS,
    };
  }

  return {
    can,
    canView,
    grantsFor,
    assertView,
    assertManage,
    config,
    secret,
    secretStatuses,
    view,
    visible,
    update,
    setPermission,
    matrix,
    invalidate,
    /** For entity screens that write their own rows (tags, areas, portals). */
    appendAudit: (entries: SettingsAuditEntry[]) => deps.store.appendAudit(entries),
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
