-- v19: Zaylo ID for every user, invite by ID, workspace join links, invites for people who haven't signed up yet.

-- ---------------------------------------------------------------------------
-- 1. Zaylo ID (users.referral_code): ZY-XXXXXX, unique, shown in Settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.new_zaylo_id()
RETURNS TEXT AS $$
DECLARE
    alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- no 0/O, 1/I
    v TEXT;
BEGIN
    LOOP
        v := 'ZY-';
        FOR i IN 1..6 LOOP v := v || substr(alphabet, 1 + floor(random() * 32)::int, 1); END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE referral_code = v);
    END LOOP;
    RETURN v;
END;
$$ LANGUAGE plpgsql VOLATILE SET search_path = public;

ALTER TABLE public.users ALTER COLUMN referral_code SET DEFAULT public.new_zaylo_id();
UPDATE public.users SET referral_code = 'ZY-' || substr(referral_code, 4)
 WHERE referral_code LIKE 'FV-%' AND NOT EXISTS (SELECT 1 FROM public.users u2 WHERE u2.referral_code = 'ZY-' || substr(public.users.referral_code, 4));
UPDATE public.users SET referral_code = public.new_zaylo_id() WHERE referral_code IS NULL OR referral_code NOT LIKE 'ZY-%';
CREATE UNIQUE INDEX IF NOT EXISTS users_zaylo_id_upper ON public.users (upper(referral_code));

-- Normalises what someone typed: email, phone, "ZY-ABC123", "zyabc123" or "ABC123"
CREATE OR REPLACE FUNCTION public.find_user_by_identifier(p_identifier TEXT)
RETURNS public.users AS $$
DECLARE
    v TEXT := trim(coalesce(p_identifier, ''));
    v_code TEXT := upper(regexp_replace(v, '[^A-Za-z0-9]', '', 'g'));
    v_phone TEXT := regexp_replace(v, '[^0-9+]', '', 'g');
    r public.users;
BEGIN
    IF v = '' THEN RETURN NULL; END IF;
    IF position('@' IN v) > 0 THEN
        SELECT * INTO r FROM public.users WHERE lower(email) = lower(v) LIMIT 1;
        RETURN r;
    END IF;
    IF v_code ~ '^(ZY)?[A-Z0-9]{6}$' THEN
        SELECT * INTO r FROM public.users WHERE upper(referral_code) = 'ZY-' || right(v_code, 6) LIMIT 1;
        IF FOUND THEN RETURN r; END IF;
    END IF;
    IF length(v_phone) >= 7 THEN
        SELECT * INTO r FROM public.users WHERE regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = v_phone LIMIT 1;
        RETURN r;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.find_user_by_identifier(TEXT) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Invites: shareable links and pending email invites
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
    email TEXT,                                   -- set for a personal invite to someone without an account
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '14 days',
    uses INT NOT NULL DEFAULT 0,
    max_uses INT,                                 -- null = unlimited until expiry
    revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_invites_ws ON public.workspace_invites (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_email ON public.workspace_invites (lower(email)) WHERE email IS NOT NULL;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invites_read_managers" ON public.workspace_invites;
CREATE POLICY "invites_read_managers" ON public.workspace_invites FOR SELECT TO authenticated
    USING (public.can_manage_workspace(workspace_id));
-- All writes go through the functions below.

CREATE OR REPLACE FUNCTION public.notify_user(p_user UUID, p_type TEXT, p_ws public.workspaces, p_message TEXT, p_sender TEXT)
RETURNS VOID AS $$
    INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, sender_name)
    VALUES (p_user, p_type, p_ws.id, p_ws.name, p_message, p_sender);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.notify_user(UUID, TEXT, public.workspaces, TEXT, TEXT) FROM PUBLIC;

