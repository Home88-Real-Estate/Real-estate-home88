-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'AGENT', 'MARKETING', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INVITED');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('SALE', 'RENT', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RESERVED', 'SOLD', 'RENTED', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'MAISONETTE', 'HOUSE', 'VILLA', 'STUDIO', 'OFFICE', 'SHOP', 'WAREHOUSE', 'BUILDING', 'HOTEL', 'LAND', 'PLOT', 'PARKING', 'INDUSTRIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyCondition" AS ENUM ('NEW_BUILD', 'RENOVATED', 'GOOD', 'NEEDS_RENOVATION', 'UNDER_CONSTRUCTION');

-- CreateEnum
CREATE TYPE "EnergyClass" AS ENUM ('A_PLUS', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'NOT_AVAILABLE');

-- CreateEnum
CREATE TYPE "HeatingType" AS ENUM ('CENTRAL', 'INDIVIDUAL', 'UNDERFLOOR', 'HEAT_PUMP', 'GAS', 'NONE', 'NOT_AVAILABLE');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'FLOOR_PLAN', 'VIDEO', 'VIRTUAL_TOUR', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'OFFER', 'WON', 'LOST', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'PROPERTY_ENQUIRY', 'PHONE', 'WHATSAPP', 'EMAIL', 'SPITOGATOS', 'XE_GR', 'PORTAL_OTHER', 'WALK_IN', 'REFERRAL', 'SOCIAL', 'IMPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('BUYER', 'SELLER', 'LANDLORD', 'TENANT', 'OTHER');

-- CreateEnum
CREATE TYPE "PreferredContactMethod" AS ENUM ('PHONE', 'EMAIL', 'WHATSAPP', 'SMS', 'ANY');

-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('SUBMITTED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('CONTRACT', 'DEED', 'ID_VERIFICATION', 'TAX', 'INSPECTION', 'APPRAISAL', 'INVOICE', 'OTHER');

-- CreateEnum
CREATE TYPE "PortalTransport" AS ENUM ('API', 'XML_FEED', 'CSV_FEED', 'MANUAL');

-- CreateEnum
CREATE TYPE "PortalSyncState" AS ENUM ('NOT_PUBLISHED', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'REMOVED', 'OUTDATED');

-- CreateEnum
CREATE TYPE "SyncAction" AS ENUM ('PUBLISH', 'UPDATE', 'REMOVE', 'REPUBLISH', 'IMPORT_LEADS');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('NECESSARY', 'ANALYTICS', 'MARKETING', 'PROPERTY_ENQUIRY', 'SESSION_REPLAY');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBE', 'HARD_BOUNCE', 'COMPLAINT', 'MANUAL', 'SUPPRESSED_BY_ADMIN');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE', 'PORTABILITY', 'OBJECTION', 'RESTRICTION');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DmcaStatus" AS ENUM ('RECEIVED', 'UNDER_REVIEW', 'ACTIONED', 'COUNTER_NOTICE', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditEntity" AS ENUM ('PROPERTY', 'LEAD', 'CONTACT', 'USER', 'OFFER', 'VIEWING', 'TASK', 'DOCUMENT', 'PORTAL', 'PORTAL_LISTING', 'CONSENT', 'EMAIL', 'SETTINGS');

