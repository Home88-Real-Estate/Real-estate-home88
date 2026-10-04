-- New enum values for mandates. Own migration: an enum value must be
-- committed before anything can use it.
ALTER TYPE "AuditEntity" ADD VALUE 'MANDATE';
ALTER TYPE "DocumentCategory" ADD VALUE 'MANDATE';