-- Shared step: make someone an active member and tell them.
CREATE OR REPLACE FUNCTION public.join_workspace_internal(p_ws public.workspaces, p_user public.users, p_role TEXT, p_actor TEXT, p_via_link BOOLEAN)
RETURNS TEXT AS $$
DECLARE v_existing TEXT;
BEGIN
    SELECT status INTO v_existing FROM public.workspace_members WHERE workspace_id = p_ws.id AND user_id = p_user.id;
    IF v_existing = 'active' THEN RETURN 'already_member'; END IF;

    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    VALUES (p_ws.id, p_user.id, p_role, 'active')
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET status = 'active', role = EXCLUDED.role
        WHERE public.workspace_members.role <> 'owner';

    IF p_ws.type = 'personal' THEN UPDATE public.workspaces SET type = 'shared' WHERE id = p_ws.id; END IF;

    IF p_via_link THEN
        -- Tell the owner someone joined with their link
        PERFORM public.notify_user(p_ws.owner_id, 'member_joined', p_ws,
            format('%s joined "%s" with your invite link.', coalesce(nullif(p_user.name, ''), 'Someone'), p_ws.name), p_user.name);
        PERFORM public.notify_user(p_user.id, 'member_added', p_ws, format('You joined "%s".', p_ws.name), p_actor);
    ELSE
        PERFORM public.notify_user(p_user.id, 'member_added', p_ws,
            format('%s added you to "%s". It''s now in your workspaces.', coalesce(p_actor, 'An admin'), p_ws.name), p_actor);
    END IF;
    RETURN 'added';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.join_workspace_internal(public.workspaces, public.users, TEXT, TEXT, BOOLEAN) FROM PUBLIC;

-- Add by email, phone or Zaylo ID. Unknown email → pending invite they get when they sign up.
CREATE OR REPLACE FUNCTION public.add_workspace_member(p_workspace_id UUID, p_identifier TEXT, p_role TEXT DEFAULT 'member')
RETURNS TEXT AS $$
DECLARE
    v_target public.users;
    v_ws public.workspaces;
    v_actor public.users;
