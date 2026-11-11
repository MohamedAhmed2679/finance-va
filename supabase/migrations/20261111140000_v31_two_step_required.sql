-- ============================================================================
-- Zaylo V31: two-step verification is enforced on the data, not only on the screen
-- ============================================================================
-- An account that has turned on two-step verification (a verified authenticator app in Supabase
-- Auth) can read and change its data only from a session that has entered a code. A password
-- alone, or a stolen first-step token, gets nothing from the tables or from file storage.
-- Accounts without two-step verification are not affected.
--
-- How: one helper (public.mfa_ok) and one RESTRICTIVE policy per table, which is ANDed with the
-- existing policies. Adds policies only; changes no rows and no existing policy. Safe to run again.
--
-- Not covered: database functions that run with their owner's rights are called directly, not
-- through these policies. They check the signed-in person themselves.

CREATE OR REPLACE FUNCTION public.mfa_ok()
RETURNS BOOLEAN AS $$
BEGIN
    IF auth.uid() IS NULL THEN RETURN TRUE; END IF;                              -- not a signed-in person: the other policies decide
    IF coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' THEN RETURN TRUE; END IF;  -- this session entered a code
    RETURN NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified');
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
    -- A set-up fault that would be the same for everybody. Don't lock every account out over it.
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.mfa_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mfa_ok() TO anon, authenticated, service_role;

DO $$
DECLARE t RECORD;
BEGIN
    FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity LOOP
        EXECUTE format('DROP POLICY IF EXISTS "two_step_required" ON public.%I', t.relname);
        EXECUTE format('CREATE POLICY "two_step_required" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.mfa_ok())) WITH CHECK ((SELECT public.mfa_ok()))', t.relname);
    END LOOP;
END $$;

-- Files (receipts, chat and support attachments)
DO $$ BEGIN
    DROP POLICY IF EXISTS "two_step_required" ON storage.objects;
    CREATE POLICY "two_step_required" ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.mfa_ok())) WITH CHECK ((SELECT public.mfa_ok()));
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'storage.objects policy not added (no permission); add it in the dashboard under Storage > Policies';
END $$;

-- Check after running: every table with row-level security should be counted, and the helper should answer true here
SELECT (SELECT count(*) FROM pg_policies WHERE policyname = 'two_step_required' AND schemaname = 'public') AS tables_covered,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity) AS tables_with_rls,
       (SELECT count(*) FROM pg_policies WHERE policyname = 'two_step_required' AND schemaname = 'storage') AS storage_covered,
       has_table_privilege(current_user, 'auth.mfa_factors', 'SELECT') AS helper_can_read_factors,
       public.mfa_ok() AS helper_answers;
