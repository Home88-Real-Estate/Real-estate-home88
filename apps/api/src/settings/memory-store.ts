/**
 * In-memory SettingsStore for tests. Mirrors the Prisma store's contract,
 * including that masked audit entries never keep a value.
 */

import type { SettingsSectionKey } from "@home88/domain";
import type { SecretEnvelope } from "./secret-box";
import {
  toAuditRow,
  type RoleOverride,
  type SectionCommit,
  type SectionRecord,
  type SecretMeta,
  type SettingsAuditEntry,
  type SettingsStore,
} from "./store";

export type MemoryStore = SettingsStore & {
  sections: Map<string, SectionRecord>;
  secrets: Map<string, SecretEnvelope & { updatedAt: Date }>;
  audit: ReturnType<typeof toAuditRow>[];
  overrides: RoleOverride[];
  reads: number;
};

export function createMemorySettingsStore(): MemoryStore {
  const store: MemoryStore = {
    sections: new Map(),
    secrets: new Map(),
    audit: [],
    overrides: [],
    reads: 0,

    async readSection(section: SettingsSectionKey) {
      store.reads += 1;
      const record = store.sections.get(section);
      return record ? { ...record, values: { ...record.values } } : { values: {}, updatedAt: null, updatedById: null };
    },

    async commit(change: SectionCommit) {
      if (change.values) {
        const previous = store.sections.get(change.section)?.values ?? {};
        store.sections.set(change.section, {
          values: { ...previous, ...change.values },
          updatedAt: new Date(),
          updatedById: change.actorId,
        });
      }
      for (const { field, envelope } of change.putSecrets) {
        store.secrets.set(`${change.secretScope}:${field}`, { ...envelope, updatedAt: new Date() });
      }
      for (const field of change.deleteSecrets) store.secrets.delete(`${change.secretScope}:${field}`);
      store.audit.push(...change.audit.map(toAuditRow));
    },

    async secretMeta(scope: string): Promise<SecretMeta[]> {
      return [...store.secrets.entries()]
        .filter(([key]) => key.startsWith(`${scope}:`))
        .map(([key, v]) => ({ field: key.slice(scope.length + 1), keyId: v.keyId, updatedAt: v.updatedAt }));
    },

    async readSecret(scope: string, field: string) {
      const v = store.secrets.get(`${scope}:${field}`);
      return v ? { ciphertext: v.ciphertext, iv: v.iv, authTag: v.authTag, keyId: v.keyId } : null;
    },

    async roleOverrides() {
      return [...store.overrides];
    },

    async setRoleOverride(override: RoleOverride, _actorId: string, audit: SettingsAuditEntry) {
      store.overrides = store.overrides.filter((o) => !(o.role === override.role && o.permission === override.permission));
      store.overrides.push(override);
      store.audit.push(toAuditRow(audit));
    },

    async appendAudit(entries: SettingsAuditEntry[]) {
      store.audit.push(...entries.map(toAuditRow));
    },
  };
  return store;
}