BEGIN
    IF NOT public.can_manage_workspace(p_workspace_id) THEN
        RAISE EXCEPTION 'Only the workspace owner, its admins or an app admin can add members';
    END IF;
    IF p_role NOT IN ('admin', 'member', 'viewer') THEN p_role := 'member'; END IF;
    SELECT * INTO v_ws FROM public.workspaces WHERE id = p_workspace_id;
    SELECT * INTO v_actor FROM public.users WHERE auth_id = auth.uid();

    v_target := public.find_user_by_identifier(p_identifier);
    IF v_target.id IS NULL THEN
        IF position('@' IN p_identifier) > 0 THEN
            INSERT INTO public.workspace_invites (workspace_id, role, email, created_by, max_uses, expires_at)
            VALUES (p_workspace_id, p_role, lower(trim(p_identifier)), v_actor.id, 1, now() + interval '30 days');
            RETURN 'pending';
        END IF;
        RETURN 'not_found';
    END IF;
    IF v_target.id = v_actor.id THEN RETURN 'self'; END IF;
    RETURN public.join_workspace_internal(v_ws, v_target, p_role, v_actor.name, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.add_workspace_member(UUID, TEXT, TEXT) TO authenticated;

-- A link anyone with a Zaylo account can use to join (until it expires or is revoked).
CREATE OR REPLACE FUNCTION public.create_workspace_invite(p_workspace_id UUID, p_role TEXT DEFAULT 'member', p_days INT DEFAULT 14)
RETURNS TEXT AS $$
DECLARE v_token TEXT;
BEGIN
    IF NOT public.can_manage_workspace(p_workspace_id) THEN RAISE EXCEPTION 'Only the workspace owner or its admins can create invite links'; END IF;
    IF p_role NOT IN ('admin', 'member', 'viewer') THEN p_role := 'member'; END IF;
    INSERT INTO public.workspace_invites (workspace_id, role, created_by, expires_at)
    VALUES (p_workspace_id, p_role, (SELECT id FROM public.users WHERE auth_id = auth.uid()), now() + make_interval(days => greatest(1, least(coalesce(p_days, 14), 90))))
    RETURNING token INTO v_token;
    RETURN v_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.create_workspace_invite(UUID, TEXT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_workspace_invite(p_invite_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.workspace_invites SET revoked = TRUE
     WHERE id = p_invite_id AND public.can_manage_workspace(workspace_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.revoke_workspace_invite(UUID) TO authenticated;

-- What a join link points to, for the "Join workspace?" screen.
CREATE OR REPLACE FUNCTION public.get_workspace_invite(p_token TEXT)
RETURNS JSON AS $$
DECLARE i public.workspace_invites; w public.workspaces; inviter TEXT; members INT;
BEGIN
    SELECT * INTO i FROM public.workspace_invites WHERE token = p_token;
    IF NOT FOUND THEN RETURN json_build_object('status', 'not_found'); END IF;
    SELECT * INTO w FROM public.workspaces WHERE id = i.workspace_id;
    SELECT name INTO inviter FROM public.users WHERE id = i.created_by;
    SELECT count(*) INTO members FROM public.workspace_members WHERE workspace_id = w.id AND status = 'active';
    RETURN json_build_object(
        'status', CASE WHEN i.revoked THEN 'revoked' WHEN i.expires_at < now() THEN 'expired'
                       WHEN i.max_uses IS NOT NULL AND i.uses >= i.max_uses THEN 'used' ELSE 'valid' END,
        'workspace', w.name, 'icon', w.icon, 'color', w.color, 'role', i.role, 'inviter', inviter, 'members', members,
        'already_member', EXISTS (SELECT 1 FROM public.workspace_members m JOIN public.users u ON u.id = m.user_id
                                  WHERE m.workspace_id = w.id AND u.auth_id = auth.uid() AND m.status = 'active'),
        'workspace_id', w.id
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.get_workspace_invite(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_workspace_invite(p_token TEXT)
RETURNS JSON AS $$
DECLARE i public.workspace_invites; w public.workspaces; me public.users; inviter TEXT; r TEXT;
BEGIN
    SELECT * INTO me FROM public.users WHERE auth_id = auth.uid();
    IF me.id IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
    SELECT * INTO i FROM public.workspace_invites WHERE token = p_token FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'This invite link doesn''t exist'; END IF;
    IF i.revoked THEN RAISE EXCEPTION 'This invite link was turned off'; END IF;
    IF i.expires_at < now() THEN RAISE EXCEPTION 'This invite link has expired. Ask for a new one'; END IF;
    IF i.max_uses IS NOT NULL AND i.uses >= i.max_uses THEN RAISE EXCEPTION 'This invite was already used'; END IF;
    IF i.email IS NOT NULL AND lower(i.email) <> lower(coalesce(me.email, '')) THEN
        RAISE EXCEPTION 'This invite is for %', i.email;
    END IF;
    SELECT * INTO w FROM public.workspaces WHERE id = i.workspace_id;
    SELECT name INTO inviter FROM public.users WHERE id = i.created_by;
    r := public.join_workspace_internal(w, me, i.role, inviter, TRUE);
    IF r = 'added' THEN UPDATE public.workspace_invites SET uses = uses + 1 WHERE id = i.id; END IF;
    RETURN json_build_object('status', r, 'workspace_id', w.id, 'workspace', w.name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(TEXT) TO authenticated;

-- Called after sign-in: joins any workspaces someone invited this email to before the account existed.
CREATE OR REPLACE FUNCTION public.claim_pending_invites()
RETURNS INT AS $$
DECLARE me public.users; i public.workspace_invites; w public.workspaces; inviter TEXT; n INT := 0;
BEGIN
    SELECT * INTO me FROM public.users WHERE auth_id = auth.uid();
    IF me.id IS NULL OR coalesce(me.email, '') = '' THEN RETURN 0; END IF;
    FOR i IN SELECT * FROM public.workspace_invites
              WHERE lower(email) = lower(me.email) AND NOT revoked AND expires_at > now()
                AND (max_uses IS NULL OR uses < max_uses) FOR UPDATE LOOP
        SELECT * INTO w FROM public.workspaces WHERE id = i.workspace_id;
        SELECT name INTO inviter FROM public.users WHERE id = i.created_by;
        IF public.join_workspace_internal(w, me, i.role, inviter, FALSE) = 'added' THEN n := n + 1; END IF;
        UPDATE public.workspace_invites SET uses = uses + 1 WHERE id = i.id;
    END LOOP;
    RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.claim_pending_invites() TO authenticated;

-- Make sure notifications stream live to the app
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
    END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

select 'v19 ok' as result;
