-- CreateTable
CREATE TABLE "portal_distribution_batches" (
    "id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "createdById" TEXT NOT NULL,
    "requestId" TEXT,
    "idempotencyKey" TEXT,
    "selection" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "portal_distribution_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_distribution_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "portalCode" TEXT NOT NULL,
    "portalAccountId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'TEST',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "resultStatus" TEXT,
    "errorCode" TEXT,
    "message" TEXT,
    "externalId" TEXT,
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "blockers" JSONB,

    CONSTRAINT "portal_distribution_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_distribution_batches_idempotencyKey_key" ON "portal_distribution_batches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "portal_distribution_batches_createdById_createdAt_idx" ON "portal_distribution_batches"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "portal_distribution_batches_status_createdAt_idx" ON "portal_distribution_batches"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "portal_distribution_items_batchId_propertyId_portalCode_key" ON "portal_distribution_items"("batchId", "propertyId", "portalCode");

-- CreateIndex
CREATE INDEX "portal_distribution_items_batchId_status_idx" ON "portal_distribution_items"("batchId", "status");

-- CreateIndex
CREATE INDEX "portal_distribution_items_propertyId_idx" ON "portal_distribution_items"("propertyId");

-- AddForeignKey
ALTER TABLE "portal_distribution_items" ADD CONSTRAINT "portal_distribution_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "portal_distribution_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "portal_distribution_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_distribution_items" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "portal_distribution_batches" FROM anon;
    REVOKE ALL ON TABLE "portal_distribution_items" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "portal_distribution_batches" FROM authenticated;
    REVOKE ALL ON TABLE "portal_distribution_items" FROM authenticated;
  END IF;
END $$;
