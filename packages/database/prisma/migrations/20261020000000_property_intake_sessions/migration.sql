-- CreateEnum
CREATE TYPE "PropertyIntakeStatus" AS ENUM ('ACTIVE', 'CREATED', 'ABANDONED');

-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE 'PROPERTY_INTAKE';

-- CreateTable
CREATE TABLE "property_intake_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PropertyIntakeStatus" NOT NULL DEFAULT 'ACTIVE',
    "language" TEXT NOT NULL DEFAULT 'auto',
    "state" JSONB NOT NULL DEFAULT '{}',
    "turns" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "propertyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_intake_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_intake_sessions_propertyId_key" ON "property_intake_sessions"("propertyId");

-- CreateIndex
CREATE INDEX "property_intake_sessions_userId_status_updatedAt_idx" ON "property_intake_sessions"("userId", "status", "updatedAt");

-- AddForeignKey
ALTER TABLE "property_intake_sessions" ADD CONSTRAINT "property_intake_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_intake_sessions" ADD CONSTRAINT "property_intake_sessions_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "property_intake_sessions" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "property_intake_sessions" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "property_intake_sessions" FROM authenticated;
  END IF;
END $$;
