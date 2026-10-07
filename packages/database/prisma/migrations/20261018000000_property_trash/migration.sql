-- The CRM's deleted folder: a soft-delete state that hides a listing without
-- dropping its rows, so it can be restored or removed permanently later.
-- Safe to run inside the transaction Prisma wraps migrations in (PostgreSQL
-- allows ADD VALUE in a transaction; the value is only used afterwards).
ALTER TYPE "PropertyStatus" ADD VALUE IF NOT EXISTS 'DELETED';
