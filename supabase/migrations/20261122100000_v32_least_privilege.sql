-- ============================================================================
-- Zaylo V32: least privilege for the API roles
-- ============================================================================
-- Before this, the anonymous API role (anyone holding the public app key, without signing in) had
-- every table privilege on every table, including TRUNCATE, and could call every database function.
-- Row-level security still hid the rows, but nothing in the app needs any of that before sign-in.
--
--   1. Not signed in (anon): no table privileges at all. Only the small yes/no helpers that
--      row-level and storage policies call stay callable, so a policy check fails closed instead
--      of erroring.
--   2. Signed in (authenticated): keeps SELECT/INSERT/UPDATE/DELETE where it had them, but loses
--      TRUNCATE, TRIGGER and REFERENCES, which the app never uses (TRUNCATE ignores row-level security).
--   3. Functions: EXECUTE is no longer given to everyone (PUBLIC). Signed-in people keep the ones
--      the app calls; trigger functions are callable by nobody (triggers don't need it).
--   4. The same rules for tables and functions created later.
--   5. update_updated_at_column gets a fixed search_path.
-- Changes privileges only, no rows. Safe to run more than once.

-- ── 1 & 2. Tables and sequences ────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;

-- ── 3. Functions ────────────────────────────────────────────────────────────
DO $$
DECLARE f RECORD;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS sig,
               pg_get_function_result(p.oid) = 'trigger' AS is_trigger,
               p.proname,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_had
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prokind = 'f'
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
        IF f.is_trigger THEN
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f.sig);
        ELSIF f.auth_had THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
        END IF;
    END LOOP;
END $$;

-- Yes/no helpers used inside row-level and storage policies. They reveal nothing to someone who is
-- not signed in (they answer false or NULL), and keeping them callable means a policy check on a
-- storage request without a session is refused cleanly rather than with an error.
DO $$
DECLARE s TEXT;
BEGIN
    FOREACH s IN ARRAY ARRAY[
        'public.current_user_id()', 'public.is_app_admin()', 'public.mfa_ok()',
        'public.check_is_workspace_member(uuid)', 'public.check_is_workspace_admin(uuid)',
        'public.can_manage_workspace(uuid)', 'public.can_access_chat_file(text)'
    ] LOOP
        IF to_regprocedure(s) IS NOT NULL THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', s);
        END IF;
    END LOOP;
END $$;

-- Column default on users.referral_code: inserts by a signed-in person evaluate it
DO $$ BEGIN
    IF to_regprocedure('public.new_zaylo_id()') IS NOT NULL THEN
        GRANT EXECUTE ON FUNCTION public.new_zaylo_id() TO authenticated;
    END IF;
END $$;

-- ── 4. Things created later ─────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- ── 5. Fixed search_path ────────────────────────────────────────────────────
DO $$ BEGIN
    IF to_regprocedure('public.update_updated_at_column()') IS NOT NULL THEN
        ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
    END IF;
END $$;
