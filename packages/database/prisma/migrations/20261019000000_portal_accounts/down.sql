ALTER TABLE "portal_sync_logs" DROP CONSTRAINT IF EXISTS "portal_sync_logs_syncRunId_fkey";
ALTER TABLE "portal_listings" DROP CONSTRAINT IF EXISTS "portal_listings_portalAccountId_fkey";
DROP TABLE IF EXISTS "portal_sync_runs";
DROP TABLE IF EXISTS "portal_accounts";
DROP INDEX IF EXISTS "portal_sync_logs_syncRunId_idx";
DROP INDEX IF EXISTS "portal_listings_portalAccountId_idx";
ALTER TABLE "portal_sync_logs" DROP COLUMN IF EXISTS "syncRunId";
ALTER TABLE "portal_listings"
  DROP COLUMN IF EXISTS "lastAction", DROP COLUMN IF EXISTS "lastActionAt", DROP COLUMN IF EXISTS "lastActionById",
  DROP COLUMN IF EXISTS "lastFailedAt", DROP COLUMN IF EXISTS "lastSuccessfulSyncAt", DROP COLUMN IF EXISTS "payloadSnapshot",
  DROP COLUMN IF EXISTS "portalAccountId";
DROP TYPE IF EXISTS "PortalRunStatus";
DROP TYPE IF EXISTS "PortalRunOperation";
DROP TYPE IF EXISTS "PortalRunTrigger";
DROP TYPE IF EXISTS "PortalAccountStatus";
DROP TYPE IF EXISTS "PortalEnvironment";
