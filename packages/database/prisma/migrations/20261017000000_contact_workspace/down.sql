-- Rollback for 20261017000000_contact_workspace (not run automatically).
DROP TABLE IF EXISTS "contact_properties";
DROP TYPE IF EXISTS "ContactPropertyRelation";
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_showingId_fkey", DROP CONSTRAINT IF EXISTS "tasks_contactId_fkey";
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_assignedToId_fkey";
DROP INDEX IF EXISTS "tasks_showingId_idx", "tasks_contactId_idx", "showings_visitAt_idx", "contacts_lastActivityAt_idx", "contacts_status_idx", "contacts_assignedToId_idx";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "showingId", DROP COLUMN IF EXISTS "contactId";
ALTER TABLE "showings" DROP COLUMN IF EXISTS "visitAt";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "workPhoneEncrypted", DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "postalCode", DROP COLUMN IF EXISTS "lastActivityAt", DROP COLUMN IF EXISTS "city", DROP COLUMN IF EXISTS "assignedToId";
DROP TYPE IF EXISTS "ContactStatus";
