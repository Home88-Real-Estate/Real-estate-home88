-- Manual rollback for 20261016000000_documents_issuance (Prisma does not run this
-- file). Run inside a transaction:  psql "$DATABASE_URL" -1 -f down.sql
-- Everything stored in the new columns and in document_audit_events is lost.

DROP TABLE IF EXISTS "document_audit_events";

ALTER TABLE "showings" DISABLE TRIGGER h88_showing_guard;
ALTER TABLE "mandate_extensions" DISABLE TRIGGER h88_mandate_extension_guard;
ALTER TABLE "mandates" DISABLE TRIGGER h88_mandate_guard;

ALTER TABLE "showings"
  DROP CONSTRAINT IF EXISTS "showings_verification_code_check", DROP CONSTRAINT IF EXISTS "showings_pdf_checksum_check",
  DROP CONSTRAINT IF EXISTS "showings_storage_state_check", DROP CONSTRAINT IF EXISTS "showings_signed_pdf_check",
  DROP CONSTRAINT IF EXISTS "showings_not_self_replacement_check", DROP CONSTRAINT IF EXISTS "showings_replacesShowingId_fkey";
ALTER TABLE "showings"
  DROP COLUMN IF EXISTS "renderedTextEncrypted", DROP COLUMN IF EXISTS "issuanceSnapshotEncrypted", DROP COLUMN IF EXISTS "issuanceSnapshotChecksum",
  DROP COLUMN IF EXISTS "storageState", DROP COLUMN IF EXISTS "verificationCode", DROP COLUMN IF EXISTS "replacesShowingId",
  DROP COLUMN IF EXISTS "signatureMethod", DROP COLUMN IF EXISTS "signatureProvider", DROP COLUMN IF EXISTS "signatureLevel",
  DROP COLUMN IF EXISTS "envelopeId", DROP COLUMN IF EXISTS "signingExpiresAt", DROP COLUMN IF EXISTS "signedUploadedById",
  DROP COLUMN IF EXISTS "signedUploadedAt";

ALTER TABLE "mandates" DROP CONSTRAINT IF EXISTS "mandates_verification_code_check";
ALTER TABLE "mandates"
  DROP COLUMN IF EXISTS "issuanceSnapshotEncrypted", DROP COLUMN IF EXISTS "issuanceSnapshotChecksum",
  DROP COLUMN IF EXISTS "storageState", DROP COLUMN IF EXISTS "verificationCode";

ALTER TABLE "mandate_extensions"
  DROP CONSTRAINT IF EXISTS "mandate_extensions_verification_code_check", DROP CONSTRAINT IF EXISTS "mandate_extensions_pdf_checksum_check",
  DROP CONSTRAINT IF EXISTS "mandate_extensions_storage_state_check", DROP CONSTRAINT IF EXISTS "mandate_extensions_signed_pdf_check",
  DROP CONSTRAINT IF EXISTS "mandate_extensions_issued_snapshot_check";
ALTER TABLE "mandate_extensions"
  DROP COLUMN IF EXISTS "number", DROP COLUMN IF EXISTS "signedPdfChecksum", DROP COLUMN IF EXISTS "templateChecksum", DROP COLUMN IF EXISTS "renderedTextEncrypted",
  DROP COLUMN IF EXISTS "renderedTextChecksum", DROP COLUMN IF EXISTS "issuanceSnapshotEncrypted", DROP COLUMN IF EXISTS "issuanceSnapshotChecksum",
  DROP COLUMN IF EXISTS "pdfStorageKey", DROP COLUMN IF EXISTS "pdfChecksum", DROP COLUMN IF EXISTS "storageState",
  DROP COLUMN IF EXISTS "verificationCode", DROP COLUMN IF EXISTS "sentAt", DROP COLUMN IF EXISTS "signatureMethod",
  DROP COLUMN IF EXISTS "signatureProvider", DROP COLUMN IF EXISTS "signatureLevel", DROP COLUMN IF EXISTS "envelopeId",
  DROP COLUMN IF EXISTS "signingExpiresAt", DROP COLUMN IF EXISTS "signedUploadedById", DROP COLUMN IF EXISTS "signedUploadedAt";

ALTER TABLE "users" DROP COLUMN IF EXISTS "legalApprover";
DROP TYPE IF EXISTS "DocumentStorageState";

-- Put back the guards from 20261015000000_showings_mandates_foundation (their
-- CREATE OR REPLACE bodies are in that migration.sql), then re-enable the triggers:
-- ALTER TABLE "showings" ENABLE TRIGGER h88_showing_guard;
-- ALTER TABLE "mandate_extensions" ENABLE TRIGGER h88_mandate_extension_guard;
-- ALTER TABLE "mandates" ENABLE TRIGGER h88_mandate_guard;
