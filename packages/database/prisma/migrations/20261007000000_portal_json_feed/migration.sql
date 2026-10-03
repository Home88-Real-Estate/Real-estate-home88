-- Portals that ingest a JSON document (e.g. Poleon). Own migration: a new
-- enum value must be committed before anything can use it.
-- AlterEnum
ALTER TYPE "PortalTransport" ADD VALUE 'JSON_FEED';
