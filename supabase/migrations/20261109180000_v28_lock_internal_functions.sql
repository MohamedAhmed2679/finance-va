-- ============================================================================
-- Zaylo V28 — lock the internal membership helpers
-- Supabase gives the API roles (anon, authenticated) EXECUTE on every new function,
-- so "REVOKE ... FROM PUBLIC" alone left these four callable from the app's API.
-- Called directly, join_workspace_internal / invite_workspace_internal let any
-- signed-in person make themselves a member of someone else's workspace,
-- notify_user let them send a notification in anyone's name, and
-- find_user_by_identifier let them look up accounts by email or phone.
-- They are only meant to run inside the checked functions (add_workspace_member,
-- accept_workspace_invite, claim_pending_invites, respond_to_invitation …), which
-- run as their owner and keep working. Safe to run more than once.
-- ============================================================================
REVOKE ALL ON FUNCTION public.join_workspace_internal(public.workspaces, public.users, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_user(UUID, TEXT, public.workspaces, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_user_by_identifier(TEXT) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
    IF to_regprocedure('public.invite_workspace_internal(public.workspaces, public.users, text, text)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.invite_workspace_internal(public.workspaces, public.users, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- Check: every row must say false
SELECT p.proname AS internal_function,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS app_users_can_call,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anyone_can_call
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('join_workspace_internal', 'invite_workspace_internal', 'notify_user', 'find_user_by_identifier');
