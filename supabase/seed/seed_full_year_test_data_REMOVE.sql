-- Removes the test data added by seed_full_year_test_data.sql (and nothing else) from
-- mohamed@unifiedhive.com's Personal workspace.
DO $$
DECLARE
    v_marker TIMESTAMPTZ := '2001-01-01 00:00:07.777+00';
    v_ws UUID;
BEGIN
    SELECT w.id INTO v_ws FROM public.workspaces w
      JOIN public.users u ON u.id = w.owner_id JOIN auth.users a ON a.id = u.auth_id
     WHERE lower(a.email) = 'mohamed@unifiedhive.com' ORDER BY (w.type = 'personal') DESC, coalesce(w.is_archived, false), w.created_at LIMIT 1;
    IF v_ws IS NULL THEN RAISE EXCEPTION 'Workspace not found'; END IF;
    DELETE FROM public.expenses WHERE workspace_id = v_ws AND 'test-seed' = ANY (tags);
    DELETE FROM public.incomes WHERE workspace_id = v_ws AND created_at = v_marker;
    DELETE FROM public.monthly_bills WHERE workspace_id = v_ws AND created_at = v_marker;
    DELETE FROM public.savings_goals WHERE workspace_id = v_ws AND created_at = v_marker;
END $$;
SELECT 'test data removed' AS result;
