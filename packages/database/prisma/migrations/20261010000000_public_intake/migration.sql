-- Public intake: lead types and attribution, phone-hash contact matching, owner
-- submissions, viewing requests, idempotency receipts, upload quotas, staff
-- notifications; PropertyMedia/Document extended so submission files are reused.
-- CreateEnum
CREATE TYPE "LeadType" AS ENUM ('GENERAL_INQUIRY', 'SELLER_OWNER', 'SELLER_VALUATION', 'BUYER', 'PROPERTY_ENQUIRY', 'BUYER_VIEWING');
-- CreateEnum
CREATE TYPE "SubmissionKind" AS ENUM ('ASSIGNMENT', 'VALUATION');
-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'CONTACTED', 'VALUATION', 'ASSIGNMENT', 'PROPERTY_CREATED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'ARCHIVED');
-- CreateEnum
CREATE TYPE "MediaLifecycle" AS ENUM ('UPLOADING', 'PROCESSING', 'AVAILABLE', 'QUARANTINED', 'REJECTED', 'DELETED');
-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('AGENT_UPLOAD', 'OWNER_SUBMISSION', 'IMPORT', 'PORTAL', 'MIGRATION', 'OTHER');
-- CreateEnum
CREATE TYPE "ViewingRequestStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED');
-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "phoneHash" TEXT;
-- AlterTable
ALTER TABLE "property_media" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "lifecycle" "MediaLifecycle" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "processingNote" TEXT,
ADD COLUMN     "source" "MediaSource" NOT NULL DEFAULT 'AGENT_UPLOAD',
ADD COLUMN     "submissionId" TEXT,
ADD COLUMN     "uploadedByContactId" TEXT,
ALTER COLUMN "propertyId" DROP NOT NULL;
-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "buyerRequestId" TEXT,
ADD COLUMN     "landingPage" TEXT,
ADD COLUMN     "referrerHost" TEXT,
ADD COLUMN     "sourceChannel" TEXT,
ADD COLUMN     "type" "LeadType" NOT NULL DEFAULT 'GENERAL_INQUIRY',
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT;
-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "lifecycle" "MediaLifecycle" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "originalName" TEXT,
ADD COLUMN     "processingNote" TEXT,
ADD COLUMN     "source" "MediaSource" NOT NULL DEFAULT 'AGENT_UPLOAD',
ADD COLUMN     "submissionId" TEXT;
-- CreateTable
CREATE TABLE "property_submissions" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "SubmissionKind" NOT NULL DEFAULT 'ASSIGNMENT',
    "status" "SubmissionStatus" NOT NULL DEFAULT 'NEW',
    "contactId" TEXT,
    "leadId" TEXT,
    "titleEl" TEXT NOT NULL,
    "descriptionEl" TEXT NOT NULL,
    "listingType" "ListingType" NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "price" DECIMAL(14,2),
    "area" DECIMAL(10,2),
    "bedrooms" INTEGER,
    "city" TEXT,
    "neighborhood" TEXT,
    "assignedToId" TEXT,
    "propertyId" TEXT,
    "reviewNotes" TEXT,
    "rejectedReason" TEXT,
    "retentionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "property_submissions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "viewing_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "contactId" TEXT,
    "leadId" TEXT,
    "preferredStart" TIMESTAMP(3),
    "note" TEXT,
    "status" "ViewingRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "viewingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "viewing_requests_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "intake_receipts" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "flow" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intake_receipts_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "intake_upload_sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "photoCount" INTEGER NOT NULL DEFAULT 0,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "byteTotal" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intake_upload_sessions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "crm_notifications" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_notifications_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "property_submissions_reference_key" ON "property_submissions"("reference");
-- CreateIndex
CREATE INDEX "property_submissions_status_createdAt_idx" ON "property_submissions"("status", "createdAt");
-- CreateIndex
CREATE INDEX "property_submissions_contactId_idx" ON "property_submissions"("contactId");
-- CreateIndex
CREATE INDEX "property_submissions_assignedToId_status_idx" ON "property_submissions"("assignedToId", "status");
-- CreateIndex
CREATE UNIQUE INDEX "viewing_requests_reference_key" ON "viewing_requests"("reference");
-- CreateIndex
CREATE INDEX "viewing_requests_status_createdAt_idx" ON "viewing_requests"("status", "createdAt");
-- CreateIndex
CREATE INDEX "viewing_requests_propertyId_idx" ON "viewing_requests"("propertyId");
-- CreateIndex
CREATE UNIQUE INDEX "intake_receipts_idempotencyKey_key" ON "intake_receipts"("idempotencyKey");
-- CreateIndex
CREATE INDEX "intake_receipts_createdAt_idx" ON "intake_receipts"("createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "intake_upload_sessions_tokenHash_key" ON "intake_upload_sessions"("tokenHash");
-- CreateIndex
CREATE UNIQUE INDEX "intake_upload_sessions_prefix_key" ON "intake_upload_sessions"("prefix");
-- CreateIndex
CREATE INDEX "intake_upload_sessions_expiresAt_idx" ON "intake_upload_sessions"("expiresAt");
-- CreateIndex
CREATE INDEX "crm_notifications_userId_readAt_createdAt_idx" ON "crm_notifications"("userId", "readAt", "createdAt");
-- CreateIndex
CREATE INDEX "contacts_phoneHash_idx" ON "contacts"("phoneHash");
-- CreateIndex
CREATE INDEX "property_media_submissionId_idx" ON "property_media"("submissionId");
-- CreateIndex
CREATE INDEX "property_media_checksum_idx" ON "property_media"("checksum");
-- CreateIndex
CREATE INDEX "leads_type_status_idx" ON "leads"("type", "status");
-- CreateIndex
CREATE INDEX "documents_submissionId_idx" ON "documents"("submissionId");
-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "property_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_uploadedByContactId_fkey" FOREIGN KEY ("uploadedByContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_buyerRequestId_fkey" FOREIGN KEY ("buyerRequestId") REFERENCES "buyer_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "property_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "property_submissions" ADD CONSTRAINT "property_submissions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "property_submissions" ADD CONSTRAINT "property_submissions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "property_submissions" ADD CONSTRAINT "property_submissions_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "property_submissions" ADD CONSTRAINT "property_submissions_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
