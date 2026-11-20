-- Phase D.5: persist explicit manager decisions for every staged source row.
-- Decisions are not approvals and do not create canonical CRM records.

ALTER TYPE "LegacyImportBatchStatus" ADD VALUE IF NOT EXISTS 'REVIEWED';

CREATE TYPE "LegacyImportPreviewStatus" AS ENUM (
  'READY',
  'DUPLICATE_REVIEW',
  'SOURCE_INVALID',
  'MAPPING_INVALID'
);

CREATE TYPE "LegacyImportReviewDecision" AS ENUM (
  'ACCEPT_AS_NEW',
  'SKIP'
);

CREATE TYPE "LegacyImportReviewReason" AS ENUM (
  'SOURCE_RECORD_VERIFIED',
  'NOT_RELEVANT',
  'DUPLICATE_CONFIRMED_DISTINCT',
  'EXACT_DUPLICATE_SKIPPED',
  'INVALID_SOURCE_SKIPPED',
  'MAPPING_ISSUE_SKIPPED'
);

ALTER TABLE "legacy_import_batches"
  ADD COLUMN "reviewedRowCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "acceptedRowCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "skippedRowCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewCompletedAt" TIMESTAMP(3),
  ADD CONSTRAINT "legacy_import_batches_review_counts_check"
    CHECK (
      "reviewedRowCount" >= 0
      AND "acceptedRowCount" >= 0
      AND "skippedRowCount" >= 0
      AND "reviewedRowCount" = "acceptedRowCount" + "skippedRowCount"
    );

ALTER TABLE "legacy_import_rows"
  ADD COLUMN "previewStatus" "LegacyImportPreviewStatus",
  ADD COLUMN "previewIssues" JSONB,
  ADD COLUMN "reviewDecision" "LegacyImportReviewDecision",
  ADD COLUMN "reviewReason" "LegacyImportReviewReason",
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewMappingVersion" TEXT,
  ADD CONSTRAINT "legacy_import_rows_review_fields_check"
    CHECK (
      (
        "reviewDecision" IS NULL
        AND "reviewReason" IS NULL
        AND "reviewedByUserId" IS NULL
        AND "reviewedAt" IS NULL
        AND "reviewMappingVersion" IS NULL
      )
      OR (
        "reviewDecision" IS NOT NULL
        AND "reviewReason" IS NOT NULL
        AND "reviewedByUserId" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "reviewMappingVersion" IS NOT NULL
        AND "previewStatus" IS NOT NULL
      )
    );

CREATE INDEX "legacy_import_rows_batchId_reviewDecision_rowNumber_idx"
  ON "legacy_import_rows"("batchId", "reviewDecision", "rowNumber");

-- Review counters are audit metadata on the batch and may change only while
-- the batch is in its pre-approval review lifecycle.
CREATE OR REPLACE FUNCTION public.h88_guard_legacy_import_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'sourceFileSha256', 'temporaryStorageKey', 'detectedDelimiter',
    'mappingVersion', 'fieldMapping', 'columnHeaders', 'sourceRowCount', 'stagedRowCount',
    'invalidRowCount', 'duplicateRowCount', 'importedRowCount', 'approvedByUserId',
    'approvedAt', 'importStartedAt', 'completedAt', 'cancelledAt', 'updatedAt',
    'purgeLockedAt', 'purgedAt', 'purgedRowCount', 'reviewedRowCount',
    'acceptedRowCount', 'skippedRowCount', 'reviewCompletedAt'
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

  -- An expired batch may be claimed for purge, but may not be advanced into
  -- an active review/import state without a purge lease.
  IF NEW."status"::text IN (
      'PARSING', 'READY_FOR_APPROVAL', 'REVIEWED', 'APPROVED', 'IMPORTING', 'COMPLETED'
    )
    AND NEW."retentionExpiresAt" IS NOT NULL
    AND NEW."retentionExpiresAt" <= clock_timestamp()
    AND NEW."purgeLockedAt" IS NULL THEN
    RAISE EXCEPTION 'legacy import batch retention has expired';
  END IF;

  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'legacy import batch source identity is immutable';
  END IF;
  RETURN NEW;
END $$;

