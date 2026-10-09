-- Website publication cutover: bring every WebsitePublication in line with what
-- the website was actually showing, before the public site starts reading
-- WebsitePublication instead of Property.publishedOnWebsite.
--
-- Why this is needed. Migration 20261008120000_website_publication created one
-- publication per property from the flag as it stood THEN. Until the code that
-- reads publications is deployed, the old code keeps writing the flag directly
-- (the CRM's "publish on website" checkbox), so the two can have drifted:
--   - a property published since then has a flag but a DRAFT publication, and
--     would VANISH from the website at cutover;
--   - a property deliberately taken down since then has no flag but still a live
--     publication, and would REAPPEAR at cutover.
-- Both are wrong. Up to this point the flag is the truth, so this migration makes
-- the publication say the same thing. After the cutover the flag is derived from
-- the publication and the two cannot drift again.
--
-- Safe whichever order the code and this migration are deployed in, and safe to
-- re-run: it changes only rows where the two DISAGREE. Rows already consistent,
-- and anything the new publication flow has written, are left alone (after the
-- cutover the flag always equals "publication is live", so nothing disagrees).
-- The rule is the one the original backfill used: a flag counts as "published"
-- only for a property whose own status is public (ACTIVE, UNDER_OFFER, RESERVED).
--
-- Purely data. No schema change, nothing is deleted, nothing is published that the
-- website was not already showing, and nothing the website was showing is removed.

-- 1. Properties created after the first backfill have no publication yet: create it.
INSERT INTO "website_publications" (
    "id", "propertyId", "status", "enabled", "slug",
    "canonicalUrl", "visibility", "sitemapIncluded", "noIndex", "featured",
    "seoTitle", "seoDescription", "lastPublishedAt", "createdAt", "updatedAt"
)
SELECT
    'wp_' || p."id",
    p."id",
    CASE WHEN p."publishedOnWebsite" IS TRUE AND p."status" IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED')
         THEN 'PUBLISHED'::"WebsitePublicationStatus" ELSE 'DRAFT'::"WebsitePublicationStatus" END,
    p."publishedOnWebsite",
    p."slug",
    NULL,
    CASE WHEN p."publishedOnWebsite" IS TRUE AND p."status" IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED')
         THEN 'PUBLIC'::"PublicationVisibility" ELSE 'NOINDEX'::"PublicationVisibility" END,
    p."publishedOnWebsite" IS TRUE AND p."status" IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED'),
    NOT (p."publishedOnWebsite" IS TRUE AND p."status" IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED')),
    p."featured",
    NULL,
    NULL,
    CASE WHEN p."publishedOnWebsite" IS TRUE THEN COALESCE(p."publishedAt", NOW()) ELSE NULL END,
    NOW(),
    NOW()
FROM "properties" p
WHERE NOT EXISTS (SELECT 1 FROM "website_publications" wp WHERE wp."propertyId" = p."id")
ON CONFLICT ("propertyId") DO NOTHING;

INSERT INTO "website_slug_history" ("id", "websitePublicationId", "propertyId", "slug", "kind", "createdAt")
SELECT 'wsh_' || wp."propertyId", wp."id", wp."propertyId", wp."slug", 'ORIGINAL'::"SlugHistoryKind", NOW()
FROM "website_publications" wp
WHERE NOT EXISTS (SELECT 1 FROM "website_slug_history" h WHERE h."websitePublicationId" = wp."id")
ON CONFLICT ("id") DO NOTHING;

-- 2. Published since the first backfill (flag set, property public, publication not live): put it on.
WITH changed AS (
    UPDATE "website_publications" wp
    SET "status" = 'PUBLISHED',
        "enabled" = TRUE,
        "visibility" = 'PUBLIC',
        "noIndex" = FALSE,
        "sitemapIncluded" = TRUE,
        "lastPublishedAt" = COALESCE(p."publishedAt", NOW()),
        "updatedAt" = NOW()
    FROM "properties" p
    WHERE p."id" = wp."propertyId"
      AND p."publishedOnWebsite" IS TRUE
      AND p."status" IN ('ACTIVE', 'UNDER_OFFER', 'RESERVED')
      AND NOT (wp."enabled" IS TRUE AND wp."status" IN ('PUBLISHED', 'OUTDATED', 'UPDATE_PENDING'))
    RETURNING wp."propertyId", 'PUBLISHED' AS "to"
)
INSERT INTO "audit_logs" ("id", "entity", "entityId", "action", "changes", "createdAt")
SELECT gen_random_uuid()::text, 'PROPERTY'::"AuditEntity", c."propertyId", 'website_cutover_reconciled',
       jsonb_build_object('to', c."to", 'reason', 'publishedOnWebsite was set, publication brought in line'), NOW()
FROM changed c;

-- 3. Taken down since the first backfill (flag clear, publication still live): take it down.
WITH changed AS (
    UPDATE "website_publications" wp
    SET "status" = 'UNPUBLISHED',
        "enabled" = FALSE,
        "visibility" = 'NOINDEX',
        "noIndex" = TRUE,
        "sitemapIncluded" = FALSE,
        "lastUnpublishedAt" = NOW(),
        "updatedAt" = NOW()
    FROM "properties" p
    WHERE p."id" = wp."propertyId"
      AND p."publishedOnWebsite" IS NOT TRUE
      AND wp."enabled" IS TRUE
      AND wp."status" IN ('PUBLISHED', 'OUTDATED', 'UPDATE_PENDING')
    RETURNING wp."propertyId", 'UNPUBLISHED' AS "to"
)
INSERT INTO "audit_logs" ("id", "entity", "entityId", "action", "changes", "createdAt")
SELECT gen_random_uuid()::text, 'PROPERTY'::"AuditEntity", c."propertyId", 'website_cutover_reconciled',
       jsonb_build_object('to', c."to", 'reason', 'publishedOnWebsite was clear, publication brought in line'), NOW()
FROM changed c;
