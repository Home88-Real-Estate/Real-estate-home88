-- Rollback for 20261021000000_property_intake_sessions.
-- The AuditEntity value PROPERTY_INTAKE stays (PostgreSQL cannot drop an enum
-- value); it is harmless once no rows use it. Delete those audit rows first if
-- a full revert is wanted.
DROP TABLE IF EXISTS "property_intake_sessions";
DROP TYPE IF EXISTS "PropertyIntakeStatus";
