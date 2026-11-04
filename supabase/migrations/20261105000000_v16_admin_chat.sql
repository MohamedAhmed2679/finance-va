-- ============================================================================
-- Finance VA V16 — admin console, workspace chat, announcements, support messages
-- Safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. User flags + robust profile creation
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS show_onboarding BOOLEAN DEFAULT TRUE;

-- Sign-up must never fail because of the profile row: on any profile error the
-- auth user is still created and the app calls ensure_profile() on first load.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    BEGIN
        INSERT INTO public.users (auth_id, name, email, phone, country)
        VALUES (
            NEW.id,
            COALESCE(
                NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
                NULLIF(NEW.raw_user_meta_data->>'name', ''),
                NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
                'Member'
            ),
            NULLIF(NEW.email, ''),
            COALESCE(NULLIF(NEW.phone, ''), NULLIF(NEW.raw_user_meta_data->>'phone', '')),
            NULLIF(NEW.raw_user_meta_data->>'country', '')
        )
        ON CONFLICT (auth_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Called by the app when a signed-in user has no profile row yet.
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.users AS $$
DECLARE
    v_row public.users;
    v_auth auth.users;
BEGIN
    SELECT * INTO v_row FROM public.users WHERE auth_id = auth.uid();
    IF FOUND THEN RETURN v_row; END IF;

    SELECT * INTO v_auth FROM auth.users WHERE id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'not signed in'; END IF;

    INSERT INTO public.users (auth_id, name, email, phone)
    VALUES (
        v_auth.id,
        COALESCE(NULLIF(v_auth.raw_user_meta_data->>'full_name', ''), NULLIF(v_auth.raw_user_meta_data->>'name', ''),
                 NULLIF(split_part(COALESCE(v_auth.email, ''), '@', 1), ''), 'Member'),
        CASE WHEN EXISTS (SELECT 1 FROM public.users WHERE email = v_auth.email) THEN NULL ELSE NULLIF(v_auth.email, '') END,
        NULLIF(v_auth.phone, '')
    )
    ON CONFLICT (auth_id) DO NOTHING
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        SELECT * INTO v_row FROM public.users WHERE auth_id = auth.uid();
    END IF;
    RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

-- Profiles for auth users created before the trigger existed (or whose insert failed)
INSERT INTO public.users (auth_id, name, email, phone)
SELECT a.id,
       COALESCE(NULLIF(a.raw_user_meta_data->>'full_name', ''), NULLIF(split_part(COALESCE(a.email, ''), '@', 1), ''), 'Member'),
       CASE WHEN EXISTS (SELECT 1 FROM public.users u2 WHERE u2.email = a.email) THEN NULL ELSE NULLIF(a.email, '') END,
       NULLIF(a.phone, '')
FROM auth.users a
LEFT JOIN public.users u ON u.auth_id = a.id
WHERE u.id IS NULL
ON CONFLICT (auth_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN AS $$
    SELECT COALESCE((SELECT is_admin FROM public.users WHERE auth_id = auth.uid()), FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- Users may not promote themselves: is_admin / is_banned are only changed with the service key.
CREATE OR REPLACE FUNCTION public.protect_user_flags()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.role() = 'authenticated' THEN
        NEW.is_admin := OLD.is_admin;
        NEW.is_banned := OLD.is_banned;
        NEW.auth_id := OLD.auth_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS users_protect_flags ON public.users;
CREATE TRIGGER users_protect_flags BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.protect_user_flags();

-- ---------------------------------------------------------------------------
-- 2. Workspace members with names (users table is private per-row)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_workspace_members(p_workspace_id UUID)
RETURNS TABLE (user_id UUID, name TEXT, email TEXT, role TEXT, status TEXT, joined_at TIMESTAMPTZ) AS $$
BEGIN
    IF NOT (public.check_is_workspace_member(p_workspace_id) OR public.is_app_admin()
            OR EXISTS (SELECT 1 FROM public.workspaces w JOIN public.users u ON u.id = w.owner_id
                       WHERE w.id = p_workspace_id AND u.auth_id = auth.uid())) THEN
        RAISE EXCEPTION 'not a member of this workspace';
    END IF;
    RETURN QUERY
        SELECT m.user_id, u.name, u.email, m.role, m.status, m.joined_at
        FROM public.workspace_members m
        JOIN public.users u ON u.id = m.user_id
        WHERE m.workspace_id = p_workspace_id AND m.status <> 'removed'
        ORDER BY (m.role = 'owner') DESC, u.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.get_workspace_members(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_workspace(p_workspace_id UUID)
RETURNS BOOLEAN AS $$
    SELECT public.is_app_admin()
        OR public.check_is_workspace_admin(p_workspace_id)
        OR EXISTS (SELECT 1 FROM public.workspaces w JOIN public.users u ON u.id = w.owner_id
                   WHERE w.id = p_workspace_id AND u.auth_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Add an existing Finance VA user to a workspace by email or phone.
CREATE OR REPLACE FUNCTION public.add_workspace_member(p_workspace_id UUID, p_identifier TEXT, p_role TEXT DEFAULT 'member')
RETURNS TEXT AS $$
DECLARE
    v_target public.users;
    v_ws public.workspaces;
    v_actor TEXT;
BEGIN
    IF NOT public.can_manage_workspace(p_workspace_id) THEN
        RAISE EXCEPTION 'Only the workspace owner, its admins or an app admin can add members';
    END IF;
    IF p_role NOT IN ('admin', 'member', 'viewer') THEN p_role := 'member'; END IF;

    SELECT * INTO v_ws FROM public.workspaces WHERE id = p_workspace_id;
    SELECT * INTO v_target FROM public.users
        WHERE lower(email) = lower(trim(p_identifier)) OR phone = trim(p_identifier)
        LIMIT 1;
    IF NOT FOUND THEN
        RETURN 'not_found';
    END IF;

    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    VALUES (p_workspace_id, v_target.id, p_role, 'active')
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET status = 'active', role = EXCLUDED.role
        WHERE public.workspace_members.role <> 'owner';

    SELECT name INTO v_actor FROM public.users WHERE auth_id = auth.uid();
    INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, sender_name)
    VALUES (v_target.id, 'member_added', p_workspace_id, v_ws.name,
            format('%s added you to "%s".', COALESCE(v_actor, 'An admin'), v_ws.name), v_actor);

    IF v_ws.type = 'personal' THEN
        UPDATE public.workspaces SET type = 'shared' WHERE id = p_workspace_id;
    END IF;
    RETURN 'added';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.add_workspace_member(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_workspace_member(p_workspace_id UUID, p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_self UUID;
BEGIN
    SELECT id INTO v_self FROM public.users WHERE auth_id = auth.uid();
    -- Anyone may leave; removing someone else needs manage rights
    IF p_user_id <> v_self AND NOT public.can_manage_workspace(p_workspace_id) THEN
        RAISE EXCEPTION 'Only the workspace owner, its admins or an app admin can remove members';
    END IF;
    IF EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND role = 'owner') THEN
        RAISE EXCEPTION 'The owner cannot be removed';
    END IF;
    DELETE FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    RETURN 'removed';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_workspace_member_role(p_workspace_id UUID, p_user_id UUID, p_role TEXT)
RETURNS TEXT AS $$
BEGIN
    IF NOT public.can_manage_workspace(p_workspace_id) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;
    IF p_role NOT IN ('admin', 'member', 'viewer') THEN RAISE EXCEPTION 'Invalid role'; END IF;
    UPDATE public.workspace_members SET role = p_role
        WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND role <> 'owner';
    RETURN 'updated';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.set_workspace_member_role(UUID, UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Workspace chat
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_ws_time ON public.chat_messages(workspace_id, created_at DESC);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_select" ON public.chat_messages;
CREATE POLICY "chat_select" ON public.chat_messages FOR SELECT USING (
    public.check_is_workspace_member(workspace_id) OR public.is_app_admin()
);
DROP POLICY IF EXISTS "chat_insert" ON public.chat_messages;
CREATE POLICY "chat_insert" ON public.chat_messages FOR INSERT WITH CHECK (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid() AND NOT is_banned)
    AND public.check_is_workspace_member(workspace_id)
);
DROP POLICY IF EXISTS "chat_update" ON public.chat_messages;
CREATE POLICY "chat_update" ON public.chat_messages FOR UPDATE USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR public.can_manage_workspace(workspace_id)
);

-- Sender name comes from the profile, not the client
CREATE OR REPLACE FUNCTION public.chat_set_sender()
RETURNS TRIGGER AS $$
BEGIN
    SELECT name INTO NEW.sender_name FROM public.users WHERE id = NEW.user_id;
    NEW.sender_name := COALESCE(NEW.sender_name, 'Member');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS chat_set_sender ON public.chat_messages;
CREATE TRIGGER chat_set_sender BEFORE INSERT ON public.chat_messages
    FOR EACH ROW EXECUTE FUNCTION public.chat_set_sender();

-- ---------------------------------------------------------------------------
-- 4. Announcements (written by admins through the server API)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "announcements_read" ON public.announcements;
CREATE POLICY "announcements_read" ON public.announcements FOR SELECT TO authenticated USING (
    (is_active AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())) OR public.is_app_admin()
);

-- ---------------------------------------------------------------------------
-- 5. Support messages (user <-> admin conversation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    from_admin BOOLEAN NOT NULL DEFAULT FALSE,
    sender_name TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_user_time ON public.support_messages(user_id, created_at);
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "support_select_own" ON public.support_messages;
CREATE POLICY "support_select_own" ON public.support_messages FOR SELECT USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
DROP POLICY IF EXISTS "support_insert_own" ON public.support_messages;
CREATE POLICY "support_insert_own" ON public.support_messages FOR INSERT WITH CHECK (
    from_admin = FALSE AND user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
DROP POLICY IF EXISTS "support_mark_read" ON public.support_messages;
CREATE POLICY "support_mark_read" ON public.support_messages FOR UPDATE USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- 6. Audit log (service key only — no client policies)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID,
    actor_email TEXT,
    action TEXT NOT NULL,
    target_user_id UUID,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON public.audit_log(created_at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Notifications: allow deleting your own, add an optional link
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;
CREATE POLICY "notifications_delete" ON public.notifications FOR DELETE USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- 7. Realtime for chat, notifications, support, announcements
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['chat_messages', 'notifications', 'support_messages', 'announcements'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Bootstrap admins: anyone whose email is listed here is an app admin,
--    now and whenever that email signs up later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_emails (email TEXT PRIMARY KEY);
ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;
INSERT INTO public.admin_emails (email) VALUES ('mohamed@unifiedhive.com') ON CONFLICT DO NOTHING;

UPDATE public.users SET is_admin = TRUE
WHERE lower(email) IN (SELECT email FROM public.admin_emails);

CREATE OR REPLACE FUNCTION public.promote_listed_admin()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.email IS NOT NULL AND lower(NEW.email) IN (SELECT email FROM public.admin_emails) THEN
        NEW.is_admin := TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS users_promote_listed_admin ON public.users;
CREATE TRIGGER users_promote_listed_admin BEFORE INSERT ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.promote_listed_admin();
