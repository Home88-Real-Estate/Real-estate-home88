-- New audit entity for client messages. Own migration: an enum value must
-- be committed before anything can use it.
ALTER TYPE "AuditEntity" ADD VALUE 'MESSAGE';
