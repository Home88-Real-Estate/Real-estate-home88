-- Contact workspace (Phase C): who looks after a contact, contact status, last
-- activity, city / postal code / work phone, links from reminders (tasks) to a
-- contact or a showing, the date and time of a showing, and the table for
-- buyer / tenant / interested relationships between a contact and a property
-- (owners stay in property_owners).
--
-- Additive only: every new column is nullable or has a default. Existing
-- contacts get lastActivityAt from their last update so the "last activity"
-- column is meaningful straight away. Rollback script: down.sql.

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ContactPropertyRelation" AS ENUM ('BUYER', 'TENANT', 'INTERESTED');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "workPhoneEncrypted" TEXT;

-- AlterTable
ALTER TABLE "showings" ADD COLUMN     "visitAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "showingId" TEXT;

-- CreateTable
CREATE TABLE "contact_properties" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "relation" "ContactPropertyRelation" NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_properties_propertyId_idx" ON "contact_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_properties_contactId_propertyId_relation_key" ON "contact_properties"("contactId", "propertyId", "relation");

-- CreateIndex
CREATE INDEX "contacts_assignedToId_idx" ON "contacts"("assignedToId");

-- CreateIndex
CREATE INDEX "contacts_status_idx" ON "contacts"("status");

-- CreateIndex
CREATE INDEX "contacts_lastActivityAt_idx" ON "contacts"("lastActivityAt");

-- CreateIndex
CREATE INDEX "showings_visitAt_idx" ON "showings"("visitAt");

-- CreateIndex
CREATE INDEX "tasks_contactId_idx" ON "tasks"("contactId");

-- CreateIndex
CREATE INDEX "tasks_showingId_idx" ON "tasks"("showingId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_showingId_fkey" FOREIGN KEY ("showingId") REFERENCES "showings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_properties" ADD CONSTRAINT "contact_properties_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_properties" ADD CONSTRAINT "contact_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill
UPDATE "contacts" SET "lastActivityAt" = "updatedAt" WHERE "lastActivityAt" IS NULL;

-- Like every CRM table: no access through Supabase's public API roles.
ALTER TABLE "contact_properties" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "contact_properties" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "contact_properties" FROM authenticated;
  END IF;
END $$;
