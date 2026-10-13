-- The append-only trigger function raised a Supabase advisory (role-mutable search_path).
-- It references no tables or functions, so pinning the path changes nothing about its behaviour.
ALTER FUNCTION channel_publication_event_no_mutation() SET search_path = pg_catalog;
