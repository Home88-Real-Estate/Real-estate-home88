-- Showings (Υπόδειξη), structured mandate terms, co-owners, mandate extensions,
-- payment milestones and legacy-id mapping. Phase A: data model and database
-- rules only.
--
-- Nothing here rewrites existing data. Mandates, viewings, properties,
-- contacts, offers, transactions and documents keep every row as it is: new
-- mandate columns are nullable, so signed mandates (which the database
-- freezes) are not touched. Property.ownerId stays; PropertyOwner is filled
-- going forward and read together with it. A rollback script is in down.sql.

-- CreateEnum
CREATE TYPE "ShowingStatus" AS ENUM ('DRAFT', 'READY_FOR_ISSUANCE', 'ISSUED', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShowingPartyRole" AS ENUM ('BUYER', 'TENANT', 'JOINT_BUYER', 'SPOUSE', 'COMPANY_REPRESENTATIVE', 'ATTORNEY_IN_FACT', 'AUTHORIZED_REPRESENTATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "FeePayer" AS ENUM ('OWNER', 'BUYER', 'TENANT', 'LANDLORD', 'BOTH_PARTIES', 'OTHER');

-- CreateEnum
CREATE TYPE "FeeMethod" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'CUSTOM', 'NEGOTIATED_LATER');

-- CreateEnum
CREATE TYPE "FeeBasis" AS ENUM ('ASKING_PRICE', 'FINAL_SALE_PRICE', 'MONTHLY_RENT', 'ANNUAL_RENT', 'CONTRACT_VALUE', 'OTHER');

