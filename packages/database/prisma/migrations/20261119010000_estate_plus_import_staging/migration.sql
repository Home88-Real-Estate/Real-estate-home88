-- Phase D foundation: private staging for an Estate+ CSV import.
-- This migration creates no HOME88 contacts, properties, mandates or showings.
-- Raw source rows are stored only as application-encrypted payloads.

ALTER TYPE "AuditEntity" ADD VALUE IF NOT EXISTS 'LEGACY_IMPORT_BATCH';

CREATE TYPE "LegacyImportBatchStatus" AS ENUM (
  'CREATED',
  'PARSING',
  'STAGED',
  'NEEDS_REVIEW',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'IMPORTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "LegacyImportRowStatus" AS ENUM (
  'STAGED',
  'INVALID',
  'DUPLICATE_REVIEW',
  'SKIPPED',
  'IMPORTED',
  'FAILED'
);

CREATE TABLE "legacy_import_batches" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT 'home88',
  "sourceSystem" "LegacySourceSystem" NOT NULL DEFAULT 'ESTATE_PLUS',
  "status" "LegacyImportBatchStatus" NOT NULL DEFAULT 'CREATED',
  "sourceFileSha256" TEXT,
  "sourceFileBytes" INTEGER NOT NULL,
  "temporaryStorageKey" TEXT,
  "requestedDelimiter" TEXT NOT NULL DEFAULT 'AUTO',
  "detectedDelimiter" TEXT,
  "parserVersion" TEXT NOT NULL DEFAULT 'home88-csv-v1',
  "mappingVersion" TEXT NOT NULL DEFAULT 'unmapped',
  "columnHeaders" JSONB,
  "sourceRowCount" INTEGER NOT NULL DEFAULT 0,
  "stagedRowCount" INTEGER NOT NULL DEFAULT 0,
  "invalidRowCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateRowCount" INTEGER NOT NULL DEFAULT 0,
  "importedRowCount" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "importStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "legacy_import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legacy_import_batches_size_check"
    CHECK ("sourceFileBytes" > 0 AND "sourceFileBytes" <= 20971520),
  CONSTRAINT "legacy_import_batches_hash_check"
    CHECK ("sourceFileSha256" IS NULL OR "sourceFileSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "legacy_import_batches_delimiter_check"
    CHECK ("requestedDelimiter" IN ('AUTO', 'COMMA', 'SEMICOLON', 'TAB')),
  CONSTRAINT "legacy_import_batches_detected_delimiter_check"
    CHECK ("detectedDelimiter" IS NULL OR "detectedDelimiter" IN (',', ';', E'\\t')),
  CONSTRAINT "legacy_import_batches_counts_check"
    CHECK ("sourceRowCount" >= 0 AND "stagedRowCount" >= 0 AND "invalidRowCount" >= 0
      AND "duplicateRowCount" >= 0 AND "importedRowCount" >= 0),
  CONSTRAINT "legacy_import_batches_approval_pair_check"
    CHECK (("approvedByUserId" IS NULL AND "approvedAt" IS NULL)
      OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  CONSTRAINT "legacy_import_batches_temp_key_check"
    CHECK ("temporaryStorageKey" IS NULL OR "temporaryStorageKey" ~ '^private/legacy-imports/[0-9]{4}/[0-9]{2}/[a-f0-9]{32}\\.csv$')
);

CREATE TABLE "legacy_import_rows" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "status" "LegacyImportRowStatus" NOT NULL DEFAULT 'STAGED',
  "payloadCiphertext" TEXT NOT NULL,
  "payloadSha256" TEXT NOT NULL,
  "sourceEntityType" TEXT,
  "legacyIdHash" TEXT,
  "validationIssues" JSONB,
  "targetEntityType" TEXT,
  "targetEntityId" TEXT,
  "importedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "legacy_import_rows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legacy_import_rows_row_number_check" CHECK ("rowNumber" >= 2),
  CONSTRAINT "legacy_import_rows_hash_check" CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "legacy_import_rows_batch_fkey"
    FOREIGN KEY ("batchId") REFERENCES "legacy_import_batches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "legacy_import_batches_temporaryStorageKey_key"
  ON "legacy_import_batches"("temporaryStorageKey");
CREATE INDEX "legacy_import_batches_organizationId_status_createdAt_idx"
  ON "legacy_import_batches"("organizationId", "status", "createdAt");
CREATE INDEX "legacy_import_batches_sourceSystem_createdAt_idx"
  ON "legacy_import_batches"("sourceSystem", "createdAt");
CREATE UNIQUE INDEX "legacy_import_rows_batchId_rowNumber_key"
  ON "legacy_import_rows"("batchId", "rowNumber");
CREATE INDEX "legacy_import_rows_batchId_status_rowNumber_idx"
  ON "legacy_import_rows"("batchId", "status", "rowNumber");
CREATE INDEX "legacy_import_rows_batchId_payloadSha256_idx"
  ON "legacy_import_rows"("batchId", "payloadSha256");
CREATE INDEX "legacy_import_rows_legacyIdHash_idx"
  ON "legacy_import_rows"("legacyIdHash");

-- Import batches and staged rows are never deleted. Source payload ciphertext
-- and its checksums cannot be rewritten; only review/import metadata may move.
CREATE OR REPLACE FUNCTION public.h88_guard_legacy_import_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'sourceFileSha256', 'temporaryStorageKey', 'detectedDelimiter',
    'mappingVersion', 'columnHeaders', 'sourceRowCount', 'stagedRowCount',
    'invalidRowCount', 'duplicateRowCount', 'importedRowCount', 'approvedByUserId',
    'approvedAt', 'importStartedAt', 'completedAt', 'cancelledAt', 'updatedAt'
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

CREATE OR REPLACE FUNCTION public.h88_guard_legacy_import_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'sourceEntityType', 'legacyIdHash', 'validationIssues',
    'targetEntityType', 'targetEntityId', 'importedAt', 'updatedAt'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legacy import rows are retained for audit and cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'legacy import row source payload is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER h88_legacy_import_batch_guard
  BEFORE UPDATE OR DELETE ON "legacy_import_batches"
  FOR EACH ROW EXECUTE FUNCTION public.h88_guard_legacy_import_batch();

CREATE TRIGGER h88_legacy_import_row_guard
  BEFORE UPDATE OR DELETE ON "legacy_import_rows"
  FOR EACH ROW EXECUTE FUNCTION public.h88_guard_legacy_import_row();

REVOKE ALL ON FUNCTION public.h88_guard_legacy_import_batch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.h88_guard_legacy_import_row() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_legacy_import_batch() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_legacy_import_row() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_legacy_import_batch() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.h88_guard_legacy_import_row() FROM authenticated';
  END IF;
END $$;

-- No browser-facing Supabase role may inspect batches or encrypted staging rows.
ALTER TABLE "legacy_import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legacy_import_rows" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "legacy_import_batches" FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE "legacy_import_rows" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "legacy_import_batches" FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE "legacy_import_rows" FROM authenticated';
  END IF;
END $$;
