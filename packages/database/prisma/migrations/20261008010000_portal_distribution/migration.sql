-- Portal distribution: property tag assignments, per-portal taxonomy mappings,
-- publication-rule conditions and feed versions with a mass-unpublish guard.
-- CreateEnum
CREATE TYPE "PortalMappingKind" AS ENUM ('TYPE', 'FEATURE');
-- CreateEnum
CREATE TYPE "PortalMappingStatus" AS ENUM ('MAPPED', 'UNSUPPORTED', 'TRANSFORM');
-- AlterTable
ALTER TABLE "portal_publication_rules" ADD COLUMN     "conditions" JSONB;
-- CreateTable
CREATE TABLE "property_tag_assignments" (
    "propertyId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "property_tag_assignments_pkey" PRIMARY KEY ("propertyId","tagId")
);
-- CreateTable
CREATE TABLE "portal_mappings" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "kind" "PortalMappingKind" NOT NULL,
    "internalCode" TEXT NOT NULL,
    "status" "PortalMappingStatus" NOT NULL DEFAULT 'MAPPED',
    "externalValue" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "portal_mappings_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "portal_feed_versions" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "propertyCount" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    CONSTRAINT "portal_feed_versions_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "property_tag_assignments_tagId_idx" ON "property_tag_assignments"("tagId");
-- CreateIndex
CREATE UNIQUE INDEX "portal_mappings_portalId_kind_internalCode_key" ON "portal_mappings"("portalId", "kind", "internalCode");
-- CreateIndex
CREATE INDEX "portal_feed_versions_portalId_generatedAt_idx" ON "portal_feed_versions"("portalId", "generatedAt");
-- CreateIndex
CREATE UNIQUE INDEX "portal_feed_versions_portalId_version_key" ON "portal_feed_versions"("portalId", "version");
-- AddForeignKey
ALTER TABLE "property_tag_assignments" ADD CONSTRAINT "property_tag_assignments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "property_tag_assignments" ADD CONSTRAINT "property_tag_assignments_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "property_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "portal_mappings" ADD CONSTRAINT "portal_mappings_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "portal_feed_versions" ADD CONSTRAINT "portal_feed_versions_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
