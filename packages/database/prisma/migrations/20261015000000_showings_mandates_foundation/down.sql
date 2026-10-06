-- Manual rollback for 20261015000000_showings_mandates_foundation (Prisma does
-- not run this file). Existing mandates, viewings, properties and templates keep
-- all their original data; everything stored in the new tables and columns is
-- lost, so export it first. Run inside a transaction:
--   psql "$DATABASE_URL" -1 -f down.sql
-- then remove the row for this migration from "_prisma_migrations" if you want
-- Prisma to apply it again.

DROP TABLE IF EXISTS "legacy_entity_mappings", "payment_milestones", "mandate_conflict_overrides", "mandate_extensions",
  "property_owners", "showing_events", "showing_parties", "showing_properties";
ALTER TABLE "viewings" DROP CONSTRAINT IF EXISTS "viewings_showingId_fkey";
DROP INDEX IF EXISTS "viewings_showingId_idx";
ALTER TABLE "viewings" DROP COLUMN IF EXISTS "showingId";
DROP TABLE IF EXISTS "showings";

-- Mandates: the guard first (the original link list), then the added columns.
CREATE OR REPLACE FUNCTION public.h88_guard_mandate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  links text[] := ARRAY['propertyId', 'sellerLeadId', 'agentId', 'updatedAt'];
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

ALTER TABLE "mandates" DISABLE TRIGGER h88_mandate_guard;
ALTER TABLE "mandates"
  DROP CONSTRAINT IF EXISTS "mandates_fee_bounds_check", DROP CONSTRAINT IF EXISTS "mandates_fee_method_check",
  DROP CONSTRAINT IF EXISTS "mandates_vat_rate_check", DROP CONSTRAINT IF EXISTS "mandates_exclusive_term_check",
  DROP CONSTRAINT IF EXISTS "mandates_fixed_term_end_check", DROP CONSTRAINT IF EXISTS "mandates_dates_ordered_check",
  DROP CONSTRAINT IF EXISTS "mandates_supersedesMandateId_fkey";
DROP INDEX IF EXISTS "mandates_supersedesMandateId_idx";
ALTER TABLE "mandates"
  DROP COLUMN IF EXISTS "feePayer", DROP COLUMN IF EXISTS "feeMethod", DROP COLUMN IF EXISTS "feeBasis",
  DROP COLUMN IF EXISTS "feePercentage", DROP COLUMN IF EXISTS "feeFixedAmount", DROP COLUMN IF EXISTS "feeCurrency",
  DROP COLUMN IF EXISTS "vatTreatment", DROP COLUMN IF EXISTS "vatRate", DROP COLUMN IF EXISTS "paymentTrigger",
  DROP COLUMN IF EXISTS "feeAnomalyOverrideReason", DROP COLUMN IF EXISTS "feeAnomalyOverriddenById",
  DROP COLUMN IF EXISTS "durationType", DROP COLUMN IF EXISTS "knownDefects", DROP COLUMN IF EXISTS "defectsDisclosureConfirmed",
  DROP COLUMN IF EXISTS "defectsDescription", DROP COLUMN IF EXISTS "photoPermission", DROP COLUMN IF EXISTS "videoPermission",
  DROP COLUMN IF EXISTS "floorplanPermission", DROP COLUMN IF EXISTS "signboardPermission",
  DROP COLUMN IF EXISTS "portalPublicationPermission", DROP COLUMN IF EXISTS "socialMediaPermission",
  DROP COLUMN IF EXISTS "cooperatingBrokerPermission", DROP COLUMN IF EXISTS "brokerCooperationAllowed",
  DROP COLUMN IF EXISTS "dualRepresentationConsent", DROP COLUMN IF EXISTS "marketingChannels",
  DROP COLUMN IF EXISTS "specialTerms", DROP COLUMN IF EXISTS "supersedesMandateId",
  DROP COLUMN IF EXISTS "completenessResult", DROP COLUMN IF EXISTS "completenessCheckedAt";
ALTER TABLE "mandates" ENABLE TRIGGER h88_mandate_guard;

ALTER TABLE "mandate_template_versions"
  DROP CONSTRAINT IF EXISTS "mandate_template_versions_legacy_review_check", DROP CONSTRAINT IF EXISTS "mandate_template_versions_legal_approval_check";
ALTER TABLE "mandate_template_versions"
  DROP COLUMN IF EXISTS "source", DROP COLUMN IF EXISTS "requiresLegalReview", DROP COLUMN IF EXISTS "legalReviewFlags",
  DROP COLUMN IF EXISTS "legalApprovedAt", DROP COLUMN IF EXISTS "legalApprovedBy", DROP COLUMN IF EXISTS "legalApprovedChecksum";
ALTER TABLE "mandate_settings" DROP CONSTRAINT IF EXISTS "mandate_settings_max_exclusive_check";
ALTER TABLE "mandate_settings" DROP COLUMN IF EXISTS "maxExclusiveMonths";

DROP FUNCTION IF EXISTS public.h88_guard_showing(), public.h88_guard_showing_property(), public.h88_guard_showing_party(),
  public.h88_guard_payment_milestone(), public.h88_guard_mandate_extension();

DROP TYPE IF EXISTS "ShowingStatus", "ShowingPartyRole", "FeePayer", "FeeMethod", "FeeBasis", "VatTreatment", "PaymentTrigger",
  "DurationType", "OwnerCapacity", "MandateExtensionStatus", "LegacySourceSystem";
