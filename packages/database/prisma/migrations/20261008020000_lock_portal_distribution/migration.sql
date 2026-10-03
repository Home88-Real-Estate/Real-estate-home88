-- Tables added by 20261008010000_portal_distribution: same rule as every CRM
-- table, no access through Supabase's public API roles.
ALTER TABLE "property_tag_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_feed_versions" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['property_tag_assignments', 'portal_mappings', 'portal_feed_versions'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
