-- v23: reminders you choose in Settings → Notifications actually arrive, and old Smart Cart photos are cleaned up.
--   * Daily reminder (8 pm Cairo) when nothing was logged today
--   * Monthly summary on the 1st (last month's spending per workspace)
--   * Budget alerts at 80% and 100% of the monthly budget, the moment an expense crosses them
--   * Smart Cart: drafts untouched for 30 days are discarded; photos no longer used by any cart are deleted
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Preferences. The app never saved these, so everyone saw them off: keep them off until chosen.
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ALTER COLUMN notify_daily SET DEFAULT FALSE;
ALTER TABLE public.users ALTER COLUMN notify_monthly SET DEFAULT FALSE;
ALTER TABLE public.users ALTER COLUMN notify_budget SET DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_prefs_saved_at TIMESTAMPTZ;
UPDATE public.users SET notify_daily = FALSE, notify_monthly = FALSE, notify_budget = FALSE
 WHERE notify_prefs_saved_at IS NULL AND (notify_daily OR notify_monthly OR notify_budget);

CREATE OR REPLACE FUNCTION public.stamp_notify_prefs()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.notify_daily IS DISTINCT FROM OLD.notify_daily OR NEW.notify_monthly IS DISTINCT FROM OLD.notify_monthly
       OR NEW.notify_budget IS DISTINCT FROM OLD.notify_budget THEN
        NEW.notify_prefs_saved_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS users_stamp_notify_prefs ON public.users;
CREATE TRIGGER users_stamp_notify_prefs BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.stamp_notify_prefs();

-- ---------------------------------------------------------------------------
-- 2. Scheduled reminders (server only). p_slot: 'morning' (monthly summary) | 'evening' (daily reminder)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_preference_reminders(p_slot TEXT, p_now TIMESTAMPTZ DEFAULT now())
RETURNS INT AS $$
DECLARE
    n INT := 0;
    added INT;
    v_today DATE := (p_now AT TIME ZONE 'Africa/Cairo')::date;
    v_prev_start DATE := (date_trunc('month', v_today) - interval '1 month')::date;
    v_prev_end DATE := date_trunc('month', v_today)::date;
BEGIN
    IF p_slot = 'evening' THEN
        INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
        SELECT u.id, 'daily_log', 'You haven''t logged any expenses today. Add them now so your budget stays accurate.', '/expenses',
               format('daily:%s:%s', u.id, v_today)
          FROM public.users u
         WHERE u.notify_daily AND NOT coalesce(u.is_banned, false)
           AND NOT EXISTS (
               SELECT 1 FROM public.expenses e
                WHERE e.created_by = u.id AND NOT coalesce(e.is_deleted, false)
                  AND (e.created_at AT TIME ZONE 'Africa/Cairo')::date = v_today)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS added = ROW_COUNT; n := n + added;
    END IF;

    IF p_slot = 'morning' AND extract(day FROM v_today) = 1 THEN
        INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, link, dedupe_key)
        SELECT m.user_id, 'monthly_summary', w.id, w.name,
               format('%s in "%s": %s %s spent across %s %s.', trim(to_char(v_prev_start, 'Month')), w.name, w.currency,
                      to_char(t.total, 'FM999G999G990D00'), t.cnt, CASE WHEN t.cnt = 1 THEN 'expense' ELSE 'expenses' END),
               '/insights',
               format('monthly:%s:%s:%s', w.id, m.user_id, to_char(v_prev_start, 'YYYY-MM'))
          FROM public.workspaces w
          JOIN public.workspace_members m ON m.workspace_id = w.id AND m.status = 'active'
          JOIN public.users u ON u.id = m.user_id AND u.notify_monthly AND NOT coalesce(u.is_banned, false)
          JOIN LATERAL (
              SELECT sum(coalesce(e.base_amount, e.amount)) AS total, count(*) AS cnt FROM public.expenses e
               WHERE e.workspace_id = w.id AND NOT coalesce(e.is_deleted, false)
                 AND (e.purchased_at AT TIME ZONE 'Africa/Cairo')::date >= v_prev_start
                 AND (e.purchased_at AT TIME ZONE 'Africa/Cairo')::date < v_prev_end
          ) t ON t.cnt > 0
         WHERE NOT coalesce(w.is_archived, false)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS added = ROW_COUNT; n := n + added;
    END IF;
    RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.create_preference_reminders(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Budget alerts: personal workspace spending this month vs the owner's monthly budget
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.budget_alert_check()
RETURNS TRIGGER AS $$
DECLARE
    w public.workspaces;
    u public.users;
    v_month_start DATE := date_trunc('month', (now() AT TIME ZONE 'Africa/Cairo'))::date;
    v_spent NUMERIC;
    v_pct NUMERIC;
    v_level INT;
BEGIN
    IF coalesce(NEW.is_deleted, false) OR (NEW.purchased_at AT TIME ZONE 'Africa/Cairo')::date < v_month_start THEN RETURN NULL; END IF;
    SELECT * INTO w FROM public.workspaces WHERE id = NEW.workspace_id;
    IF w.type IS DISTINCT FROM 'personal' THEN RETURN NULL; END IF;
    SELECT * INTO u FROM public.users WHERE id = w.owner_id;
    IF NOT coalesce(u.notify_budget, false) OR coalesce(u.monthly_budget, 0) <= 0 THEN RETURN NULL; END IF;
    SELECT coalesce(sum(coalesce(e.base_amount, e.amount)), 0) INTO v_spent FROM public.expenses e
     WHERE e.workspace_id = w.id AND NOT coalesce(e.is_deleted, false)
       AND (e.purchased_at AT TIME ZONE 'Africa/Cairo')::date >= v_month_start;
    v_pct := v_spent / u.monthly_budget * 100;
    v_level := CASE WHEN v_pct >= 100 THEN 100 WHEN v_pct >= 80 THEN 80 ELSE 0 END;
    IF v_level = 0 THEN RETURN NULL; END IF;
    INSERT INTO public.notifications (user_id, type, workspace_id, workspace_name, message, link, dedupe_key)
    VALUES (u.id, 'budget_alert', w.id, w.name,
            CASE WHEN v_level = 100
                 THEN format('You''ve gone over your monthly budget: %s %s spent of %s %s.', w.currency, to_char(v_spent, 'FM999G999G990D00'), w.currency, to_char(u.monthly_budget, 'FM999G999G990D00'))
                 ELSE format('You''ve used %s%% of your monthly budget: %s %s spent of %s %s.', floor(v_pct), w.currency, to_char(v_spent, 'FM999G999G990D00'), w.currency, to_char(u.monthly_budget, 'FM999G999G990D00')) END,
            '/expenses', format('budget:%s:%s:%s:%s', w.id, u.id, to_char(v_month_start, 'YYYY-MM'), v_level))
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS expenses_budget_alert ON public.expenses;
CREATE TRIGGER expenses_budget_alert AFTER INSERT OR UPDATE OF amount, base_amount, is_deleted, purchased_at ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.budget_alert_check();

-- ---------------------------------------------------------------------------
-- 4. Smart Cart cleanup (server only). Returns the storage paths to delete.
--    * drafts nobody touched for p_draft_days are discarded
--    * photos older than p_orphan_hours that no open or confirmed cart uses are returned for deletion
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.smart_cart_cleanup(p_draft_days INT DEFAULT 30, p_orphan_hours INT DEFAULT 24)
RETURNS TEXT[] AS $$
DECLARE v_paths TEXT[];
BEGIN
    UPDATE public.smart_carts SET status = 'discarded'
     WHERE status IN ('draft', 'calculated') AND updated_at < now() - make_interval(days => p_draft_days)
       AND NOT EXISTS (SELECT 1 FROM public.smart_cart_items i WHERE i.cart_id = smart_carts.id AND i.updated_at >= now() - make_interval(days => p_draft_days));

    SELECT coalesce(array_agg(o.name), '{}') INTO v_paths
      FROM storage.objects o
     WHERE o.bucket_id = 'smart-cart' AND o.created_at < now() - make_interval(hours => p_orphan_hours)
       AND NOT EXISTS (
           SELECT 1 FROM public.smart_cart_items i JOIN public.smart_carts c ON c.id = i.cart_id
            WHERE c.status <> 'discarded' AND o.name = ANY (i.image_paths));
    RETURN v_paths;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.smart_cart_cleanup(INT, INT) FROM PUBLIC, anon, authenticated;

SELECT 'v23 ok';
