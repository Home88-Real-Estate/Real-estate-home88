-- Tables added by 20261010000000_public_intake: same rule as every CRM table,
-- no access through Supabase's public API roles. intake_upload_sessions and
-- intake_receipts in particular are written on behalf of anonymous visitors and
-- must never be readable or writable by them directly.
ALTER TABLE "property_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "viewing_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intake_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intake_upload_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_notifications" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['property_submissions', 'viewing_requests', 'intake_receipts', 'intake_upload_sessions', 'crm_notifications'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
