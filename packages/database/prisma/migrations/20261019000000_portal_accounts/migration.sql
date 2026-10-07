-- CreateEnum
CREATE TYPE "PortalEnvironment" AS ENUM ('TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "PortalAccountStatus" AS ENUM ('CONFIGURED', 'TESTING', 'ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "PortalRunTrigger" AS ENUM ('MANUAL', 'PROPERTY_SAVE', 'CRON', 'RETRY', 'BULK_ACTION');

-- CreateEnum
CREATE TYPE "PortalRunOperation" AS ENUM ('CONNECTION_TEST', 'PREVIEW', 'PUBLISH', 'UPDATE', 'UNPUBLISH', 'RETRY');

-- CreateEnum
CREATE TYPE "PortalRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "portal_listings" ADD COLUMN     "lastAction" "PortalRunOperation",
ADD COLUMN     "lastActionAt" TIMESTAMP(3),
ADD COLUMN     "lastActionById" TEXT,
ADD COLUMN     "lastFailedAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessfulSyncAt" TIMESTAMP(3),
ADD COLUMN     "payloadSnapshot" JSONB,
ADD COLUMN     "portalAccountId" TEXT;

-- AlterTable
ALTER TABLE "portal_sync_logs" ADD COLUMN     "syncRunId" TEXT;

-- CreateTable
CREATE TABLE "portal_accounts" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "agencyExternalId" TEXT,
    "endpointUrl" TEXT,
    "environment" "PortalEnvironment" NOT NULL DEFAULT 'TEST',
    "status" "PortalAccountStatus" NOT NULL DEFAULT 'CONFIGURED',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "credentialHints" JSONB,
    "credentialRotatedAt" TIMESTAMP(3),
    "lastConnectionTestAt" TIMESTAMP(3),
    "lastConnectionTestStatus" TEXT,
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "settings" JSONB,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sync_runs" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "portalAccountId" TEXT,
    "propertyId" TEXT,
    "trigger" "PortalRunTrigger" NOT NULL DEFAULT 'MANUAL',
    "operation" "PortalRunOperation" NOT NULL,
    "status" "PortalRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "requestId" TEXT,
    "totalListings" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "withdrawnCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_accounts_portalId_environment_idx" ON "portal_accounts"("portalId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "portal_accounts_portalId_accountName_environment_key" ON "portal_accounts"("portalId", "accountName", "environment");

-- CreateIndex
CREATE INDEX "portal_sync_runs_portalId_startedAt_idx" ON "portal_sync_runs"("portalId", "startedAt");

-- CreateIndex
CREATE INDEX "portal_sync_runs_propertyId_startedAt_idx" ON "portal_sync_runs"("propertyId", "startedAt");

-- CreateIndex
CREATE INDEX "portal_sync_runs_portalAccountId_idx" ON "portal_sync_runs"("portalAccountId");

-- CreateIndex
CREATE INDEX "portal_listings_portalAccountId_idx" ON "portal_listings"("portalAccountId");

-- CreateIndex
CREATE INDEX "portal_sync_logs_syncRunId_idx" ON "portal_sync_logs"("syncRunId");

-- AddForeignKey
ALTER TABLE "portal_listings" ADD CONSTRAINT "portal_listings_portalAccountId_fkey" FOREIGN KEY ("portalAccountId") REFERENCES "portal_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sync_logs" ADD CONSTRAINT "portal_sync_logs_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "portal_sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sync_runs" ADD CONSTRAINT "portal_sync_runs_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sync_runs" ADD CONSTRAINT "portal_sync_runs_portalAccountId_fkey" FOREIGN KEY ("portalAccountId") REFERENCES "portal_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "portal_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_sync_runs" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portal_accounts', 'portal_sync_runs'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
