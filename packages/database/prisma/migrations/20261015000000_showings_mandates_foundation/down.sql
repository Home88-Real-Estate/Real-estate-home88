-- Manual rollback for 20261015000000_showings_mandates_foundation (Prisma does
-- not run this file). It removes only what the migration added. Existing
-- mandates, viewings, properties and templates keep all their original data;
-- everything stored in the new tables/columns is lost, so export it first.

DROP TRIGGER IF EXISTS h88_showing_guard ON "showings";
DROP TRIGGER IF EXISTS h88_showing_property_guard ON "showing_properties";
DROP TRIGGER IF EXISTS h88_showing_party_guard ON "showing_parties";
DROP TRIGGER IF EXISTS h88_payment_milestone_guard ON "payment_milestones";
DROP TRIGGER IF EXISTS h88_mandate_extension_guard ON "mandate_extensions";
DROP TRIGGER IF EXISTS h88_showing_events_append_only ON "showing_events";
DROP TRIGGER IF EXISTS h88_mandate_conflict_overrides_append_only ON "mandate_conflict_overrides";

-- Restore the original mandate guard's link list (see 20261012010000_mandates).
ALTER TABLE "mandates" DISABLE TRIGGER h88_mandate_guard;

ALTER TABLE "viewings" DROP CONSTRAINT IF EXISTS "viewings_showingId_fkey";
ALTER TABLE "viewings" DROP COLUMN IF EXISTS "showingId";
ALTER TABLE "mandates" DROP CONSTRAINT IF EXISTS "mandates_supersedesMandateId_fkey";

DROP TABLE IF EXISTS "legacy_entity_mappings", "payment_milestones", "mandate_conflict_overrides", "mandate_extensions",
  "property_owners", "showing_events", "showing_parties", "showing_properties", "showings";

-- Then drop the added mandates / mandate_template_versions / mandate_settings columns
-- and the enum types (ShowingStatus … LegacySourceSystem), and re-create
-- h88_guard_mandate() from 20261012010000_mandates, and re-enable the trigger:
-- ALTER TABLE "mandates" ENABLE TRIGGER h88_mandate_guard;
