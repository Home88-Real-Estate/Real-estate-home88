-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('ACTIVE', 'PAUSED', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "buyer_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'ACTIVE',
    "listingType" "ListingType" NOT NULL,
    "propertyTypes" "PropertyType"[],
    "areas" TEXT[],
    "minPrice" DECIMAL(14,2),
    "maxPrice" DECIMAL(14,2),
    "minArea" DECIMAL(10,2),
    "maxArea" DECIMAL(10,2),
    "minBedrooms" INTEGER,
    "minBathrooms" INTEGER,
    "minFloor" INTEGER,
    "minYearBuilt" INTEGER,
    "features" TEXT[],
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "clientEmail" TEXT,
    "contactId" TEXT,
    "rating" INTEGER,
    "notes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyer_requests_reference_key" ON "buyer_requests"("reference");

-- CreateIndex
CREATE INDEX "buyer_requests_status_listingType_idx" ON "buyer_requests"("status", "listingType");

-- CreateIndex
CREATE INDEX "buyer_requests_assignedToId_status_idx" ON "buyer_requests"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "buyer_requests_createdAt_idx" ON "buyer_requests"("createdAt");

-- AddForeignKey
ALTER TABLE "buyer_requests" ADD CONSTRAINT "buyer_requests_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_requests" ADD CONSTRAINT "buyer_requests_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "buyer_requests" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "buyer_requests" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "buyer_requests" FROM authenticated';
  END IF;
END $$;
