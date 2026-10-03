-- Settings foundation: typed settings tables, write-only provider
-- credentials, the settings audit trail, role permission overrides, property
-- tags, the area hierarchy, mandate template versions and portal rules.
-- Additive only: no existing column changes meaning.

-- AlterTable
ALTER TABLE "portals" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "officeName" TEXT,
    "legalName" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "mobile" TEXT,
    "addressEl" TEXT,
    "addressEn" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "hoursEl" TEXT,
    "hoursEn" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_social_links" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_social_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_legal_details" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "legalNameEl" TEXT,
    "legalNameEn" TEXT,
    "activityEl" TEXT,
    "activityEn" TEXT,
    "vatNumber" TEXT,
    "taxOffice" TEXT,
    "gemiNumber" TEXT,
    "kefodeEl" TEXT,
    "kefodeEn" TEXT,
    "registeredAddressEl" TEXT,
    "registeredAddressEn" TEXT,
    "phone" TEXT,
    "legalEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "company_legal_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_branding" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "colorPrimary" TEXT,
    "colorDark" TEXT,
    "colorSecondary" TEXT,
    "colorBackground" TEXT,
    "siteTitle" TEXT,
    "siteDescription" TEXT,
    "defaultLanguage" TEXT,
    "availableLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "company_branding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "listingFooterEl" TEXT,
    "listingFooterEn" TEXT,
    "uppercaseDescriptions" BOOLEAN,
    "uploadMode" TEXT,
    "watermarkEnabled" BOOLEAN,
    "watermarkPosition" TEXT,
    "allowDuplicateContacts" BOOLEAN,
    "showCustomerNames" TEXT,
    "showContactDetails" TEXT,
    "propertyRefreshDays" INTEGER,
    "requestRefreshDays" INTEGER,
    "mapDefaultLat" DOUBLE PRECISION,
    "mapDefaultLng" DOUBLE PRECISION,
    "showExactLocation" BOOLEAN,
    "mapsBrowserKey" TEXT,
    "timezone" TEXT,
    "currency" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "approvalRequired" BOOLEAN,
    "minPhotosToPublish" INTEGER,
    "requireEnglishDescription" BOOLEAN,
    "requireEnergyClass" BOOLEAN,
    "staleAfterDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "property_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "duplicateCheckPhone" BOOLEAN,
    "duplicateCheckEmail" BOOLEAN,
    "duplicateCheckName" BOOLEAN,
    "enabledSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultContactMethod" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "contact_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "minMatchScore" INTEGER,
    "maxMatches" INTEGER,
    "priceTolerancePct" INTEGER,
    "sizeTolerancePct" INTEGER,
    "weightArea" INTEGER,
    "weightPrice" INTEGER,
    "weightSize" INTEGER,
    "weightBedrooms" INTEGER,
    "weightBathrooms" INTEGER,
    "weightFloor" INTEGER,
    "weightYear" INTEGER,
    "weightFeatures" INTEGER,
    "expiryDays" INTEGER,
    "newMatchAlerts" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "request_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "saleCommissionPct" DECIMAL(7,3),
    "rentCommissionMonths" DECIMAL(6,2),
    "assignmentCommissionPct" DECIMAL(7,3),
    "minimumFee" DECIMAL(12,2),
    "buyerSidePct" DECIMAL(7,3),
    "sellerSidePct" DECIMAL(7,3),
    "agentSharePct" DECIMAL(7,3),
    "agencySharePct" DECIMAL(7,3),
    "vatMode" TEXT,
    "vatRatePct" DECIMAL(7,3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "commission_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "timezone" TEXT,
    "workingDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "workdayStart" TEXT,
    "workdayEnd" TEXT,
    "viewingMinutes" INTEGER,
    "defaultAppointmentMinutes" INTEGER,
    "reminderMinutesBefore" INTEGER,
    "enabledEventCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "calendar_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "numberingPrefix" TEXT,
    "numberingDigits" INTEGER,
    "signatureProvider" TEXT,
    "signatureLevel" TEXT,
    "signatureApiUrl" TEXT,
    "signatureAccountId" TEXT,
    "signingExpiryDays" INTEGER,
    "reminderScheduleDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "retentionYears" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "mandate_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_templates" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_template_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "mandate_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "mode" TEXT,
    "apiProvider" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUsername" TEXT,
    "smtpTls" BOOLEAN,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "disclaimerEl" TEXT,
    "disclaimerEn" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT,
    "senderName" TEXT,
    "accountId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "sms_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "sessionTimeoutHours" INTEGER,
    "passwordMinLength" INTEGER,
    "maxLoginAttempts" INTEGER,
    "lockoutMinutes" INTEGER,
    "mfaPolicy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "security_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "privacyEmail" TEXT,
    "dmcaEmail" TEXT,
    "analyticsEnabled" BOOLEAN,
    "marketingDoubleOptIn" BOOLEAN,
    "leadRetentionMonths" INTEGER,
    "contactRetentionMonths" INTEGER,
    "emailLogRetentionMonths" INTEGER,
    "auditRetentionMonths" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "privacy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "plan" TEXT,
    "status" TEXT,
    "startsAt" DATE,
    "expiresAt" DATE,
    "renewal" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "subscription_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_credentials" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings_audit_log" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "field" TEXT,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_tags" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelEl" TEXT NOT NULL,
    "labelEn" TEXT,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "legacyLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "parentId" TEXT,
    "nameEl" TEXT NOT NULL,
    "nameEn" TEXT,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "area_external_mappings" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "portalCode" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "area_external_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_publication_rules" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'NONE',
    "propertyTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "portal_publication_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_social_links_platform_key" ON "company_social_links"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_locale_key" ON "company_profiles"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_event_channel_key" ON "notification_settings"("event", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_templates_type_locale_key" ON "mandate_templates"("type", "locale");

-- CreateIndex
CREATE INDEX "mandate_template_versions_templateId_status_idx" ON "mandate_template_versions"("templateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_template_versions_templateId_version_key" ON "mandate_template_versions"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "provider_credentials_scope_field_key" ON "provider_credentials"("scope", "field");

-- CreateIndex
CREATE INDEX "settings_audit_log_section_createdAt_idx" ON "settings_audit_log"("section", "createdAt");

-- CreateIndex
CREATE INDEX "settings_audit_log_createdAt_idx" ON "settings_audit_log"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_permission_key" ON "role_permissions"("role", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "property_tags_code_key" ON "property_tags"("code");

-- CreateIndex
CREATE UNIQUE INDEX "areas_slug_key" ON "areas"("slug");

-- CreateIndex
CREATE INDEX "areas_parentId_idx" ON "areas"("parentId");

-- CreateIndex
CREATE INDEX "areas_level_idx" ON "areas"("level");

-- CreateIndex
CREATE INDEX "area_external_mappings_portalCode_externalId_idx" ON "area_external_mappings"("portalCode", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "area_external_mappings_areaId_portalCode_key" ON "area_external_mappings"("areaId", "portalCode");

-- CreateIndex
CREATE UNIQUE INDEX "portal_publication_rules_portalId_key" ON "portal_publication_rules"("portalId");

-- AddForeignKey
ALTER TABLE "mandate_template_versions" ADD CONSTRAINT "mandate_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "mandate_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "area_external_mappings" ADD CONSTRAINT "area_external_mappings_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_publication_rules" ADD CONSTRAINT "portal_publication_rules_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_social_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_legal_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_branding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandate_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandate_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandate_template_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "areas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "area_external_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_publication_rules" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_settings', 'company_social_links', 'company_profiles', 'company_legal_details', 'company_branding', 'app_settings', 'property_settings', 'contact_settings', 'request_settings', 'commission_settings', 'calendar_settings', 'notification_settings', 'mandate_settings', 'mandate_templates', 'mandate_template_versions', 'email_settings', 'sms_settings', 'security_settings', 'privacy_settings', 'subscription_settings', 'provider_credentials', 'settings_audit_log', 'role_permissions', 'property_tags', 'areas', 'area_external_mappings', 'portal_publication_rules'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- System tags with stable codes, replacing the Estate+ free-text categories.
-- Labels are editable; codes are what reports and rules depend on.
INSERT INTO "property_tags" ("id", "code", "labelEl", "labelEn", "color", "isSystem", "legacyLabels", "sortOrder", "updatedAt") VALUES
  ('tag_do_not_call', 'DO_NOT_CALL', 'Δεν καλούμε', 'Do not call', 'red', true, ARRAY['Δεν καλούμε']::text[], 10, CURRENT_TIMESTAMP),
  ('tag_owner_contact', 'OWNER_CONTACT', 'Να καλέσουμε τον ιδιοκτήτη', 'Call the owner', 'amber', true, ARRAY[]::text[], 20, CURRENT_TIMESTAMP),
  ('tag_contacted', 'CONTACTED', 'Επικοινωνήσαμε — διαθέσιμο', 'Contacted — available', 'green', true, ARRAY['Πήραμε τηλ. και είναι διαθέσιμο']::text[], 30, CURRENT_TIMESTAMP),
  ('tag_no_answer', 'NO_ANSWER', 'Δεν απάντησε', 'No answer', 'amber', true, ARRAY['Πήραμε δεν απάντησε']::text[], 40, CURRENT_TIMESTAMP),
  ('tag_wrong_phone', 'WRONG_PHONE', 'Λάθος τηλέφωνο', 'Wrong phone', 'red', true, ARRAY['Έχει λάθος τηλ']::text[], 50, CURRENT_TIMESTAMP),
  ('tag_do_not_publish', 'DO_NOT_PUBLISH', 'Να μη δημοσιευθεί', 'Do not publish', 'red', true, ARRAY['Να μην δημοσιευθεί πουθενά']::text[], 60, CURRENT_TIMESTAMP),
  ('tag_exclusive', 'EXCLUSIVE', 'Αποκλειστική ανάθεση', 'Exclusive mandate', 'violet', true, ARRAY['Αποκλειστική Ανάθεση']::text[], 70, CURRENT_TIMESTAMP),
  ('tag_website_only', 'WEBSITE_ONLY', 'Μόνο στον ιστότοπο', 'Website only', 'blue', true, ARRAY['Μόνο site μας']::text[], 80, CURRENT_TIMESTAMP),
  ('tag_portal_only', 'PORTAL_ONLY', 'Μόνο σε portals', 'Portals only', 'blue', true, ARRAY[]::text[], 90, CURRENT_TIMESTAMP),
  ('tag_cooperation', 'COOPERATION', 'Συνεργασία', 'Co-broker', 'slate', true, ARRAY['Συνεργασία']::text[], 100, CURRENT_TIMESTAMP),
  ('tag_developer', 'DEVELOPER', 'Κατασκευαστής', 'Developer', 'slate', true, ARRAY['Κατασκευαστής']::text[], 110, CURRENT_TIMESTAMP),
  ('tag_antiparochi', 'ANTIPAROCHI', 'Αντιπαροχή', 'Land-for-flats exchange', 'slate', true, ARRAY['Αντιπαροχή / Δίνεται και Αντιπαροχή']::text[], 120, CURRENT_TIMESTAMP),
  ('tag_review_notes', 'REVIEW_NOTES', 'Έλεγχος σημειώσεων', 'Review notes', 'amber', true, ARRAY['Να κοιτάξουμε σημειώσεις!!']::text[], 130, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
