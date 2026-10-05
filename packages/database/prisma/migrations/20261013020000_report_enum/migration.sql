-- New audit entity for report exports. Own migration: an enum value must
-- be committed before anything can use it.
ALTER TYPE "AuditEntity" ADD VALUE 'REPORT';
