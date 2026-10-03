-- A feed listing is "in feed", not "published", until the portal confirms it.
-- Own migration: a new enum value must be committed before anything can use it.
-- AlterEnum
ALTER TYPE "PortalSyncState" ADD VALUE 'IN_FEED';