-- CreateTable
CREATE TABLE "ReferenceCounter" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "dateOfBirth" DATE,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'el',
    "createdById" TEXT,
    "deactivatedById" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "deletionRequestedAt" TIMESTAMP(3),
    "erasureCompletedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "company" TEXT,
    "emailEncrypted" TEXT,
    "emailHash" TEXT,
    "phoneEncrypted" TEXT,
    "mobileEncrypted" TEXT,
    "roles" "ContactRole"[],
    "taxIdEncrypted" TEXT,
    "addressEncrypted" TEXT,
    "preferredContactMethod" "PreferredContactMethod" NOT NULL DEFAULT 'ANY',
    "preferredLocale" TEXT NOT NULL DEFAULT 'el',
    "marketingOptOutAt" TIMESTAMP(3),
    "erasureRequestedAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "listingType" "ListingType" NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "condition" "PropertyCondition" NOT NULL DEFAULT 'GOOD',
    "titleEl" TEXT NOT NULL,
    "titleEn" TEXT,
    "descriptionEl" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "price" DECIMAL(14,2),
    "priceOnRequest" BOOLEAN NOT NULL DEFAULT false,
    "monthlyRent" DECIMAL(14,2),
    "area" DECIMAL(10,2),
    "plotArea" DECIMAL(10,2),
    "builtArea" DECIMAL(10,2),
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "wc" INTEGER,
    "floor" INTEGER,
    "totalFloors" INTEGER,
    "yearBuilt" INTEGER,
    "yearRenovated" INTEGER,
    "heating" "HeatingType" NOT NULL DEFAULT 'NOT_AVAILABLE',
    "energyClass" "EnergyClass" NOT NULL DEFAULT 'NOT_AVAILABLE',
    "hasSolar" BOOLEAN NOT NULL DEFAULT false,
    "parking" BOOLEAN NOT NULL DEFAULT false,
    "parkingSpaces" INTEGER,
    "storage" BOOLEAN NOT NULL DEFAULT false,
    "balcony" BOOLEAN NOT NULL DEFAULT false,
    "balconyArea" DECIMAL(8,2),
    "garden" BOOLEAN NOT NULL DEFAULT false,
    "pool" BOOLEAN NOT NULL DEFAULT false,
    "furnished" BOOLEAN NOT NULL DEFAULT false,
    "petsAllowed" BOOLEAN NOT NULL DEFAULT false,
    "seaView" BOOLEAN NOT NULL DEFAULT false,
    "newConstruction" BOOLEAN NOT NULL DEFAULT false,
    "region" TEXT,
    "city" TEXT,
    "areaName" TEXT,
    "neighborhood" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "videoUrl" TEXT,
    "virtualTourUrl" TEXT,
    "publishedOnWebsite" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "agentId" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT,
    "commissionRatePct" DECIMAL(5,2),
    "agentCommissionPct" DECIMAL(5,2),
    "retentionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_media" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'PHOTO',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "altEl" TEXT,
    "altEn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "message" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "LeadSource" NOT NULL DEFAULT 'WEBSITE',
    "sourcePortalId" TEXT,
    "sourceListingId" TEXT,
    "sourceUrl" TEXT,
    "preferredContactMethod" "PreferredContactMethod" NOT NULL DEFAULT 'ANY',
    "locale" TEXT NOT NULL DEFAULT 'el',
    "budgetMin" DECIMAL(14,2),
    "budgetMax" DECIMAL(14,2),
    "propertyId" TEXT,
    "contactId" TEXT,
    "assignedToId" TEXT,
    "consentRecordId" TEXT,
    "marketingOptOutAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3),
    "erasureRequestedAt" TIMESTAMP(3),
    "ageVerifiedAt" TIMESTAMP(3),
    "ageVerificationFail" BOOLEAN NOT NULL DEFAULT false,
    "lastContactedAt" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "leadId" TEXT,
    "contactId" TEXT,
    "propertyId" TEXT,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewings" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "clientEmail" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" "ViewingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "feedback" TEXT,
    "outcome" TEXT,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viewings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'SUBMITTED',
    "conditions" TEXT,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "agentId" TEXT,
    "commissionAmount" DECIMAL(14,2),
    "agentCommissionAmount" DECIMAL(14,2),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "leadId" TEXT,
    "propertyId" TEXT,
    "viewingId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "contactId" TEXT,
    "title" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT,
    "containsPersonalData" BOOLEAN NOT NULL DEFAULT false,
    "retentionExpiresAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "transport" "PortalTransport" NOT NULL DEFAULT 'MANUAL',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT,
    "feedUrl" TEXT,
    "credentialsRef" TEXT,
    "defaultAgentExternalId" TEXT,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_listings" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "state" "PortalSyncState" NOT NULL DEFAULT 'NOT_PUBLISHED',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastPayloadHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sync_logs" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "portalListingId" TEXT,
    "propertyId" TEXT,
    "action" "SyncAction" NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_property_mappings" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "lastConfirmed" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_property_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "email" TEXT,
    "userId" TEXT,
    "purpose" "ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT,
    "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'OPEN',
    "subjectName" TEXT NOT NULL,
    "subjectEmail" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "findings" JSONB,
    "completedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "notes" TEXT,
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dmca_notices" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "claimantName" TEXT NOT NULL,
    "claimantEmail" TEXT NOT NULL,
    "claimantAddress" TEXT,
    "originalWorkUrl" TEXT,
    "workDescription" TEXT,
    "infringingUrl" TEXT,
    "propertyId" TEXT,
    "mediaId" TEXT,
    "contactId" TEXT,
    "goodFaithStatement" TEXT,
    "signature" TEXT,
    "status" "DmcaStatus" NOT NULL DEFAULT 'RECEIVED',
    "counterNoticeReceived" BOOLEAN NOT NULL DEFAULT false,
    "actionTakenAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dmca_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entity" "AuditEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "actorId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "template" TEXT,
    "providerMessageId" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    "consentRecordId" TEXT,
    "metadata" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceCounter_scope_key" ON "ReferenceCounter"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_reference_key" ON "contacts"("reference");

