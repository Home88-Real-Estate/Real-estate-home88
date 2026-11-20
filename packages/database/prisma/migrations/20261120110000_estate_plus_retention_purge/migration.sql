-- Phase D.4: record an immutable retention window and permit controlled expiry purges.
-- Existing batches remain untouched: NULL retentionExpiresAt is deliberately not eligible.

ALTER TYPE "LegacyImportBatchStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "legacy_import_batches"
  ADD COLUMN "retentionDays" INTEGER,
  ADD COLUMN "retentionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "purgeLockedAt" TIMESTAMP(3),
  ADD COLUMN "purgedAt" TIMESTAMP(3),
  ADD COLUMN "purgedRowCount" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "legacy_import_batches_retention_pair_check"
    CHECK (
      ("retentionDays" IS NULL AND "retentionExpiresAt" IS NULL)
      OR ("retentionDays" IS NOT NULL AND "retentionDays" > 0 AND "retentionExpiresAt" IS NOT NULL)
    ),
  ADD CONSTRAINT "legacy_import_batches_purged_row_count_check"
    CHECK ("purgedRowCount" >= 0);

CREATE INDEX "legacy_import_batches_status_retentionExpiresAt_idx"
  ON "legacy_import_batches"("status", "retentionExpiresAt");

-- Retention metadata is immutable after batch creation. Only worker state and
-- the resulting purge markers may be updated.
CREATE OR REPLACE FUNCTION public.h88_guard_legacy_import_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'sourceFileSha256', 'temporaryStorageKey', 'detectedDelimiter',
    'mappingVersion', 'fieldMapping', 'columnHeaders', 'sourceRowCount', 'stagedRowCount',
    'invalidRowCount', 'duplicateRowCount', 'importedRowCount', 'approvedByUserId',
    'approvedAt', 'importStartedAt', 'completedAt', 'cancelledAt', 'updatedAt',
    'purgeLockedAt', 'purgedAt', 'purgedRowCount'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legacy import batches are retained for audit and cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'legacy import batch source identity is immutable';
  END IF;
  RETURN NEW;
END $$;

-- Staged rows may be deleted only after the batch is marked EXPIRED by the
-- retention worker, and only when it has never been approved/imported or linked
-- to canonical records. Direct deletes remain blocked for every other state.
CREATE OR REPLACE FUNCTION public.h88_guard_legacy_import_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'sourceEntityType', 'legacyIdHash', 'validationIssues',
    'targetEntityType', 'targetEntityId', 'importedAt', 'updatedAt'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM public.legacy_import_batches b
      WHERE b.id = OLD."batchId"
        AND b."status"::text = 'EXPIRED'
        AND b."purgedAt" IS NOT NULL
        AND b."approvedAt" IS NULL
        AND b."importedRowCount" = 0
        AND NOT EXISTS (
          SELECT 1 FROM public.legacy_import_rows r
          WHERE r."batchId" = OLD."batchId" AND r."targetEntityId" IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.legacy_entity_mappings m
          WHERE m."importBatchId" = OLD."batchId"
        )
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'legacy import rows may be deleted only by an eligible retention purge';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'legacy import row source payload is immutable';
  END IF;
  RETURN NEW;
END $$;

