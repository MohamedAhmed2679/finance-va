-- ============================================================================
-- Zaylo V30: account deletion covers the Help and AI records; limits that hold across servers
-- ============================================================================
--   1. Deleting an account now also removes the person's support requests, AI permission records
--      and AI feedback. Before this, those rows stayed when a nameless placeholder was kept for
--      records the person had added to someone else's workspace.
--   2. Rate limits kept in the database, so they hold whichever server answers:
--        * Zaylo AI: 60 calls in 10 minutes for each person (public.ai_rate_ok)
--        * Support requests: 10 an hour and 30 a day for each person
-- Adds one table and replaces functions. Changes no existing rows. Safe to run more than once.

-- ── 1. Rate events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('ai')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_events_user_kind_time ON public.rate_events (user_id, kind, created_at DESC);
ALTER TABLE public.rate_events ENABLE ROW LEVEL SECURITY;
-- No policies: nobody reads or writes this table directly. Only the function below touches it.
REVOKE ALL ON public.rate_events FROM anon, authenticated;

-- Counts one Zaylo AI call for the signed-in person. FALSE = over the limit (nothing is counted).
-- The limit is fixed here, so a caller cannot choose a more generous one.
CREATE OR REPLACE FUNCTION public.ai_rate_ok()
RETURNS BOOLEAN AS $$
DECLARE v_me UUID := public.current_user_id(); v_n INT;
BEGIN
    IF v_me IS NULL THEN RETURN FALSE; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('rate:ai:' || v_me::text));
    DELETE FROM public.rate_events WHERE user_id = v_me AND created_at < now() - interval '1 day';
    SELECT count(*) INTO v_n FROM public.rate_events WHERE user_id = v_me AND kind = 'ai' AND created_at > now() - interval '10 minutes';
    IF v_n >= 60 THEN RETURN FALSE; END IF;
    INSERT INTO public.rate_events (user_id, kind) VALUES (v_me, 'ai');
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.ai_rate_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_rate_ok() TO authenticated;

-- ── 2. Support requests: 10 an hour, 30 a day ───────────────────────────────
CREATE OR REPLACE FUNCTION public.support_request_rate_guard()
RETURNS TRIGGER AS $$
DECLARE v_hour INT; v_day INT;
BEGIN
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- the server and the team are not limited
    SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour'), count(*)
      INTO v_hour, v_day
      FROM public.support_requests WHERE user_id = NEW.user_id AND created_at > now() - interval '1 day';
    IF v_hour >= 10 OR v_day >= 30 THEN
        RAISE EXCEPTION 'support: too many requests in a short time' USING ERRCODE = 'P0001', HINT = 'rate_limited';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.support_request_rate_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS support_request_rate ON public.support_requests;
CREATE TRIGGER support_request_rate BEFORE INSERT ON public.support_requests
    FOR EACH ROW EXECUTE FUNCTION public.support_request_rate_guard();

-- ── 3. Account deletion ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_account_data(p_auth_id UUID)
RETURNS JSONB AS $$
DECLARE
    u public.users;
    w RECORD;
    v_next UUID;
    v_deleted UUID[] := '{}';
    v_transferred INT := 0;
    v_paths TEXT[];
    v_member_of UUID[];