-- Source rows, preview classifications and human decisions are all serialized
-- against the parent batch so a purge or completed review cannot race a write.
CREATE OR REPLACE FUNCTION public.h88_guard_legacy_import_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'sourceEntityType', 'legacyIdHash', 'validationIssues',
    'previewStatus', 'previewIssues', 'reviewDecision', 'reviewReason',
    'reviewedByUserId', 'reviewedAt', 'reviewMappingVersion',
    'targetEntityType', 'targetEntityId', 'importedAt', 'updatedAt'
  ];
  parent_status text;
  parent_mapping_version text;
  parent_locked boolean;
  parent_expired boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT
      b."status"::text,
      b."purgeLockedAt" IS NOT NULL,
      b."status"::text = 'EXPIRED'
        OR (b."retentionExpiresAt" IS NOT NULL AND b."retentionExpiresAt" <= clock_timestamp())
    INTO parent_status, parent_locked, parent_expired
    FROM public.legacy_import_batches b
    WHERE b.id = NEW."batchId"
    FOR UPDATE;

    IF COALESCE(parent_locked, false)
       OR COALESCE(parent_expired, false)
       OR parent_status IN ('READY_FOR_APPROVAL', 'REVIEWED', 'APPROVED', 'IMPORTING', 'COMPLETED') THEN
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

  SELECT
    b."status"::text,
    b."mappingVersion",
    b."purgeLockedAt" IS NOT NULL,
    b."status"::text = 'EXPIRED'
      OR (b."retentionExpiresAt" IS NOT NULL AND b."retentionExpiresAt" <= clock_timestamp())
  INTO parent_status, parent_mapping_version, parent_locked, parent_expired
  FROM public.legacy_import_batches b
  WHERE b.id = OLD."batchId"
  FOR UPDATE;

  IF COALESCE(parent_locked, false) OR COALESCE(parent_expired, false)
     OR parent_status IN ('READY_FOR_APPROVAL', 'REVIEWED', 'APPROVED', 'IMPORTING', 'COMPLETED') THEN
    RAISE EXCEPTION 'legacy import batch is locked, reviewed or expired';
  END IF;

  IF NEW."reviewDecision" IS NULL THEN
    IF NEW."reviewReason" IS NOT NULL
       OR NEW."reviewedByUserId" IS NOT NULL
       OR NEW."reviewedAt" IS NOT NULL
       OR NEW."reviewMappingVersion" IS NOT NULL THEN
      RAISE EXCEPTION 'legacy import review metadata requires a decision';
    END IF;
  ELSE
    IF NEW."previewStatus" IS NULL
       OR NEW."reviewReason" IS NULL
       OR NEW."reviewedByUserId" IS NULL
       OR NEW."reviewedAt" IS NULL
       OR NEW."reviewMappingVersion" IS DISTINCT FROM parent_mapping_version THEN
      RAISE EXCEPTION 'legacy import review decision is incomplete or stale';
    END IF;

    IF NEW."reviewDecision"::text = 'ACCEPT_AS_NEW' THEN
      IF NEW."previewStatus"::text = 'READY'
         AND NEW."reviewReason"::text <> 'SOURCE_RECORD_VERIFIED' THEN
        RAISE EXCEPTION 'ready rows require SOURCE_RECORD_VERIFIED to be accepted';
      ELSIF NEW."previewStatus"::text = 'DUPLICATE_REVIEW'
         AND NEW."reviewReason"::text <> 'DUPLICATE_CONFIRMED_DISTINCT' THEN
        RAISE EXCEPTION 'duplicate rows require explicit distinct-record confirmation';
      ELSIF NEW."previewStatus"::text NOT IN ('READY', 'DUPLICATE_REVIEW') THEN
        RAISE EXCEPTION 'invalid rows cannot be accepted for import';
      END IF;
    ELSIF NEW."reviewDecision"::text = 'SKIP' THEN
      IF NEW."previewStatus"::text = 'READY'
         AND NEW."reviewReason"::text <> 'NOT_RELEVANT' THEN
        RAISE EXCEPTION 'ready rows require NOT_RELEVANT when skipped';
      ELSIF NEW."previewStatus"::text = 'DUPLICATE_REVIEW'
         AND NEW."reviewReason"::text <> 'EXACT_DUPLICATE_SKIPPED' THEN
        RAISE EXCEPTION 'duplicate rows require EXACT_DUPLICATE_SKIPPED';
      ELSIF NEW."previewStatus"::text = 'SOURCE_INVALID'
         AND NEW."reviewReason"::text <> 'INVALID_SOURCE_SKIPPED' THEN
        RAISE EXCEPTION 'invalid source rows require INVALID_SOURCE_SKIPPED';
      ELSIF NEW."previewStatus"::text = 'MAPPING_INVALID'
         AND NEW."reviewReason"::text <> 'MAPPING_ISSUE_SKIPPED' THEN
        RAISE EXCEPTION 'mapping-invalid rows require MAPPING_ISSUE_SKIPPED';
      END IF;
    END IF;
  END IF;

  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'legacy import row source payload is immutable';
  END IF;
  RETURN NEW;
END $$;

-- Only pre-approval batches with no actual approval/import linkage are eligible.
-- READY_FOR_APPROVAL and REVIEWED contain decisions, not customer records.
