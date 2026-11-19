-- Phase D.2: persist a manager-authored source-to-HOME88 mapping definition.
-- The JSON contains field names and explicit conversion rules, never source row values.
ALTER TABLE "legacy_import_batches"
  ADD COLUMN "fieldMapping" JSONB;

CREATE OR REPLACE FUNCTION public.h88_guard_legacy_import_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'sourceFileSha256', 'temporaryStorageKey', 'detectedDelimiter',
    'mappingVersion', 'fieldMapping', 'columnHeaders', 'sourceRowCount', 'stagedRowCount',
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

COMMENT ON COLUMN "legacy_import_batches"."fieldMapping" IS
  'Manager-authored mapping metadata only; mapped row values are computed in memory and never persisted in plaintext.';