BEGIN
    SELECT * INTO u FROM public.users WHERE auth_id = p_auth_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('deleted', false, 'reason', 'no_profile', 'storagePaths', '[]'::jsonb); END IF;
    PERFORM set_config('zaylo.account_deletion', 'on', true);
    SELECT coalesce(array_agg(workspace_id), '{}') INTO v_member_of FROM public.workspace_members WHERE user_id = u.id;

    -- Files to delete afterwards (the server removes them through the Storage API)
    SELECT coalesce(array_agg(o.bucket_id || '/' || o.name), '{}') INTO v_paths
      FROM storage.objects o
     WHERE o.bucket_id IN ('smart-cart', 'chat-attachments')
       AND (o.name LIKE p_auth_id::text || '/%' OR o.owner = p_auth_id);

    -- Workspaces this person owns
    FOR w IN SELECT id, name FROM public.workspaces WHERE owner_id = u.id LOOP
        SELECT m.user_id INTO v_next FROM public.workspace_members m
         WHERE m.workspace_id = w.id AND m.user_id <> u.id AND m.status = 'active'
         ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, m.joined_at NULLS LAST, m.user_id
         LIMIT 1;
        IF v_next IS NULL THEN
            v_deleted := v_deleted || w.id;
        ELSE
            UPDATE public.workspaces SET owner_id = v_next WHERE id = w.id;
            UPDATE public.workspace_members SET role = 'owner' WHERE workspace_id = w.id AND user_id = v_next;
            INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, link)
            VALUES (v_next, 'role_change', w.id, w.name, format('You now own "%s". Its previous owner deleted their Zaylo account.', w.name), '/workspaces');
            v_transferred := v_transferred + 1;
        END IF;
    END LOOP;
    DELETE FROM public.workspaces WHERE id = ANY (v_deleted);

    -- Personal things, wherever they are
    DELETE FROM public.workspace_members WHERE user_id = u.id;
    DELETE FROM public.smart_carts WHERE user_id = u.id;
    DELETE FROM public.chat_messages WHERE user_id = u.id;
    DELETE FROM public.support_messages WHERE user_id = u.id;
    -- v30: Help and AI records (v29) go too, even when a nameless placeholder row is kept below
    DELETE FROM public.support_requests WHERE user_id = u.id;
    DELETE FROM public.consent_events WHERE user_id = u.id;
    DELETE FROM public.ai_feedback WHERE user_id = u.id;
    DELETE FROM public.rate_events WHERE user_id = u.id;
    DELETE FROM public.notifications WHERE user_id = u.id;
    DELETE FROM public.push_subscriptions WHERE user_id = u.id;
    DELETE FROM public.cloud_connections WHERE user_id = u.id;
    DELETE FROM public.custom_categories WHERE user_id = u.id;
    DELETE FROM public.custom_payment_methods WHERE user_id = u.id;
    DELETE FROM public.workspace_invites WHERE created_by = u.id;
    UPDATE public.users SET referred_by = NULL WHERE referred_by = u.id;

    -- Their name no longer appears in other people's workspaces
    UPDATE public.activity_log SET user_name = 'Deleted user' WHERE user_id = u.id;
    UPDATE public.notifications SET sender_name = 'Deleted user'
     WHERE sender_name = u.name AND workspace_id = ANY (v_member_of);

    -- Keep a nameless placeholder only if shared records still point at this person; otherwise remove the row
    IF EXISTS (SELECT 1 FROM public.expenses WHERE created_by = u.id)
       OR EXISTS (SELECT 1 FROM public.incomes WHERE created_by = u.id)
       OR EXISTS (SELECT 1 FROM public.monthly_bills WHERE created_by = u.id)
       OR EXISTS (SELECT 1 FROM public.activity_log WHERE user_id = u.id) THEN
        UPDATE public.users SET
            auth_id = gen_random_uuid(), name = 'Deleted user', email = 'deleted-' || u.id || '@deleted.zaylo.invalid',
            phone = NULL, avatar_url = NULL, country = NULL, monthly_budget = NULL, connected_clouds = '{}',
            notify_daily = FALSE, notify_monthly = FALSE, notify_budget = FALSE, is_admin = FALSE, is_banned = TRUE,
            last_seen_at = NULL
         WHERE id = u.id;
    ELSE
        DELETE FROM public.users WHERE id = u.id;
    END IF;

    -- History of what was deleted would still hold the data: remove it too
    DELETE FROM public.change_history
     WHERE workspace_id = ANY (v_deleted)
        OR (table_name = 'users' AND row_id = u.id::text)
        OR changed_by = p_auth_id AND workspace_id IS NULL;

    INSERT INTO public.audit_log (action, target_user_id, details)
    VALUES ('account_deleted', u.id, jsonb_build_object('workspacesDeleted', cardinality(v_deleted), 'workspacesTransferred', v_transferred));

    PERFORM set_config('zaylo.account_deletion', '', true);
    RETURN jsonb_build_object('deleted', true, 'workspacesDeleted', cardinality(v_deleted), 'workspacesTransferred', v_transferred,
                              'storagePaths', to_jsonb(v_paths));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.delete_account_data(UUID) FROM PUBLIC, anon, authenticated;

-- Check after running: both should be listed, and rate_events should grant nothing to signed-in people
SELECT 'function' AS what, proname AS name FROM pg_proc WHERE proname IN ('ai_rate_ok', 'support_request_rate_guard')
UNION ALL
SELECT 'grant on rate_events', coalesce(string_agg(privilege_type, ','), 'none') FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'rate_events' AND grantee IN ('anon', 'authenticated');
