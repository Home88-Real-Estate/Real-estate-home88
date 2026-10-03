-- rls_auto_enable() is the event-trigger function behind "ensure_rls": it
-- turns on row level security for every new table in public. It must stay.
-- It is SECURITY DEFINER and was executable by PUBLIC, anon and
-- authenticated, which also exposed it at /rest/v1/rpc/rls_auto_enable.
-- Event triggers run their function as part of DDL without an EXECUTE check
-- for the session user, so only the owner and the platform service role
-- need it. Nothing else about the function or the trigger changes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable' AND p.pronargs = 0
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated';
    END IF;
  END IF;
END $$;