-- CreateIndex
CREATE INDEX "contacts_emailHash_idx" ON "contacts"("emailHash");

-- CreateIndex
CREATE INDEX "contacts_lastName_idx" ON "contacts"("lastName");

-- CreateIndex
CREATE UNIQUE INDEX "properties_reference_key" ON "properties"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "properties_slug_key" ON "properties"("slug");

-- CreateIndex
CREATE INDEX "properties_status_idx" ON "properties"("status");

-- CreateIndex
CREATE INDEX "properties_listingType_idx" ON "properties"("listingType");

-- CreateIndex
CREATE INDEX "properties_propertyType_idx" ON "properties"("propertyType");

-- CreateIndex
CREATE INDEX "properties_reference_idx" ON "properties"("reference");

-- CreateIndex
CREATE INDEX "properties_publishedOnWebsite_status_idx" ON "properties"("publishedOnWebsite", "status");

-- CreateIndex
CREATE INDEX "properties_city_idx" ON "properties"("city");

-- CreateIndex
CREATE INDEX "properties_neighborhood_idx" ON "properties"("neighborhood");

-- CreateIndex
CREATE INDEX "properties_price_idx" ON "properties"("price");

-- CreateIndex
CREATE INDEX "properties_area_idx" ON "properties"("area");

-- CreateIndex
CREATE INDEX "properties_bedrooms_idx" ON "properties"("bedrooms");

-- CreateIndex
CREATE INDEX "properties_agentId_idx" ON "properties"("agentId");

-- CreateIndex
CREATE INDEX "properties_ownerId_idx" ON "properties"("ownerId");

-- CreateIndex
CREATE INDEX "properties_createdAt_idx" ON "properties"("createdAt");

-- CreateIndex
CREATE INDEX "property_media_propertyId_kind_sortOrder_idx" ON "property_media"("propertyId", "kind", "sortOrder");

