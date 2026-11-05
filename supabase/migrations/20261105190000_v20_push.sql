-- v20: push notifications — device subscriptions, notifications for every membership change,
--      and daily payment / payday reminders.

-- ---------------------------------------------------------------------------
-- 1. Devices that receive push (Web Push subscriptions; native tokens later)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT,
    auth TEXT,
    platform TEXT NOT NULL DEFAULT 'web',      -- web | android | ios | desktop
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_user ON public.push_subscriptions(user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_own" ON public.push_subscriptions;
CREATE POLICY "push_own" ON public.push_subscriptions FOR ALL TO authenticated
    USING (user_id = public.current_user_id())
    WITH CHECK (user_id = public.current_user_id());

-- Each notification is pushed once; reminders are created once per occasion
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON public.notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_unpushed ON public.notifications(created_at) WHERE pushed_at IS NULL;
-- Old notifications are not pushed retroactively
UPDATE public.notifications SET pushed_at = COALESCE(created_at, now()) WHERE pushed_at IS NULL AND created_at < now() - interval '10 minutes';

-- ---------------------------------------------------------------------------
-- 2. Removing someone or changing their role now tells them
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_workspace_member(p_workspace_id UUID, p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_self public.users;
    v_target public.users;
    v_ws public.workspaces;
BEGIN
    SELECT * INTO v_self FROM public.users WHERE auth_id = auth.uid();
    IF p_user_id <> v_self.id AND NOT public.can_manage_workspace(p_workspace_id) THEN
        RAISE EXCEPTION 'Only the workspace owner, its admins or an app admin can remove members';
    END IF;
    IF EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND role = 'owner') THEN
        RAISE EXCEPTION 'The owner cannot be removed';
    END IF;
    SELECT * INTO v_ws FROM public.workspaces WHERE id = p_workspace_id;
    SELECT * INTO v_target FROM public.users WHERE id = p_user_id;
    DELETE FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

    IF p_user_id = v_self.id THEN
        INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, sender_name)
        VALUES (v_ws.owner_id, 'member_left', v_ws.id, v_ws.name, format('%s left "%s".', coalesce(v_target.name, 'Someone'), v_ws.name), v_target.name);
    ELSE
        INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, sender_name)
        VALUES (p_user_id, 'member_removed', v_ws.id, v_ws.name, format('%s removed you from "%s".', coalesce(v_self.name, 'An admin'), v_ws.name), v_self.name);
    END IF;
    RETURN 'removed';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_workspace_member_role(p_workspace_id UUID, p_user_id UUID, p_role TEXT)
RETURNS TEXT AS $$
DECLARE v_ws public.workspaces; v_actor TEXT; v_old TEXT;
BEGIN
    IF NOT public.can_manage_workspace(p_workspace_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    IF p_role NOT IN ('admin', 'member', 'viewer') THEN RAISE EXCEPTION 'Invalid role'; END IF;
    SELECT role INTO v_old FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    UPDATE public.workspace_members SET role = p_role
        WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND role <> 'owner';
    IF FOUND AND v_old IS DISTINCT FROM p_role THEN
        SELECT * INTO v_ws FROM public.workspaces WHERE id = p_workspace_id;
        SELECT name INTO v_actor FROM public.users WHERE auth_id = auth.uid();
        INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, sender_name)
        VALUES (p_user_id, 'role_change', v_ws.id, v_ws.name, format('%s made you %s %s in "%s".', coalesce(v_actor, 'An admin'),
                CASE WHEN p_role = 'admin' THEN 'an' ELSE 'a' END, p_role, v_ws.name), v_actor);
    END IF;
    RETURN 'updated';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.set_workspace_member_role(UUID, UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Daily reminders (run by the server once a day; idempotent per day)
--    - bills due today or tomorrow that aren't marked paid this month
--    - payday: the workspace's cycle start day, with the expected fixed income
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_due_reminders(p_today DATE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date)
RETURNS INT AS $$
DECLARE
    n INT := 0;
    added INT;
    v_month TEXT := to_char(p_today, 'YYYY-MM');
    v_last_day INT := extract(day FROM (date_trunc('month', p_today) + interval '1 month - 1 day'))::int;
BEGIN
    -- Bills: due day (clamped to the month's last day) is today or tomorrow
    INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, link, dedupe_key)
    SELECT m.user_id, 'bill_due', w.id, w.name,
           format('%s %s: %s %s%s', b.name,
                  CASE WHEN least(b.due_day, v_last_day) = extract(day FROM p_today)::int THEN 'is due today' ELSE 'is due tomorrow' END,
                  b.currency, to_char(b.amount, 'FM999G999G990D00'),
                  CASE WHEN w.type = 'shared' THEN format(' (%s)', w.name) ELSE '' END),
           '/bills',
           format('bill:%s:%s:%s', b.id, m.user_id, p_today)
      FROM public.monthly_bills b
      JOIN public.workspaces w ON w.id = b.workspace_id AND NOT coalesce(w.is_archived, false)
      JOIN public.workspace_members m ON m.workspace_id = w.id AND m.status = 'active' AND m.role <> 'viewer'
     WHERE coalesce(b.last_paid_month, '') <> v_month
       AND least(b.due_day, v_last_day) - extract(day FROM p_today)::int BETWEEN 0 AND 1
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT; n := n + added;

    -- Payday / new cycle
    INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, link, dedupe_key)
    SELECT m.user_id, 'payday', w.id, w.name,
           CASE WHEN inc.total IS NOT NULL
                THEN format('Payday for "%s": %s %s expected. A new budget cycle starts today.', w.name, w.currency, to_char(inc.total, 'FM999G999G990D00'))
                ELSE format('A new budget cycle starts today in "%s". Add this month''s income to plan ahead.', w.name) END,
           '/earnings',
           format('payday:%s:%s:%s', w.id, m.user_id, p_today)
      FROM public.workspaces w
      JOIN public.workspace_members m ON m.workspace_id = w.id AND m.status = 'active' AND m.role <> 'viewer'
      LEFT JOIN LATERAL (
          SELECT sum(coalesce(i.base_amount, i.amount)) AS total FROM public.incomes i
           WHERE i.workspace_id = w.id AND i.type = 'fixed' AND NOT coalesce(i.is_deleted, false)
      ) inc ON TRUE
     WHERE NOT coalesce(w.is_archived, false)
       AND least(coalesce(w.cycle_start_day, 1), v_last_day) = extract(day FROM p_today)::int
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT; n := n + added;
    RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.create_due_reminders(DATE) FROM PUBLIC, anon, authenticated;

-- Atomically take notifications that still need a push (server only)
CREATE OR REPLACE FUNCTION public.claim_unpushed_notifications(p_limit INT DEFAULT 200)
RETURNS SETOF public.notifications AS $$
    UPDATE public.notifications n SET pushed_at = now()
     WHERE n.id IN (SELECT id FROM public.notifications WHERE pushed_at IS NULL AND created_at > now() - interval '2 days'
                    ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    RETURNING n.*;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.claim_unpushed_notifications(INT) FROM PUBLIC, anon, authenticated;

select 'v20 ok' as result;
