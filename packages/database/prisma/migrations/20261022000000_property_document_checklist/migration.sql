-- CreateTable
CREATE TABLE "property_document_items" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "documentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_document_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_document_items_propertyId_idx" ON "property_document_items"("propertyId");

-- CreateIndex
CREATE INDEX "property_document_items_documentId_idx" ON "property_document_items"("documentId");

-- AddForeignKey
ALTER TABLE "property_document_items" ADD CONSTRAINT "property_document_items_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_document_items" ADD CONSTRAINT "property_document_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "property_document_items" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "property_document_items" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "property_document_items" FROM authenticated;
  END IF;
END $$;
