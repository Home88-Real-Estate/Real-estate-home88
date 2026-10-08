-- WebsitePublication: the authoritative website publication state.
--
-- This migration is purely additive. It creates three tables plus their
-- enums, backfills one WebsitePublication per existing Property, seeds the
-- initial slug-history row, and enforces two invariants outside Prisma:
--  1. channel_publication_events is append-only (trigger rejects UPDATE/DELETE).
--  2. events can never cross-reference WEBSITE vs PORTAL targets (CHECK).
--
-- NOTE ON DELETION SEMANTICS:
--   The append-only trigger takes precedence over the FKs declared with
--   ON DELETE SET NULL. Because the trigger rejects every UPDATE/DELETE on
--   channel_publication_events, a parent row (property, portal, portal_listing
--   or website_publication) cannot be hard-deleted while any event references
--   it. This is intentional: "history survives" is enforced by preventing the
--   deletion, not by silently nulling columns of an append-only table. The
--   supported path for removing a portal/listing is soft-disable.
--
--   Property hard-purge must therefore explicitly dispose of its
--   WebsitePublication (and events) first, or treat them as retained records.

-- CreateEnum
CREATE TYPE "WebsitePublicationStatus" AS ENUM ('DRAFT', 'READY', 'VALIDATION_FAILED', 'PUBLISHED', 'OUTDATED', 'UPDATE_PENDING', 'UNPUBLISHED', 'SOLD', 'RENTED', 'ARCHIVED', 'FAILED', 'PAUSED');

-- CreateEnum
CREATE TYPE "PublicationVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'NOINDEX');

