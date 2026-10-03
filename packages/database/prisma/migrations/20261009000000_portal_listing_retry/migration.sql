-- Dead-letter and backoff state for portal listings: permanent errors and an
-- exhausted retry budget park a listing for review instead of retrying forever.
-- AlterTable
ALTER TABLE "portal_listings" ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3);
-- CreateIndex
CREATE INDEX "portal_listings_portalId_needsReview_idx" ON "portal_listings"("portalId", "needsReview");
