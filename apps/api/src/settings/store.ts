/**
 * Persistence for settings, behind an interface so the service can be tested
 * without a database (see memory-store.ts) and so no route touches the
 * settings tables directly.
 *
 * Each section is one typed table with a single "default" row. A commit
 * writes the section's values, its secret envelopes and the audit entries in
 * one transaction: a change is never saved without its audit record.
 */

import type { Prisma, PrismaClient } from "@home88/database";
import { settingsSection, storedFields, type SettingsSectionKey } from "@home88/domain";
import type { SecretEnvelope } from "./secret-box";

export type SectionRecord = {
  values: Record<string, unknown>;
  updatedAt: Date | null;
  updatedById: string | null;
};

export type SecretMeta = { field: string; keyId: string; updatedAt: Date };

export type SettingsAuditEntry = {
  section: string;
  field: string | null;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  masked: boolean;
  summary?: string | null;
  actorId: string | null;
  actorName: string | null;
  ipAddress: string | null;
};

export type SectionCommit = {
  section: SettingsSectionKey;
  /** Undefined when only secrets change. */
  values?: Record<string, unknown>;
  secretScope?: string;
  putSecrets: Array<{ field: string; envelope: SecretEnvelope }>;
  deleteSecrets: string[];
  audit: SettingsAuditEntry[];
  actorId: string;
};

export type RoleOverride = { role: string; permission: string; granted: boolean };

export interface SettingsStore {
  readSection(section: SettingsSectionKey): Promise<SectionRecord>;
  commit(change: SectionCommit): Promise<void>;
  secretMeta(scope: string): Promise<SecretMeta[]>;
  readSecret(scope: string, field: string): Promise<SecretEnvelope | null>;
  roleOverrides(): Promise<RoleOverride[]>;
  setRoleOverride(override: RoleOverride, actorId: string, audit: SettingsAuditEntry): Promise<void>;
  appendAudit(entries: SettingsAuditEntry[]): Promise<void>;
}

/** Prisma delegate behind each form section. Custom sections have none. */
const DELEGATES: Partial<Record<SettingsSectionKey, string>> = {
  company: "companySettings",
  legal: "companyLegalDetails",
  branding: "companyBranding",
  app: "appSettings",
  properties: "propertySettings",
  contacts: "contactSettings",
  requests: "requestSettings",
  commissions: "commissionSettings",
  calendar: "calendarSettings",
  mandates: "mandateSettings",
  email: "emailSettings",
  sms: "smsSettings",
  security: "securitySettings",
  privacy: "privacySettings",
  subscription: "subscriptionSettings",
};

export function hasSectionTable(section: SettingsSectionKey): boolean {
  return DELEGATES[section] !== undefined;
}

/** Company keys kept in their own row tables rather than columns. */
const SOCIAL_KEYS: Record<string, string> = {
  socialFacebook: "FACEBOOK",
  socialInstagram: "INSTAGRAM",
  socialYoutube: "YOUTUBE",
  socialLinkedin: "LINKEDIN",
  socialX: "X",
  socialPinterest: "PINTEREST",
  socialTiktok: "TIKTOK",
};
const PROFILE_KEYS: Record<string, string> = { profileEl: "el", profileEn: "en" };

const isDecimal = (v: unknown): v is { toNumber(): number } =>
  typeof v === "object" && v !== null && typeof (v as { toNumber?: unknown }).toNumber === "function";

/** Database value → plain JSON value the catalogue understands. */
function fromColumn(type: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (isDecimal(value)) return value.toNumber();
  if (value instanceof Date) return type === "date" ? value.toISOString().slice(0, 10) : value.toISOString();
  return value;
}

function toColumn(type: string, value: unknown): unknown {
  if (type === "date" && typeof value === "string") return new Date(`${value}T00:00:00.000Z`);
  return value;
}

type AnyDelegate = {
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  upsert(args: unknown): Promise<unknown>;
};

