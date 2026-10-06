-- Document issuance (Phase B): storage state and verification code on showings,
-- mandates and extensions, issuance snapshots, signature columns on showings and
-- extensions, a replacement link on showings, the append-only document audit
-- trail, and users.legalApprover.
--
-- Nothing is rewritten: every new column is nullable or has a default, so
-- existing mandates (which the database freezes once issued) are untouched. A
-- rollback script is in down.sql.

-- CreateEnum
CREATE TYPE "DocumentStorageState" AS ENUM ('NOT_STORED', 'PENDING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "legalApprover" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "mandates" ADD COLUMN     "issuanceSnapshotChecksum" TEXT,
ADD COLUMN     "issuanceSnapshotEncrypted" TEXT,
ADD COLUMN     "storageState" "DocumentStorageState" NOT NULL DEFAULT 'NOT_STORED',
ADD COLUMN     "verificationCode" TEXT;

-- AlterTable
ALTER TABLE "showings" ADD COLUMN     "envelopeId" TEXT,
ADD COLUMN     "issuanceSnapshotChecksum" TEXT,
ADD COLUMN     "issuanceSnapshotEncrypted" TEXT,
ADD COLUMN     "renderedTextEncrypted" TEXT,
ADD COLUMN     "replacesShowingId" TEXT,
ADD COLUMN     "signatureLevel" TEXT,
ADD COLUMN     "signatureMethod" TEXT,
ADD COLUMN     "signatureProvider" TEXT,
ADD COLUMN     "signedUploadedAt" TIMESTAMP(3),
ADD COLUMN     "signedUploadedById" TEXT,
ADD COLUMN     "signingExpiresAt" TIMESTAMP(3),
ADD COLUMN     "storageState" "DocumentStorageState" NOT NULL DEFAULT 'NOT_STORED',
ADD COLUMN     "verificationCode" TEXT;

-- AlterTable
ALTER TABLE "mandate_extensions" ADD COLUMN     "envelopeId" TEXT,
ADD COLUMN     "issuanceSnapshotChecksum" TEXT,
ADD COLUMN     "issuanceSnapshotEncrypted" TEXT,
ADD COLUMN     "pdfChecksum" TEXT,
ADD COLUMN     "pdfStorageKey" TEXT,
ADD COLUMN     "renderedTextChecksum" TEXT,
ADD COLUMN     "renderedTextEncrypted" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "signatureLevel" TEXT,
ADD COLUMN     "signatureMethod" TEXT,
ADD COLUMN     "signatureProvider" TEXT,
ADD COLUMN     "signedPdfChecksum" TEXT,
ADD COLUMN     "signedUploadedAt" TIMESTAMP(3),
ADD COLUMN     "signedUploadedById" TEXT,
ADD COLUMN     "signingExpiresAt" TIMESTAMP(3),
ADD COLUMN     "storageState" "DocumentStorageState" NOT NULL DEFAULT 'NOT_STORED',
ADD COLUMN     "templateChecksum" TEXT,
ADD COLUMN     "verificationCode" TEXT;

-- CreateTable
CREATE TABLE "document_audit_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "documentNumber" TEXT,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "document_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_audit_events_entityType_entityId_occurredAt_idx" ON "document_audit_events"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "document_audit_events_type_occurredAt_idx" ON "document_audit_events"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "document_audit_events_documentNumber_idx" ON "document_audit_events"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_verificationCode_key" ON "mandates"("verificationCode");

-- CreateIndex
CREATE UNIQUE INDEX "showings_verificationCode_key" ON "showings"("verificationCode");

-- CreateIndex
CREATE UNIQUE INDEX "showings_replacesShowingId_key" ON "showings"("replacesShowingId");

-- CreateIndex
CREATE UNIQUE INDEX "showings_envelopeId_key" ON "showings"("envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_extensions_verificationCode_key" ON "mandate_extensions"("verificationCode");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_extensions_envelopeId_key" ON "mandate_extensions"("envelopeId");

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_replacesShowingId_fkey" FOREIGN KEY ("replacesShowingId") REFERENCES "showings"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The addendum's own number.
ALTER TABLE "mandate_extensions" ADD COLUMN "number" TEXT;
CREATE UNIQUE INDEX "mandate_extensions_number_key" ON "mandate_extensions"("number");

-- ===========================================================================
-- Rules the database enforces on its own
-- ===========================================================================

ALTER TABLE "showings"
  ADD CONSTRAINT "showings_verification_code_check" CHECK ("verificationCode" IS NULL OR "verificationCode" ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  -- A stored PDF has its checksum, and an issued showing is never "not stored" once it has one.
  ADD CONSTRAINT "showings_pdf_checksum_check" CHECK ("pdfStorageKey" IS NULL OR "pdfChecksum" IS NOT NULL),
  ADD CONSTRAINT "showings_storage_state_check" CHECK ("storageState" = 'NOT_STORED' OR "pdfStorageKey" IS NOT NULL),
  ADD CONSTRAINT "showings_signed_pdf_check" CHECK ("signedPdfStorageKey" IS NULL OR "signedPdfChecksum" IS NOT NULL),
  ADD CONSTRAINT "showings_not_self_replacement_check" CHECK ("replacesShowingId" IS NULL OR "replacesShowingId" <> "id");

ALTER TABLE "mandates"
  ADD CONSTRAINT "mandates_verification_code_check" CHECK ("verificationCode" IS NULL OR "verificationCode" ~ '^[0-9A-HJKMNP-TV-Z]{12}$') NOT VALID;

ALTER TABLE "mandate_extensions"
  ADD CONSTRAINT "mandate_extensions_verification_code_check" CHECK ("verificationCode" IS NULL OR "verificationCode" ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  ADD CONSTRAINT "mandate_extensions_pdf_checksum_check" CHECK ("pdfStorageKey" IS NULL OR "pdfChecksum" IS NOT NULL),
  ADD CONSTRAINT "mandate_extensions_storage_state_check" CHECK ("storageState" = 'NOT_STORED' OR "pdfStorageKey" IS NOT NULL),
  ADD CONSTRAINT "mandate_extensions_signed_pdf_check" CHECK ("signedPdfStorageKey" IS NULL OR "signedPdfChecksum" IS NOT NULL),
  ADD CONSTRAINT "mandate_extensions_issued_snapshot_check" CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "issuanceSnapshotEncrypted" IS NOT NULL OR "pdfStorageKey" IS NULL);

ALTER TABLE "document_audit_events"
  ADD CONSTRAINT "document_audit_events_entity_check" CHECK ("entityType" IN ('SHOWING', 'MANDATE', 'MANDATE_EXTENSION', 'TEMPLATE')),
  ADD CONSTRAINT "document_audit_events_type_check" CHECK (length(trim("type")) > 0);

-- The audit trail is append-only (function from the transactions migration).
CREATE TRIGGER h88_document_audit_events_append_only BEFORE UPDATE OR DELETE ON "document_audit_events"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_append_only();

-- Guards from the previous migrations, now also allowing the storage state and
-- signature progress to move after issue. Everything that was frozen stays frozen.
CREATE OR REPLACE FUNCTION public.h88_guard_showing() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  links text[] := ARRAY['contactId', 'leadId', 'responsibleUserId', 'sourceViewingId', 'updatedAt'];
  progress text[] := ARRAY['status', 'sentAt', 'viewedAt', 'signedAt', 'declinedAt', 'expiresAt', 'cancelledAt',
    'cancelReason', 'signedPdfStorageKey', 'signedPdfChecksum', 'completenessResult', 'completenessCheckedAt',
    'storageState', 'signatureMethod', 'signatureProvider', 'signatureLevel', 'envelopeId', 'signingExpiresAt',
    'signedUploadedById', 'signedUploadedAt'];
  allowed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('DRAFT', 'READY_FOR_ISSUANCE') THEN
      RAISE EXCEPTION 'an issued showing cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    allowed := CASE OLD.status
      WHEN 'DRAFT' THEN NEW.status IN ('READY_FOR_ISSUANCE', 'CANCELLED')
      WHEN 'READY_FOR_ISSUANCE' THEN NEW.status IN ('DRAFT', 'ISSUED', 'CANCELLED')
      WHEN 'ISSUED' THEN NEW.status IN ('SENT', 'SIGNED', 'CANCELLED')
      WHEN 'SENT' THEN NEW.status IN ('VIEWED', 'SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED')
      WHEN 'VIEWED' THEN NEW.status IN ('SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED')
      ELSE false
    END;
    IF NOT allowed THEN
      RAISE EXCEPTION 'a showing cannot move from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF OLD.status IN ('DRAFT', 'READY_FOR_ISSUANCE') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED') THEN
    IF (to_jsonb(NEW) - links) IS DISTINCT FROM (to_jsonb(OLD) - links) THEN
      RAISE EXCEPTION 'a % showing cannot be changed', lower(OLD.status::text);
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - links - progress) IS DISTINCT FROM (to_jsonb(OLD) - links - progress) THEN
    RAISE EXCEPTION 'an issued showing cannot be edited; cancel it and create a new one';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.h88_guard_mandate_extension() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  progress text[] := ARRAY['status', 'signedAt', 'signedPdfStorageKey', 'signedPdfChecksum', 'updatedAt', 'storageState',
    'sentAt', 'signatureMethod', 'signatureProvider', 'signatureLevel', 'envelopeId', 'signingExpiresAt',
    'signedUploadedById', 'signedUploadedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'an issued extension cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'ISSUED' AND NEW.status IN ('ISSUED', 'SIGNED', 'CANCELLED')
     AND (to_jsonb(NEW) - progress) IS NOT DISTINCT FROM (to_jsonb(OLD) - progress) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'an issued extension cannot be changed';
END $$;

CREATE OR REPLACE FUNCTION public.h88_guard_mandate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  links text[] := ARRAY['propertyId', 'sellerLeadId', 'agentId', 'supersedesMandateId', 'updatedAt'];
  progress text[] := ARRAY['status', 'sentAt', 'viewedAt', 'signedAt', 'declinedAt', 'expiredAt', 'cancelledAt',
    'cancelReason', 'signatureMethod', 'signatureProvider', 'signatureLevel', 'envelopeId', 'signingExpiresAt',
    'signedDocumentId', 'signedChecksum', 'storageState'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'an issued mandate cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED') THEN
    IF (to_jsonb(NEW) - links) IS DISTINCT FROM (to_jsonb(OLD) - links) THEN
      RAISE EXCEPTION 'a % mandate cannot be changed', lower(OLD.status);
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - links - progress) IS DISTINCT FROM (to_jsonb(OLD) - links - progress) THEN
    RAISE EXCEPTION 'an issued mandate cannot be edited; cancel it and create a new one';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE "document_audit_events" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "document_audit_events" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "document_audit_events" FROM authenticated';
  END IF;
END $$;
