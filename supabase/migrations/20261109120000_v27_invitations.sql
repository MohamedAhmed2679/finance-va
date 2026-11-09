-- ============================================================================
-- Zaylo V27 — workspace invitations need the guest's answer
-- Adding someone by email, phone or Zaylo ID no longer puts them straight into the
-- workspace. They get an invitation (membership status 'invited') and join only
-- when they accept; declining removes it. Email invites for people without an
-- account become invitations once they sign up. Join links are unchanged: opening
-- one already shows a "Join workspace?" screen.
-- Safe to run more than once.
-- ============================================================================

-- Invite an existing user: an 'invited' membership plus a notification they can answer.
CREATE OR REPLACE FUNCTION public.invite_workspace_internal(p_ws public.workspaces, p_user public.users, p_role TEXT, p_actor TEXT)
RETURNS TEXT AS $$
DECLARE v_existing TEXT;
BEGIN
    SELECT status INTO v_existing FROM public.workspace_members WHERE workspace_id = p_ws.id AND user_id = p_user.id;
    IF v_existing = 'active' THEN RETURN 'already_member'; END IF;
    IF v_existing = 'invited' THEN
        UPDATE public.workspace_members SET role = p_role, joined_at = now()
         WHERE workspace_id = p_ws.id AND user_id = p_user.id AND role <> 'owner';
        RETURN 'already_invited';
    END IF;

    INSERT INTO public.workspace_members (workspace_id, user_id, role, status, joined_at)
    VALUES (p_ws.id, p_user.id, p_role, 'invited', now())
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET status = 'invited', role = EXCLUDED.role, joined_at = now()
        WHERE public.workspace_members.role <> 'owner';

    PERFORM public.notify_user(p_user.id, 'workspace_invite', p_ws,
        format('%s invited you to join "%s". Accept or decline in Workspaces.', coalesce(nullif(p_actor, ''), 'Someone'), p_ws.name), p_actor);
    RETURN 'invited';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.invite_workspace_internal(public.workspaces, public.users, TEXT, TEXT) FROM PUBLIC;

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
    RETURN public.invite_workspace_internal(v_ws, v_target, p_role, v_actor.name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.add_workspace_member(UUID, TEXT, TEXT) TO authenticated;

-- After sign-up: email invites become invitations to answer (no longer automatic joins).
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
        IF public.invite_workspace_internal(w, me, i.role, inviter) = 'invited' THEN n := n + 1; END IF;
        UPDATE public.workspace_invites SET uses = uses + 1 WHERE id = i.id;
    END LOOP;
    RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.claim_pending_invites() TO authenticated;

-- The signed-in user's open invitations, with what they need to decide.
CREATE OR REPLACE FUNCTION public.list_my_invitations()
RETURNS TABLE (workspace_id UUID, workspace TEXT, icon TEXT, color TEXT, role TEXT, inviter TEXT, members INT, invited_at TIMESTAMPTZ) AS $$
    SELECT w.id, w.name, w.icon, w.color, m.role,
           (SELECT u2.name FROM public.users u2 WHERE u2.id = w.owner_id),
           (SELECT count(*)::int FROM public.workspace_members m2 WHERE m2.workspace_id = w.id AND m2.status = 'active'),
           m.joined_at
      FROM public.workspace_members m
      JOIN public.users u ON u.id = m.user_id
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE u.auth_id = auth.uid() AND m.status = 'invited'
     ORDER BY m.joined_at DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.list_my_invitations() TO authenticated;

-- Accept → become an active member. Decline → the invitation is removed. The inviter is told either way.
CREATE OR REPLACE FUNCTION public.respond_to_invitation(p_workspace_id UUID, p_accept BOOLEAN)
RETURNS TEXT AS $$
DECLARE me public.users; w public.workspaces; v_status TEXT; v_inviter UUID;
BEGIN
    SELECT * INTO me FROM public.users WHERE auth_id = auth.uid();
    IF me.id IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
    SELECT status INTO v_status FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = me.id FOR UPDATE;
    IF v_status IS NULL THEN RETURN 'not_found'; END IF;
    IF v_status = 'active' THEN RETURN 'already_member'; END IF;
    IF v_status <> 'invited' THEN RETURN 'not_found'; END IF;
    SELECT * INTO w FROM public.workspaces WHERE id = p_workspace_id;
    v_inviter := w.owner_id;

    IF p_accept THEN
        UPDATE public.workspace_members SET status = 'active', joined_at = now()
         WHERE workspace_id = p_workspace_id AND user_id = me.id;
        IF w.type = 'personal' THEN UPDATE public.workspaces SET type = 'shared' WHERE id = w.id; END IF;
        PERFORM public.notify_user(v_inviter, 'member_joined', w,
            format('%s accepted your invitation to "%s".', coalesce(nullif(me.name, ''), 'Someone'), w.name), me.name);
        -- The invitation notification has been answered
        UPDATE public.notifications SET is_actioned = TRUE WHERE user_id = me.id AND workspace_id = w.id AND type = 'workspace_invite';
        RETURN 'accepted';
    ELSE
        DELETE FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = me.id AND status = 'invited';
        PERFORM public.notify_user(v_inviter, 'member_declined', w,
            format('%s declined your invitation to "%s".', coalesce(nullif(me.name, ''), 'Someone'), w.name), me.name);
        UPDATE public.notifications SET is_actioned = TRUE WHERE user_id = me.id AND workspace_id = w.id AND type = 'workspace_invite';
        RETURN 'declined';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.respond_to_invitation(UUID, BOOLEAN) TO authenticated;

SELECT 'v27 ok';
