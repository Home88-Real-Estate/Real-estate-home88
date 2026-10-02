-- AlterTable
ALTER TABLE "property_media" ADD COLUMN     "previewKey" TEXT,
ADD COLUMN     "thumbnailKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "property_media_storageKey_key" ON "property_media"("storageKey");

