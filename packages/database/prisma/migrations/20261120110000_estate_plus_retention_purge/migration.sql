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
      OR ("retentionDays" IS NOT NULL AND "retentionDays" BETWEEN 1 AND 3650 AND "retentionExpiresAt" IS NOT NULL)
    ),
  ADD CONSTRAINT "legacy_import_batches_purged_row_count_check"
    CHECK ("purgedRowCount" >= 0);

CREATE INDEX "legacy_import_batches_status_retentionExpiresAt_idx"
  ON "legacy_import_batches"("status", "retentionExpiresAt");

-- Retention metadata is immutable after batch creation. A live purge lease
-- blocks concurrent approval/import state changes. The purge worker itself
-- releases the lease in the same update that marks a batch EXPIRED.
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

  IF OLD."purgeLockedAt" IS NOT NULL
     AND NEW."purgeLockedAt" IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['purgeLockedAt', 'updatedAt'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['purgeLockedAt', 'updatedAt']) THEN
    RAISE EXCEPTION 'legacy import batch is locked for retention purge';
  END IF;

  IF NEW."status"::text IN ('PARSING', 'READY_FOR_APPROVAL', 'APPROVED', 'IMPORTING', 'COMPLETED')
     AND NEW."retentionExpiresAt" IS NOT NULL
     AND NEW."retentionExpiresAt" <= clock_timestamp() THEN
    RAISE EXCEPTION 'legacy import batch retention has expired';
  END IF;

  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'legacy import batch source identity is immutable';
  END IF;
  RETURN NEW;
END $$;

-- The batch lease is also enforced at the row boundary: no new or modified
-- staged row can race a purge, and expired batches cannot receive new rows.
CREATE OR REPLACE FUNCTION public.h88_guard_legacy_import_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'sourceEntityType', 'legacyIdHash', 'validationIssues',
    'targetEntityType', 'targetEntityId', 'importedAt', 'updatedAt'
  ];
  batch_locked boolean;
  batch_expired boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Lock the parent while checking. The purger's batch UPDATE must wait for
    -- this transaction, and then will see the inserted row before deleting.
    SELECT
      b."purgeLockedAt" IS NOT NULL,
      b."status"::text = 'EXPIRED'
        OR (b."retentionExpiresAt" IS NOT NULL AND b."retentionExpiresAt" <= clock_timestamp())
    INTO batch_locked, batch_expired
    FROM public.legacy_import_batches b
    WHERE b.id = NEW."batchId"
    FOR UPDATE;
    IF COALESCE(batch_locked, false) OR COALESCE(batch_expired, false) THEN
      RAISE EXCEPTION 'legacy import batch is not accepting staged rows';
    END IF;
    RETURN NEW;
  END IF;

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

  -- Serialize row updates with the purge lease too.
  SELECT
    b."purgeLockedAt" IS NOT NULL,
    b."status"::text = 'EXPIRED'
      OR (b."retentionExpiresAt" IS NOT NULL AND b."retentionExpiresAt" <= clock_timestamp())
  INTO batch_locked, batch_expired
  FROM public.legacy_import_batches b
  WHERE b.id = OLD."batchId"
  FOR UPDATE;
  IF COALESCE(batch_locked, false) OR COALESCE(batch_expired, false) THEN
    RAISE EXCEPTION 'legacy import batch is locked or expired';
  END IF;

  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'legacy import row source payload is immutable';
  END IF;
  RETURN NEW;
END $$;

-- A canonical legacy mapping cannot be attached to a batch during/after purge
-- or after that batch's expiry timestamp.
CREATE OR REPLACE FUNCTION public.h88_guard_legacy_mapping_retention() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  batch_locked boolean;
  batch_expired boolean;
BEGIN
  IF NEW."importBatchId" IS NOT NULL THEN
    -- The row lock makes the relationship check atomic with the purge lease.
    SELECT
      b."purgeLockedAt" IS NOT NULL,
      b."status"::text = 'EXPIRED'
        OR (b."retentionExpiresAt" IS NOT NULL AND b."retentionExpiresAt" <= clock_timestamp())
    INTO batch_locked, batch_expired
    FROM public.legacy_import_batches b
    WHERE b.id = NEW."importBatchId"
    FOR UPDATE;

    IF COALESCE(batch_locked, false) OR COALESCE(batch_expired, false) THEN
      RAISE EXCEPTION 'legacy import batch is not accepting entity mappings';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS h88_legacy_import_row_guard ON "legacy_import_rows";
CREATE TRIGGER h88_legacy_import_row_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "legacy_import_rows"
  FOR EACH ROW EXECUTE FUNCTION public.h88_guard_legacy_import_row();

DROP TRIGGER IF EXISTS h88_legacy_mapping_retention_guard ON "legacy_entity_mappings";
CREATE TRIGGER h88_legacy_mapping_retention_guard
  BEFORE INSERT OR UPDATE OF "importBatchId" ON "legacy_entity_mappings"
  FOR EACH ROW EXECUTE FUNCTION public.h88_guard_legacy_mapping_retention();

REVOKE ALL ON FUNCTION public.h88_guard_legacy_mapping_retention() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_legacy_mapping_retention() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_legacy_mapping_retention() FROM authenticated';
  END IF;
END $$;
