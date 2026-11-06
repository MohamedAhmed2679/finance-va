-- v24: deleting an account for real (Settings → Security & Privacy → Delete account).
-- Called only by the server (api/account.ts) after it has checked who is asking; the server then
-- deletes the files it returns and the sign-in account itself.
--
--   * Workspaces you own on your own are deleted, with everything in them.
--   * Shared workspaces you own pass to the next admin (or, if none, the longest-standing member),
--     who is told. Their data stays.
--   * In other people's workspaces your entries stay (they are the household's records) but show
--     "Deleted user"; your name and email are removed everywhere.
--   * Your chat and support messages, notifications, devices, reminders, cloud-backup connections,
--     Smart Carts, categories and history are deleted.
-- Safe to run more than once.

-- Smart Cart items in a confirmed cart are frozen; account deletion is the one thing allowed to remove them.
CREATE OR REPLACE FUNCTION public.smart_cart_item_guard()
RETURNS TRIGGER AS $$
DECLARE v_status TEXT; v_cart UUID := COALESCE(NEW.cart_id, OLD.cart_id);
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('zaylo.account_deletion', true) = 'on' THEN RETURN OLD; END IF;
    SELECT status INTO v_status FROM public.smart_carts WHERE id = v_cart;
    IF v_status IN ('confirmed', 'discarded') THEN RAISE EXCEPTION 'smart_cart: this cart is % and can no longer change', v_status USING ERRCODE = 'P0001'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.cart_id <> OLD.cart_id THEN RAISE EXCEPTION 'smart_cart: items cannot move between carts'; END IF;
    -- any change invalidates a calculated summary
    UPDATE public.smart_carts SET status = 'draft', updated_at = now() WHERE id = v_cart AND status = 'calculated';
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    NEW.updated_at := now();
    NEW.name := btrim(NEW.name);
    IF NEW.expiry_date IS NOT NULL AND NEW.production_date IS NOT NULL AND NEW.expiry_date < NEW.production_date THEN
        RAISE EXCEPTION 'smart_cart: the expiry date is before the production date';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

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

-- What deleting would do, shown to the person before they confirm (their own account only)
CREATE OR REPLACE FUNCTION public.account_deletion_preview()
RETURNS JSONB AS $$
DECLARE v_me UUID := public.current_user_id();
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
    RETURN jsonb_build_object(
        'deleteWorkspaces', coalesce((SELECT jsonb_agg(w.name ORDER BY w.name) FROM public.workspaces w WHERE w.owner_id = v_me
            AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = w.id AND m.user_id <> v_me AND m.status = 'active')), '[]'::jsonb),
        'transferWorkspaces', coalesce((SELECT jsonb_agg(w.name ORDER BY w.name) FROM public.workspaces w WHERE w.owner_id = v_me
            AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = w.id AND m.user_id <> v_me AND m.status = 'active')), '[]'::jsonb),
        'leaveWorkspaces', coalesce((SELECT jsonb_agg(w.name ORDER BY w.name) FROM public.workspaces w
            JOIN public.workspace_members m ON m.workspace_id = w.id AND m.user_id = v_me WHERE w.owner_id <> v_me), '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.account_deletion_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_deletion_preview() TO authenticated;

SELECT 'v24 ok';
