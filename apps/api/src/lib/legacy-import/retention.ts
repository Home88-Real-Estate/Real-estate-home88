/**
 * Explicit, operator-controlled retention policy for quarantined legacy imports.
 * No fallback duration is provided: an unset or invalid setting disables intake
 * and purge alike, rather than silently choosing a legal/business retention term.
 */
export const LEGACY_IMPORT_RETENTION_ENV = "LEGACY_IMPORT_RETENTION_DAYS";
export const MIN_LEGACY_IMPORT_RETENTION_DAYS = 1;
export const MAX_LEGACY_IMPORT_RETENTION_DAYS = 3650;

export function configuredLegacyImportRetentionDays(
  raw = process.env[LEGACY_IMPORT_RETENTION_ENV],
): number | null {
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,3}$/.test(raw.trim())) return null;
  const days = Number(raw.trim());
  return Number.isSafeInteger(days)
    && days >= MIN_LEGACY_IMPORT_RETENTION_DAYS
    && days <= MAX_LEGACY_IMPORT_RETENTION_DAYS
    ? days
    : null;
}

export function legacyImportExpiry(createdAt: Date, retentionDays: number): Date {
  if (!Number.isSafeInteger(retentionDays)
    || retentionDays < MIN_LEGACY_IMPORT_RETENTION_DAYS
    || retentionDays > MAX_LEGACY_IMPORT_RETENTION_DAYS
    || Number.isNaN(createdAt.valueOf())) {
    throw new RangeError("Invalid legacy import retention policy or creation date.");
  }
  return new Date(createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}