export function createPrismaSettingsStore(db: () => PrismaClient): SettingsStore {
  const delegate = (client: unknown, name: string) => (client as Record<string, AnyDelegate>)[name]!;

  return {
    async readSection(sectionKey) {
      const section = settingsSection(sectionKey);
      const name = DELEGATES[sectionKey];
      if (!section || !name) return { values: {}, updatedAt: null, updatedById: null };

      const row = await delegate(db(), name).findUnique({ where: { id: "default" } });
      const values: Record<string, unknown> = {};
      for (const field of storedFields(section)) {
        if (field.key in SOCIAL_KEYS || field.key in PROFILE_KEYS) continue;
        values[field.key] = fromColumn(field.type, row?.[field.key]);
      }
      let updatedAt = (row?.updatedAt as Date | undefined) ?? null;

      if (sectionKey === "company") {
        const [links, profiles] = await Promise.all([
          db().companySocialLink.findMany(),
          db().companyProfile.findMany(),
        ]);
        for (const [key, platform] of Object.entries(SOCIAL_KEYS)) {
          values[key] = links.find((l) => l.platform === platform)?.url ?? null;
        }
        for (const [key, locale] of Object.entries(PROFILE_KEYS)) {
          values[key] = profiles.find((p) => p.locale === locale)?.body ?? null;
        }
        for (const t of [...links, ...profiles].map((r) => r.updatedAt)) {
          if (!updatedAt || t > updatedAt) updatedAt = t;
        }
      }
      return { values, updatedAt, updatedById: (row?.updatedById as string | undefined) ?? null };
    },

    async commit(change) {
      const section = settingsSection(change.section);
      const name = DELEGATES[change.section];
      await db().$transaction(async (tx) => {
        if (change.values && section && name) {
          const data: Record<string, unknown> = { updatedById: change.actorId };
          for (const field of storedFields(section)) {
            if (!(field.key in change.values)) continue;
            if (field.key in SOCIAL_KEYS || field.key in PROFILE_KEYS) continue;
            data[field.key] = toColumn(field.type, change.values[field.key]);
          }
          await delegate(tx, name).upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });

          if (change.section === "company") {
            for (const [key, platform] of Object.entries(SOCIAL_KEYS)) {
              const url = change.values[key];
              if (typeof url === "string" && url) {
                await tx.companySocialLink.upsert({ where: { platform }, create: { platform, url }, update: { url } });
              } else {
                await tx.companySocialLink.deleteMany({ where: { platform } });
              }
            }
            for (const [key, locale] of Object.entries(PROFILE_KEYS)) {
              const body = change.values[key];
              if (typeof body === "string" && body) {
                await tx.companyProfile.upsert({ where: { locale }, create: { locale, body }, update: { body } });
              } else {
                await tx.companyProfile.deleteMany({ where: { locale } });
              }
            }
          }
        }

        if (change.secretScope) {
          for (const { field, envelope } of change.putSecrets) {
            const data = { ...envelope, updatedById: change.actorId };
            await tx.providerCredential.upsert({
              where: { scope_field: { scope: change.secretScope, field } },
              create: { scope: change.secretScope, field, ...data },
              update: data,
            });
          }
          if (change.deleteSecrets.length > 0) {
            await tx.providerCredential.deleteMany({
              where: { scope: change.secretScope, field: { in: change.deleteSecrets } },
            });
          }
        }

        if (change.audit.length > 0) await tx.settingsAuditLog.createMany({ data: change.audit.map(toAuditRow) });
      });
    },

    async secretMeta(scope) {
      const rows = await db().providerCredential.findMany({
        where: { scope },
        select: { field: true, keyId: true, updatedAt: true },
      });
      return rows;
    },

    async readSecret(scope, field) {
      const row = await db().providerCredential.findUnique({ where: { scope_field: { scope, field } } });
      return row ? { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, keyId: row.keyId } : null;
    },

    async roleOverrides() {
      const rows = await db().rolePermission.findMany({ select: { role: true, permission: true, granted: true } });
      return rows.map((r) => ({ role: r.role, permission: r.permission, granted: r.granted }));
    },

    async setRoleOverride(override, actorId, audit) {
      const role = override.role as Prisma.RolePermissionCreateInput["role"];
      await db().$transaction([
        db().rolePermission.upsert({
          where: { role_permission: { role, permission: override.permission } },
          create: { role, permission: override.permission, granted: override.granted, updatedById: actorId },
          update: { granted: override.granted, updatedById: actorId },
        }),
        db().settingsAuditLog.create({ data: toAuditRow(audit) }),
      ]);
    },

    async appendAudit(entries) {
      if (entries.length > 0) await db().settingsAuditLog.createMany({ data: entries.map(toAuditRow) });
    },
  };
}

export function toAuditRow(entry: SettingsAuditEntry): Prisma.SettingsAuditLogCreateManyInput {
  const json = (v: unknown) => (v === undefined || v === null ? undefined : (v as Prisma.InputJsonValue));
  return {
    section: entry.section,
    field: entry.field,
    action: entry.action,
    // Masked entries never carry a value, whatever the caller passed.
    oldValue: entry.masked ? undefined : json(entry.oldValue),
    newValue: entry.masked ? undefined : json(entry.newValue),
    masked: entry.masked,
    summary: entry.summary ?? null,
    actorId: entry.actorId,
    actorName: entry.actorName,
    ipAddress: entry.ipAddress,
  };
}