-- CreateIndex
CREATE INDEX "property_media_propertyId_isPrimary_idx" ON "property_media"("propertyId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "leads_reference_key" ON "leads"("reference");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_source_idx" ON "leads"("source");

-- CreateIndex
CREATE INDEX "leads_sourcePortalId_idx" ON "leads"("sourcePortalId");

-- CreateIndex
CREATE INDEX "leads_assignedToId_status_idx" ON "leads"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "leads_propertyId_idx" ON "leads"("propertyId");

-- CreateIndex
CREATE INDEX "leads_createdAt_idx" ON "leads"("createdAt");

-- CreateIndex
CREATE INDEX "leads_nextActionAt_idx" ON "leads"("nextActionAt");

-- CreateIndex
CREATE INDEX "notes_leadId_idx" ON "notes"("leadId");

-- CreateIndex
CREATE INDEX "notes_propertyId_idx" ON "notes"("propertyId");

-- CreateIndex
CREATE INDEX "viewings_propertyId_startsAt_idx" ON "viewings"("propertyId", "startsAt");

-- CreateIndex
CREATE INDEX "viewings_agentId_startsAt_idx" ON "viewings"("agentId", "startsAt");

-- CreateIndex
CREATE INDEX "viewings_status_idx" ON "viewings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "offers_reference_key" ON "offers"("reference");

-- CreateIndex
CREATE INDEX "offers_propertyId_idx" ON "offers"("propertyId");

-- CreateIndex
CREATE INDEX "offers_status_idx" ON "offers"("status");

-- CreateIndex
CREATE INDEX "offers_leadId_idx" ON "offers"("leadId");

-- CreateIndex
CREATE INDEX "tasks_assignedToId_status_idx" ON "tasks"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "tasks_dueAt_idx" ON "tasks"("dueAt");

-- CreateIndex
CREATE INDEX "tasks_status_priority_idx" ON "tasks"("status", "priority");

-- CreateIndex
CREATE INDEX "documents_propertyId_idx" ON "documents"("propertyId");

-- CreateIndex
CREATE INDEX "documents_contactId_idx" ON "documents"("contactId");

-- CreateIndex
CREATE INDEX "documents_retentionExpiresAt_idx" ON "documents"("retentionExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "portals_code_key" ON "portals"("code");

-- CreateIndex
CREATE INDEX "portals_enabled_idx" ON "portals"("enabled");

-- CreateIndex
CREATE INDEX "portal_listings_portalId_state_idx" ON "portal_listings"("portalId", "state");

-- CreateIndex
CREATE INDEX "portal_listings_propertyId_idx" ON "portal_listings"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_listings_portalId_propertyId_key" ON "portal_listings"("portalId", "propertyId");

-- CreateIndex
CREATE INDEX "portal_sync_logs_portalId_createdAt_idx" ON "portal_sync_logs"("portalId", "createdAt");

-- CreateIndex
CREATE INDEX "portal_sync_logs_portalListingId_idx" ON "portal_sync_logs"("portalListingId");

-- CreateIndex
CREATE INDEX "portal_sync_logs_ok_idx" ON "portal_sync_logs"("ok");

-- CreateIndex
CREATE INDEX "portal_property_mappings_propertyId_idx" ON "portal_property_mappings"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_property_mappings_portalId_propertyId_key" ON "portal_property_mappings"("portalId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_property_mappings_portalId_externalId_key" ON "portal_property_mappings"("portalId", "externalId");

-- CreateIndex
CREATE INDEX "consent_records_subjectHash_purpose_idx" ON "consent_records"("subjectHash", "purpose");

-- CreateIndex
CREATE INDEX "consent_records_email_idx" ON "consent_records"("email");

-- CreateIndex
CREATE INDEX "consent_records_purpose_granted_idx" ON "consent_records"("purpose", "granted");

-- CreateIndex
CREATE INDEX "consent_records_createdAt_idx" ON "consent_records"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_emailHash_key" ON "email_suppressions"("emailHash");

-- CreateIndex
CREATE INDEX "email_suppressions_email_idx" ON "email_suppressions"("email");

-- CreateIndex
CREATE INDEX "email_suppressions_reason_idx" ON "email_suppressions"("reason");

-- CreateIndex
CREATE UNIQUE INDEX "data_requests_reference_key" ON "data_requests"("reference");

-- CreateIndex
CREATE INDEX "data_requests_subjectEmail_idx" ON "data_requests"("subjectEmail");

-- CreateIndex
CREATE INDEX "data_requests_status_idx" ON "data_requests"("status");

-- CreateIndex
CREATE INDEX "data_requests_dueAt_idx" ON "data_requests"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "dmca_notices_reference_key" ON "dmca_notices"("reference");

-- CreateIndex
CREATE INDEX "dmca_notices_status_idx" ON "dmca_notices"("status");

-- CreateIndex
CREATE INDEX "dmca_notices_propertyId_idx" ON "dmca_notices"("propertyId");

-- CreateIndex
CREATE INDEX "dmca_notices_createdAt_idx" ON "dmca_notices"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "email_logs_toEmail_idx" ON "email_logs"("toEmail");

-- CreateIndex
CREATE INDEX "email_logs_category_idx" ON "email_logs"("category");

-- CreateIndex
CREATE INDEX "email_logs_createdAt_idx" ON "email_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_deactivatedById_fkey" FOREIGN KEY ("deactivatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_viewingId_fkey" FOREIGN KEY ("viewingId") REFERENCES "viewings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_listings" ADD CONSTRAINT "portal_listings_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_listings" ADD CONSTRAINT "portal_listings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sync_logs" ADD CONSTRAINT "portal_sync_logs_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sync_logs" ADD CONSTRAINT "portal_sync_logs_portalListingId_fkey" FOREIGN KEY ("portalListingId") REFERENCES "portal_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_property_mappings" ADD CONSTRAINT "portal_property_mappings_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dmca_notices" ADD CONSTRAINT "dmca_notices_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