-- CreateEnum
CREATE TYPE "VatTreatment" AS ENUM ('PLUS_VAT', 'VAT_INCLUDED', 'VAT_EXEMPT', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "PaymentTrigger" AS ENUM ('RESERVATION', 'PRELIMINARY_AGREEMENT', 'FINAL_CONTRACT', 'LEASE_SIGNING', 'INSTALLMENTS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DurationType" AS ENUM ('INDEFINITE', 'FIXED_TERM');

-- CreateEnum
CREATE TYPE "OwnerCapacity" AS ENUM ('OWNER', 'CO_OWNER', 'USUFRUCTUARY', 'BARE_OWNER', 'LEGAL_REPRESENTATIVE', 'ATTORNEY_IN_FACT', 'COMPANY_REPRESENTATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "MandateExtensionStatus" AS ENUM ('DRAFT', 'ISSUED', 'SIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LegacySourceSystem" AS ENUM ('ESTATE_PLUS', 'HOME88_LEGACY', 'MANUAL_IMPORT', 'CSV_IMPORT');

-- AlterTable
ALTER TABLE "viewings" ADD COLUMN     "showingId" TEXT;

-- AlterTable
ALTER TABLE "mandate_settings" ADD COLUMN     "maxExclusiveMonths" INTEGER;

-- AlterTable
ALTER TABLE "mandate_template_versions" ADD COLUMN     "legalApprovedAt" TIMESTAMP(3),
ADD COLUMN     "legalApprovedBy" TEXT,
ADD COLUMN     "legalApprovedChecksum" TEXT,
ADD COLUMN     "legalReviewFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "requiresLegalReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'HOME88';

-- AlterTable
ALTER TABLE "mandates" ADD COLUMN     "brokerCooperationAllowed" BOOLEAN,
ADD COLUMN     "completenessCheckedAt" TIMESTAMP(3),
ADD COLUMN     "completenessResult" JSONB,
ADD COLUMN     "cooperatingBrokerPermission" BOOLEAN,
ADD COLUMN     "defectsDescription" TEXT,
ADD COLUMN     "defectsDisclosureConfirmed" BOOLEAN,
ADD COLUMN     "dualRepresentationConsent" BOOLEAN,
ADD COLUMN     "durationType" "DurationType",
ADD COLUMN     "feeAnomalyOverriddenById" TEXT,
ADD COLUMN     "feeAnomalyOverrideReason" TEXT,
ADD COLUMN     "feeBasis" "FeeBasis",
ADD COLUMN     "feeCurrency" TEXT,
ADD COLUMN     "feeFixedAmount" DECIMAL(14,2),
ADD COLUMN     "feeMethod" "FeeMethod",
ADD COLUMN     "feePayer" "FeePayer",
ADD COLUMN     "feePercentage" DECIMAL(7,4),
ADD COLUMN     "floorplanPermission" BOOLEAN,
ADD COLUMN     "knownDefects" BOOLEAN,
ADD COLUMN     "marketingChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "paymentTrigger" "PaymentTrigger",
ADD COLUMN     "photoPermission" BOOLEAN,
ADD COLUMN     "portalPublicationPermission" BOOLEAN,
ADD COLUMN     "signboardPermission" BOOLEAN,
ADD COLUMN     "socialMediaPermission" BOOLEAN,
ADD COLUMN     "specialTerms" TEXT,
ADD COLUMN     "supersedesMandateId" TEXT,
ADD COLUMN     "vatRate" DECIMAL(5,2),
ADD COLUMN     "vatTreatment" "VatTreatment",
ADD COLUMN     "videoPermission" BOOLEAN;

-- CreateTable
CREATE TABLE "showings" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "year" INTEGER,
    "status" "ShowingStatus" NOT NULL DEFAULT 'DRAFT',
    "language" TEXT NOT NULL DEFAULT 'el',
    "contactId" TEXT,
    "leadId" TEXT,
    "responsibleUserId" TEXT,
    "sourceViewingId" TEXT,
    "documentDate" DATE,
    "issuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "feePayer" "FeePayer",
    "feeMethod" "FeeMethod",
    "feeBasis" "FeeBasis",
    "feePercentage" DECIMAL(7,4),
    "feeFixedAmount" DECIMAL(14,2),
    "feeCurrency" TEXT,
    "vatTreatment" "VatTreatment",
    "vatRate" DECIMAL(5,2),
    "paymentTrigger" "PaymentTrigger",
    "feeAnomalyOverrideReason" TEXT,
    "feeAnomalyOverriddenById" TEXT,
    "dualRepresentationConsent" BOOLEAN,
    "comments" TEXT,
    "clientSnapshotEncrypted" TEXT,
    "companySnapshot" JSONB,
    "templateVersionId" TEXT,
    "templateChecksum" TEXT,
    "renderedTextChecksum" TEXT,
    "pdfStorageKey" TEXT,
    "pdfChecksum" TEXT,
    "signedPdfStorageKey" TEXT,
    "signedPdfChecksum" TEXT,
    "completenessResult" JSONB,
    "completenessCheckedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "showings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showing_properties" (
    "id" TEXT NOT NULL,
    "showingId" TEXT NOT NULL,
    "propertyId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "propertyCodeSnapshot" TEXT NOT NULL,
    "addressSnapshot" TEXT,
    "descriptionSnapshot" TEXT,
    "transactionTypeSnapshot" TEXT NOT NULL,
    "propertyTypeSnapshot" TEXT,
    "areaSnapshot" DECIMAL(10,2),
    "priceSnapshot" DECIMAL(14,2),
    "currencySnapshot" TEXT NOT NULL DEFAULT 'EUR',
    "commissionSnapshot" JSONB,
    "vatTreatmentSnapshot" "VatTreatment",
    "propertySnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "showing_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showing_parties" (
    "id" TEXT NOT NULL,
    "showingId" TEXT NOT NULL,
    "role" "ShowingPartyRole" NOT NULL,
    "contactId" TEXT,
    "fullName" TEXT NOT NULL,
    "taxIdEncrypted" TEXT,
    "taxOfficeEncrypted" TEXT,
    "idNumberEncrypted" TEXT,
    "addressEncrypted" TEXT,
    "emailEncrypted" TEXT,
    "phoneEncrypted" TEXT,
    "identityVerifiedAt" TIMESTAMP(3),
    "identityVerifiedById" TEXT,
    "representativeCapacity" "OwnerCapacity",
    "authorityReference" TEXT,
    "isSignatory" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "showing_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showing_events" (
    "id" TEXT NOT NULL,
    "showingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "showing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_owners" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "ownershipPercentage" DECIMAL(5,2),
    "capacity" "OwnerCapacity" NOT NULL DEFAULT 'OWNER',
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "isSignatory" BOOLEAN NOT NULL DEFAULT false,
    "representativeCapacity" "OwnerCapacity",
    "authorityDocumentId" TEXT,
    "authorityReference" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_extensions" (
    "id" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "previousEndDate" DATE NOT NULL,
    "newEndDate" DATE NOT NULL,
    "extensionReason" TEXT,
    "extensionTextSnapshot" TEXT,
    "templateVersionId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "status" "MandateExtensionStatus" NOT NULL DEFAULT 'DRAFT',
    "signedPdfStorageKey" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandate_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_conflict_overrides" (
    "id" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "conflictingMandateId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandate_conflict_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_milestones" (
    "id" TEXT NOT NULL,
    "mandateId" TEXT,
    "showingId" TEXT,
    "sequence" INTEGER NOT NULL,
    "percentage" DECIMAL(7,4),
    "fixedAmount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "trigger" "PaymentTrigger" NOT NULL,
    "description" TEXT,
    "dueDateRule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_entity_mappings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'home88',
    "sourceSystem" "LegacySourceSystem" NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "sourcePayloadHash" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_entity_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "showings_number_key" ON "showings"("number");

-- CreateIndex
CREATE INDEX "showings_status_idx" ON "showings"("status");

-- CreateIndex
CREATE INDEX "showings_contactId_idx" ON "showings"("contactId");

-- CreateIndex
CREATE INDEX "showings_leadId_idx" ON "showings"("leadId");

-- CreateIndex
CREATE INDEX "showings_responsibleUserId_status_idx" ON "showings"("responsibleUserId", "status");

-- CreateIndex
CREATE INDEX "showings_sourceViewingId_idx" ON "showings"("sourceViewingId");

-- CreateIndex
CREATE INDEX "showings_createdAt_idx" ON "showings"("createdAt");

-- CreateIndex
CREATE INDEX "showing_properties_propertyId_idx" ON "showing_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "showing_properties_showingId_propertyId_key" ON "showing_properties"("showingId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "showing_properties_showingId_sortOrder_key" ON "showing_properties"("showingId", "sortOrder");

-- CreateIndex
CREATE INDEX "showing_parties_showingId_idx" ON "showing_parties"("showingId");

-- CreateIndex
CREATE INDEX "showing_parties_contactId_idx" ON "showing_parties"("contactId");

-- CreateIndex
CREATE INDEX "showing_events_showingId_createdAt_idx" ON "showing_events"("showingId", "createdAt");

-- CreateIndex
CREATE INDEX "property_owners_propertyId_idx" ON "property_owners"("propertyId");

-- CreateIndex
CREATE INDEX "property_owners_contactId_idx" ON "property_owners"("contactId");

-- CreateIndex
CREATE INDEX "mandate_extensions_mandateId_status_idx" ON "mandate_extensions"("mandateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_conflict_overrides_mandateId_conflictingMandateId_key" ON "mandate_conflict_overrides"("mandateId", "conflictingMandateId");

-- CreateIndex
CREATE INDEX "payment_milestones_mandateId_idx" ON "payment_milestones"("mandateId");

-- CreateIndex
CREATE INDEX "payment_milestones_showingId_idx" ON "payment_milestones"("showingId");

-- CreateIndex
CREATE INDEX "legacy_entity_mappings_targetEntityType_targetEntityId_idx" ON "legacy_entity_mappings"("targetEntityType", "targetEntityId");

-- CreateIndex
CREATE INDEX "legacy_entity_mappings_importBatchId_idx" ON "legacy_entity_mappings"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_entity_mappings_organizationId_sourceSystem_sourceEn_key" ON "legacy_entity_mappings"("organizationId", "sourceSystem", "sourceEntityType", "legacyId");

-- CreateIndex
CREATE INDEX "viewings_showingId_idx" ON "viewings"("showingId");

-- CreateIndex
CREATE INDEX "mandates_supersedesMandateId_idx" ON "mandates"("supersedesMandateId");

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_showingId_fkey" FOREIGN KEY ("showingId") REFERENCES "showings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_supersedesMandateId_fkey" FOREIGN KEY ("supersedesMandateId") REFERENCES "mandates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_sourceViewingId_fkey" FOREIGN KEY ("sourceViewingId") REFERENCES "viewings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "mandate_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showing_properties" ADD CONSTRAINT "showing_properties_showingId_fkey" FOREIGN KEY ("showingId") REFERENCES "showings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showing_properties" ADD CONSTRAINT "showing_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showing_parties" ADD CONSTRAINT "showing_parties_showingId_fkey" FOREIGN KEY ("showingId") REFERENCES "showings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showing_parties" ADD CONSTRAINT "showing_parties_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showing_events" ADD CONSTRAINT "showing_events_showingId_fkey" FOREIGN KEY ("showingId") REFERENCES "showings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_authorityDocumentId_fkey" FOREIGN KEY ("authorityDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_extensions" ADD CONSTRAINT "mandate_extensions_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_conflict_overrides" ADD CONSTRAINT "mandate_conflict_overrides_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_showingId_fkey" FOREIGN KEY ("showingId") REFERENCES "showings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Integrity rules the database enforces on its own
-- ===========================================================================

-- A showing number is ΥΠ-YYYY-NNNNNN and agrees with the stored year; once a
-- showing has left the draft stages it has a number, an issue time and a template.
ALTER TABLE "showings"
  ADD CONSTRAINT "showings_number_format_check" CHECK ("number" IS NULL OR "number" ~ '^ΥΠ-[0-9]{4}-[0-9]{6}$'),
  ADD CONSTRAINT "showings_number_year_check" CHECK ("number" IS NULL OR ("year" IS NOT NULL AND "number" LIKE 'ΥΠ-' || "year"::text || '-%')),
  ADD CONSTRAINT "showings_issued_complete_check" CHECK (
    "status" IN ('DRAFT', 'READY_FOR_ISSUANCE', 'CANCELLED')
    OR ("number" IS NOT NULL AND "issuedAt" IS NOT NULL AND "templateVersionId" IS NOT NULL)
  );

-- Fee rules shared by showings and mandates (new columns only, so existing
-- mandates are unaffected): bounds, one method at a time, VAT rate only
-- where VAT applies.
ALTER TABLE "showings"
  ADD CONSTRAINT "showings_fee_bounds_check" CHECK (
    ("feePercentage" IS NULL OR ("feePercentage" >= 0 AND "feePercentage" <= 100))
    AND ("feeFixedAmount" IS NULL OR "feeFixedAmount" >= 0)
    AND ("vatRate" IS NULL OR ("vatRate" >= 0 AND "vatRate" <= 100))
  ),
  ADD CONSTRAINT "showings_fee_method_check" CHECK (
    NOT ("feeMethod" = 'PERCENTAGE' AND "feeFixedAmount" IS NOT NULL)
    AND NOT ("feeMethod" = 'FIXED_AMOUNT' AND "feePercentage" IS NOT NULL)
  ),
  ADD CONSTRAINT "showings_vat_rate_check" CHECK ("vatRate" IS NULL OR "vatTreatment" IN ('PLUS_VAT', 'VAT_INCLUDED'));

ALTER TABLE "mandates"
  ADD CONSTRAINT "mandates_fee_bounds_check" CHECK (
    ("feePercentage" IS NULL OR ("feePercentage" >= 0 AND "feePercentage" <= 100))
    AND ("feeFixedAmount" IS NULL OR "feeFixedAmount" >= 0)
    AND ("vatRate" IS NULL OR ("vatRate" >= 0 AND "vatRate" <= 100))
  ),
  ADD CONSTRAINT "mandates_fee_method_check" CHECK (
    NOT ("feeMethod" = 'PERCENTAGE' AND "feeFixedAmount" IS NOT NULL)
    AND NOT ("feeMethod" = 'FIXED_AMOUNT' AND "feePercentage" IS NOT NULL)
  ),
  ADD CONSTRAINT "mandates_vat_rate_check" CHECK ("vatRate" IS NULL OR "vatTreatment" IN ('PLUS_VAT', 'VAT_INCLUDED')),
  -- An exclusive mandate is never open-ended; a fixed term has an end.
  ADD CONSTRAINT "mandates_exclusive_term_check" CHECK (NOT ("type" = 'EXCLUSIVE_ASSIGNMENT' AND "durationType" = 'INDEFINITE')),
  ADD CONSTRAINT "mandates_fixed_term_end_check" CHECK ("durationType" IS DISTINCT FROM 'FIXED_TERM' OR "endsAt" IS NOT NULL),
  -- NOT VALID: enforced for every new or changed row without re-checking history.
  ADD CONSTRAINT "mandates_dates_ordered_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" >= "startsAt") NOT VALID;

ALTER TABLE "showing_properties"
  ADD CONSTRAINT "showing_properties_values_check" CHECK (
    "sortOrder" >= 0 AND ("priceSnapshot" IS NULL OR "priceSnapshot" >= 0) AND ("areaSnapshot" IS NULL OR "areaSnapshot" >= 0)
  );

ALTER TABLE "property_owners"
  ADD CONSTRAINT "property_owners_percentage_check" CHECK ("ownershipPercentage" IS NULL OR ("ownershipPercentage" >= 0 AND "ownershipPercentage" <= 100)),
  ADD CONSTRAINT "property_owners_validity_check" CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validTo" >= "validFrom"),
  -- Someone acting for another needs the authority on record.
  ADD CONSTRAINT "property_owners_authority_check" CHECK (
    NOT (
      ("capacity" IN ('LEGAL_REPRESENTATIVE', 'ATTORNEY_IN_FACT', 'COMPANY_REPRESENTATIVE')
        OR "representativeCapacity" IN ('LEGAL_REPRESENTATIVE', 'ATTORNEY_IN_FACT', 'COMPANY_REPRESENTATIVE'))
      AND "authorityDocumentId" IS NULL AND "authorityReference" IS NULL
    )
  );

-- One current primary contact per property, and one current row per person and capacity.
CREATE UNIQUE INDEX "property_owners_one_primary_idx" ON "property_owners"("propertyId") WHERE "isPrimaryContact" AND "validTo" IS NULL;
CREATE UNIQUE INDEX "property_owners_current_idx" ON "property_owners"("propertyId", "contactId", "capacity") WHERE "validTo" IS NULL;

ALTER TABLE "mandate_extensions"
  ADD CONSTRAINT "mandate_extensions_dates_check" CHECK ("newEndDate" > "previousEndDate"),
  ADD CONSTRAINT "mandate_extensions_issued_check" CHECK ("status" = 'DRAFT' OR "status" = 'CANCELLED' OR "issuedAt" IS NOT NULL),
  ADD CONSTRAINT "mandate_extensions_signed_check" CHECK ("status" <> 'SIGNED' OR "signedAt" IS NOT NULL);

-- A milestone belongs to exactly one parent and carries exactly one amount.
ALTER TABLE "payment_milestones"
  ADD CONSTRAINT "payment_milestones_one_parent_check" CHECK (("mandateId" IS NULL) <> ("showingId" IS NULL)),
  ADD CONSTRAINT "payment_milestones_one_amount_check" CHECK (("percentage" IS NULL) <> ("fixedAmount" IS NULL)),
  ADD CONSTRAINT "payment_milestones_values_check" CHECK (
    "sequence" > 0 AND ("percentage" IS NULL OR ("percentage" > 0 AND "percentage" <= 100)) AND ("fixedAmount" IS NULL OR "fixedAmount" > 0)
  );
CREATE UNIQUE INDEX "payment_milestones_mandate_seq_idx" ON "payment_milestones"("mandateId", "sequence") WHERE "mandateId" IS NOT NULL;
CREATE UNIQUE INDEX "payment_milestones_showing_seq_idx" ON "payment_milestones"("showingId", "sequence") WHERE "showingId" IS NOT NULL;

-- Legacy wording can never be ACTIVE until counsel's approval is recorded
-- against this exact text.
ALTER TABLE "mandate_template_versions"
  ADD CONSTRAINT "mandate_template_versions_legacy_review_check" CHECK ("source" <> 'ESTATE_PLUS_LEGACY' OR "requiresLegalReview"),
  ADD CONSTRAINT "mandate_template_versions_legal_approval_check" CHECK (
    NOT "requiresLegalReview" OR "status" <> 'ACTIVE'
    OR ("legalApprovedAt" IS NOT NULL AND "legalApprovedBy" IS NOT NULL AND "legalApprovedChecksum" IS NOT NULL AND "legalApprovedChecksum" = "checksum")
  );

ALTER TABLE "mandate_settings"
  ADD CONSTRAINT "mandate_settings_max_exclusive_check" CHECK ("maxExclusiveMonths" IS NULL OR "maxExclusiveMonths" > 0);

ALTER TABLE "legacy_entity_mappings"
  ADD CONSTRAINT "legacy_entity_mappings_values_check" CHECK (length(trim("legacyId")) > 0 AND length(trim("sourceEntityType")) > 0 AND length(trim("targetEntityId")) > 0);

-- ===========================================================================
-- Immutability: once issued, what was agreed does not change
-- ===========================================================================

-- A showing moves DRAFT -> READY_FOR_ISSUANCE -> ISSUED -> SENT -> VIEWED ->
-- SIGNED (or DECLINED / EXPIRED / CANCELLED) and only along those paths. After
-- issue the number, parties, terms, fee, template and snapshots are frozen;
-- only the signing progress moves. A final showing does not change at all.
-- Links the database clears itself (a deleted contact, user, viewing) are
-- always allowed.
CREATE OR REPLACE FUNCTION public.h88_guard_showing() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  links text[] := ARRAY['contactId', 'leadId', 'responsibleUserId', 'sourceViewingId', 'updatedAt'];
  progress text[] := ARRAY['status', 'sentAt', 'viewedAt', 'signedAt', 'declinedAt', 'expiresAt', 'cancelledAt',
    'cancelReason', 'signedPdfStorageKey', 'signedPdfChecksum', 'completenessResult', 'completenessCheckedAt'];
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

CREATE TRIGGER h88_showing_guard BEFORE UPDATE OR DELETE ON "showings"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_showing();

-- The properties listed in a showing are what was printed. After issue they
-- cannot be added, removed or rewritten; the only change allowed is the
-- database clearing the link to a property record that was deleted.
CREATE OR REPLACE FUNCTION public.h88_guard_showing_property() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT s.status::text INTO parent_status FROM public.showings s
  WHERE s.id = CASE WHEN TG_OP = 'INSERT' THEN NEW."showingId" ELSE OLD."showingId" END;
  IF parent_status IS NULL OR parent_status IN ('DRAFT', 'READY_FOR_ISSUANCE') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'propertyId') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'propertyId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'the properties of an issued showing cannot be changed';
END $$;

CREATE TRIGGER h88_showing_property_guard BEFORE INSERT OR UPDATE OR DELETE ON "showing_properties"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_showing_property();

-- Likewise the parties: only the signing time (and a cleared contact link) moves.
CREATE OR REPLACE FUNCTION public.h88_guard_showing_party() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT s.status::text INTO parent_status FROM public.showings s
  WHERE s.id = CASE WHEN TG_OP = 'INSERT' THEN NEW."showingId" ELSE OLD."showingId" END;
  IF parent_status IS NULL OR parent_status IN ('DRAFT', 'READY_FOR_ISSUANCE') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['signedAt', 'contactId']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['signedAt', 'contactId'])
     AND (OLD."signedAt" IS NULL OR NEW."signedAt" IS NOT DISTINCT FROM OLD."signedAt") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'the parties of an issued showing cannot be changed';
END $$;

CREATE TRIGGER h88_showing_party_guard BEFORE INSERT OR UPDATE OR DELETE ON "showing_parties"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_showing_party();

-- The agreed payment schedule is part of the agreement: editable only while its
-- mandate or showing is still a draft.
CREATE OR REPLACE FUNCTION public.h88_guard_payment_milestone() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  mid text := CASE WHEN TG_OP = 'INSERT' THEN NEW."mandateId" ELSE OLD."mandateId" END;
  sid text := CASE WHEN TG_OP = 'INSERT' THEN NEW."showingId" ELSE OLD."showingId" END;
  parent_status text;
BEGIN
  IF mid IS NOT NULL THEN
    SELECT m.status INTO parent_status FROM public.mandates m WHERE m.id = mid;
    IF parent_status IS NULL OR parent_status = 'DRAFT' THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
  ELSE
    SELECT s.status::text INTO parent_status FROM public.showings s WHERE s.id = sid;
    IF parent_status IS NULL OR parent_status IN ('DRAFT', 'READY_FOR_ISSUANCE') THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
  END IF;
  RAISE EXCEPTION 'the payment schedule of an issued document cannot be changed';
END $$;

CREATE TRIGGER h88_payment_milestone_guard BEFORE INSERT OR UPDATE OR DELETE ON "payment_milestones"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_payment_milestone();

-- An extension is a historical record: free while a draft; once issued only its
-- signing progress moves (ISSUED -> SIGNED / CANCELLED); then it never changes.
CREATE OR REPLACE FUNCTION public.h88_guard_mandate_extension() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  progress text[] := ARRAY['status', 'signedAt', 'signedPdfStorageKey', 'updatedAt'];
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

CREATE TRIGGER h88_mandate_extension_guard BEFORE UPDATE OR DELETE ON "mandate_extensions"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_mandate_extension();

-- Showing timeline and conflict overrides are append-only (function from the transactions migration).
CREATE TRIGGER h88_showing_events_append_only BEFORE UPDATE OR DELETE ON "showing_events"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_append_only();
CREATE TRIGGER h88_mandate_conflict_overrides_append_only BEFORE UPDATE OR DELETE ON "mandate_conflict_overrides"
FOR EACH ROW EXECUTE FUNCTION public.h88_guard_append_only();

-- The mandate guard (20261012010000_mandates) also lets the database clear the
-- new supersedesMandateId link when the replaced draft is deleted.
CREATE OR REPLACE FUNCTION public.h88_guard_mandate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  links text[] := ARRAY['propertyId', 'sellerLeadId', 'agentId', 'supersedesMandateId', 'updatedAt'];
  progress text[] := ARRAY['status', 'sentAt', 'viewedAt', 'signedAt', 'declinedAt', 'expiredAt', 'cancelledAt',
    'cancelReason', 'signatureMethod', 'signatureProvider', 'signatureLevel', 'envelopeId', 'signingExpiresAt',
    'signedDocumentId', 'signedChecksum'];
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

-- Trigger functions are not callable through the API.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['h88_guard_showing', 'h88_guard_showing_property', 'h88_guard_showing_party',
                           'h88_guard_payment_milestone', 'h88_guard_mandate_extension'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM anon', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM authenticated', f);
    END IF;
  END LOOP;
END $$;

-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "showings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "showing_properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "showing_parties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "showing_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_owners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandate_extensions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandate_conflict_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_milestones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legacy_entity_mappings" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['showings', 'showing_properties', 'showing_parties', 'showing_events', 'property_owners',
                           'mandate_extensions', 'mandate_conflict_overrides', 'payment_milestones', 'legacy_entity_mappings'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