-- CreateEnum
CREATE TYPE "SlugHistoryKind" AS ENUM ('ORIGINAL', 'RENAMED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "PublicationChannelType" AS ENUM ('WEBSITE', 'PORTAL');

-- CreateEnum
CREATE TYPE "ChannelAction" AS ENUM ('VALIDATE', 'PREVIEW', 'PREPARE', 'PUBLISH', 'UPDATE', 'UNPUBLISH', 'STATUS_CHANGED', 'RETRY_SCHEDULED', 'ERROR');

-- CreateTable
CREATE TABLE "website_publications" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "WebsitePublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "visibility" "PublicationVisibility" NOT NULL DEFAULT 'NOINDEX',
    "sitemapIncluded" BOOLEAN NOT NULL DEFAULT false,
    "noIndex" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "lastPublishedAt" TIMESTAMP(3),
    "lastUnpublishedAt" TIMESTAMP(3),
    "lastGeneratedAt" TIMESTAMP(3),
    "lastPayloadHash" TEXT,
    "lastFailedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_slug_history" (
    "id" TEXT NOT NULL,
    "websitePublicationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "SlugHistoryKind" NOT NULL DEFAULT 'ORIGINAL',
    "redirectedTo" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_slug_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_publication_events" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "channelType" "PublicationChannelType" NOT NULL,
    "websitePublicationId" TEXT,
    "portalId" TEXT,
    "portalListingId" TEXT,
    "action" "ChannelAction" NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "websiteState" "WebsitePublicationStatus",
    "portalState" "PortalSyncState",
    "detail" TEXT,
    "errorCode" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "payloadHash" TEXT,
    "externalListingId" TEXT,
    "triggeredById" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_publication_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_publications_propertyId_key" ON "website_publications"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "website_publications_slug_key" ON "website_publications"("slug");

-- CreateIndex
CREATE INDEX "website_publications_status_idx" ON "website_publications"("status");

-- CreateIndex
CREATE INDEX "website_publications_enabled_status_idx" ON "website_publications"("enabled", "status");

-- CreateIndex
CREATE INDEX "website_publications_sitemapIncluded_noIndex_idx" ON "website_publications"("sitemapIncluded", "noIndex");

-- CreateIndex
CREATE INDEX "website_slug_history_websitePublicationId_createdAt_idx" ON "website_slug_history"("websitePublicationId", "createdAt");

-- CreateIndex
CREATE INDEX "website_slug_history_propertyId_createdAt_idx" ON "website_slug_history"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "website_slug_history_slug_idx" ON "website_slug_history"("slug");

-- CreateIndex
CREATE INDEX "channel_publication_events_propertyId_createdAt_idx" ON "channel_publication_events"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_publication_events_channelType_createdAt_idx" ON "channel_publication_events"("channelType", "createdAt");

-- CreateIndex
CREATE INDEX "channel_publication_events_websitePublicationId_createdAt_idx" ON "channel_publication_events"("websitePublicationId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_publication_events_portalId_createdAt_idx" ON "channel_publication_events"("portalId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_publication_events_portalListingId_createdAt_idx" ON "channel_publication_events"("portalListingId", "createdAt");

-- AddForeignKey
ALTER TABLE "website_publications" ADD CONSTRAINT "website_publications_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_slug_history" ADD CONSTRAINT "website_slug_history_websitePublicationId_fkey" FOREIGN KEY ("websitePublicationId") REFERENCES "website_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_slug_history" ADD CONSTRAINT "website_slug_history_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_publication_events" ADD CONSTRAINT "channel_publication_events_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_publication_events" ADD CONSTRAINT "channel_publication_events_websitePublicationId_fkey" FOREIGN KEY ("websitePublicationId") REFERENCES "website_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_publication_events" ADD CONSTRAINT "channel_publication_events_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_publication_events" ADD CONSTRAINT "channel_publication_events_portalListingId_fkey" FOREIGN KEY ("portalListingId") REFERENCES "portal_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "website_publications" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "website_publications" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "website_publications" FROM authenticated';
  END IF;
END $$;

ALTER TABLE "website_slug_history" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "website_slug_history" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "website_slug_history" FROM authenticated';
  END IF;
END $$;

ALTER TABLE "channel_publication_events" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "channel_publication_events" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "channel_publication_events" FROM authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- BACKFILL (idempotent: safe to re-run; existing rows are never touched)
-- ---------------------------------------------------------------------------

-- Pre-flight conflict report. Run these SELECTs during review; any row here is
-- marked, never silently decided. A property is "publicly eligible" when it
-- was published AND its status was ACTIVE / UNDER_OFFER / RESERVED.
--
--   SELECT 'title--status-conflict' AS flag, "reference", "status",
--          "publishedOnWebsite"
--   FROM "properties"
--   WHERE "publishedOnWebsite" IS TRUE
--     AND "status" NOT IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED');
--
--   SELECT 'missing-slug' AS flag, "id", "reference"
--   FROM "properties" WHERE "slug" IS NULL OR "slug" = '';

-- One WebsitePublication per property. Deterministic id makes the insert
-- idempotent; ON CONFLICT (propertyId) DO NOTHING keeps existing slugs and
-- timestamps on re-runs.
INSERT INTO "website_publications" (
    "id", "propertyId", "status", "enabled", "slug",
    "canonicalUrl", "visibility", "sitemapIncluded", "noIndex", "featured",
    "seoTitle", "seoDescription",
    "lastPublishedAt", "createdAt", "updatedAt"
)
SELECT
    'wp_' || p."id",
    p."id",
    CASE
        WHEN p."publishedOnWebsite" IS TRUE
         AND p."status" IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED')
            THEN 'PUBLISHED'::"WebsitePublicationStatus"
        ELSE 'DRAFT'::"WebsitePublicationStatus"
    END,
    p."publishedOnWebsite",
    p."slug",
    NULL,
    CASE
        WHEN p."publishedOnWebsite" IS TRUE
         AND p."status" IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED')
            THEN 'PUBLIC'::"PublicationVisibility"
        ELSE 'NOINDEX'::"PublicationVisibility"
    END,
    p."publishedOnWebsite" IS TRUE
        AND p."status" IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED'),
    NOT (
        p."publishedOnWebsite" IS TRUE
        AND p."status" IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED')
    ),
    p."featured",
    NULL,
    NULL,
    CASE
        WHEN p."publishedOnWebsite" IS TRUE
            THEN p."publishedAt"
        ELSE NULL
    END,
    NOW(),
    NOW()
FROM "properties" p
ON CONFLICT ("propertyId") DO NOTHING;

-- Seed the initial ORIGINAL slug-history row for every backfilled publication,
-- so the audit trail starts at the slug the public site actually knows.
INSERT INTO "website_slug_history" (
    "id", "websitePublicationId", "propertyId", "slug",
    "kind", "redirectedTo", "changedById", "createdAt"
)
SELECT
    'wsh_' || wp."propertyId",
    wp."id",
    wp."propertyId",
    wp."slug",
'ORIGINAL'::"SlugHistoryKind",
    NULL,
    NULL,
    NOW()
FROM "website_publications" wp
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- INVARIANTS (hand-written, not expressible in Prisma)
-- ---------------------------------------------------------------------------

-- A WEBSITE event targets a website_publication only; a PORTAL event targets a
-- portal_listing only. Draw a cross-reference and the write is rejected.
ALTER TABLE "channel_publication_events"
    ADD CONSTRAINT "channel_publication_event_target_check"
    CHECK (
        (
            "channelType" = 'WEBSITE'
            AND "websitePublicationId" IS NOT NULL
            AND "portalId" IS NULL
            AND "portalListingId" IS NULL
            AND "websiteState" IS NOT NULL
            AND "portalState" IS NULL
        )
        OR
        (
            "channelType" = 'PORTAL'
            AND "websitePublicationId" IS NULL
            AND "websiteState" IS NULL
            AND "portalListingId" IS NOT NULL
            AND "portalId" IS NOT NULL
        )
    );

-- channel_publication_events is append-only: no UPDATE, no DELETE, no
-- exceptions (including FK-driven SET NULL / CASCADE, see the note at the top).
CREATE OR REPLACE FUNCTION channel_publication_event_no_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'channel_publication_events is append-only (action: %, table: %)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_channel_publication_event_append_only
    BEFORE UPDATE OR DELETE ON "channel_publication_events"
    FOR EACH ROW
    EXECUTE FUNCTION channel_publication_event_no_mutation();