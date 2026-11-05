-- ============================================================================
-- Finance VA V14b — policy repair
-- Production was missing check_is_workspace_admin() and several UPDATE/DELETE
-- policies (earlier migrations used CREATE POLICY IF NOT EXISTS, which Postgres
-- does not support, so they never applied). This recreates every workspace-data
-- policy idempotently. Safe to run more than once.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_is_workspace_member(w_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members m
        JOIN public.users u ON u.id = m.user_id
        WHERE m.workspace_id = w_id AND u.auth_id = auth.uid() AND m.status = 'active'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.check_is_workspace_admin(w_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members m
        JOIN public.users u ON u.id = m.user_id
        WHERE m.workspace_id = w_id AND u.auth_id = auth.uid()
          AND m.status = 'active' AND m.role IN ('owner', 'admin')
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS UUID AS $$
    SELECT id FROM public.users WHERE auth_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Workspaces (select/delete are finalised in V15)
DROP POLICY IF EXISTS "workspaces_insert" ON public.workspaces;
CREATE POLICY "workspaces_insert" ON public.workspaces FOR INSERT WITH CHECK (owner_id = public.current_user_id());
DROP POLICY IF EXISTS "workspaces_update" ON public.workspaces;
CREATE POLICY "workspaces_update" ON public.workspaces FOR UPDATE USING (
    owner_id = public.current_user_id() OR public.check_is_workspace_admin(id)
);

-- Members
DROP POLICY IF EXISTS "members_select" ON public.workspace_members;
CREATE POLICY "members_select" ON public.workspace_members FOR SELECT USING (
    user_id = public.current_user_id() OR public.check_is_workspace_member(workspace_id)
);
DROP POLICY IF EXISTS "members_insert" ON public.workspace_members;
CREATE POLICY "members_insert" ON public.workspace_members FOR INSERT WITH CHECK (
    public.check_is_workspace_admin(workspace_id)
    OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = public.current_user_id())
);
DROP POLICY IF EXISTS "members_update" ON public.workspace_members;
CREATE POLICY "members_update" ON public.workspace_members FOR UPDATE USING (
    public.check_is_workspace_admin(workspace_id)
    OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = public.current_user_id())
);
DROP POLICY IF EXISTS "members_delete" ON public.workspace_members;
CREATE POLICY "members_delete" ON public.workspace_members FOR DELETE USING (
    user_id = public.current_user_id() OR public.check_is_workspace_admin(workspace_id)
);

-- Workspace data tables: members read/write, viewers read only
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['expenses', 'incomes', 'monthly_bills', 'savings_goals'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS "%1$s_sel" ON public.%1$I', t);
        EXECUTE format('DROP POLICY IF EXISTS "%1$s_ins" ON public.%1$I', t);
        EXECUTE format('DROP POLICY IF EXISTS "%1$s_upd" ON public.%1$I', t);
        EXECUTE format('DROP POLICY IF EXISTS "%1$s_del" ON public.%1$I', t);
        EXECUTE format('CREATE POLICY "%1$s_sel" ON public.%1$I FOR SELECT USING (public.check_is_workspace_member(workspace_id))', t);
        EXECUTE format($p$CREATE POLICY "%1$s_ins" ON public.%1$I FOR INSERT WITH CHECK (
            public.check_is_workspace_member(workspace_id)
            AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = %1$I.workspace_id AND m.user_id = public.current_user_id() AND m.role = 'viewer'))$p$, t);
        EXECUTE format($p$CREATE POLICY "%1$s_upd" ON public.%1$I FOR UPDATE USING (
            public.check_is_workspace_member(workspace_id)
            AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = %1$I.workspace_id AND m.user_id = public.current_user_id() AND m.role = 'viewer'))$p$, t);
        EXECUTE format('CREATE POLICY "%1$s_del" ON public.%1$I FOR DELETE USING (public.check_is_workspace_admin(workspace_id))', t);
    END LOOP;
END $$;

-- Remove the older per-table policy names now covered above
DROP POLICY IF EXISTS "expenses_select" ON public.expenses;
DROP POLICY IF EXISTS "expenses_insert" ON public.expenses;
DROP POLICY IF EXISTS "expenses_update" ON public.expenses;
DROP POLICY IF EXISTS "incomes_select" ON public.incomes;
DROP POLICY IF EXISTS "incomes_insert" ON public.incomes;
DROP POLICY IF EXISTS "incomes_update" ON public.incomes;
DROP POLICY IF EXISTS "incomes_delete" ON public.incomes;
DROP POLICY IF EXISTS "bills_select" ON public.monthly_bills;
DROP POLICY IF EXISTS "bills_insert" ON public.monthly_bills;
DROP POLICY IF EXISTS "bills_update" ON public.monthly_bills;
DROP POLICY IF EXISTS "bills_delete" ON public.monthly_bills;
DROP POLICY IF EXISTS "savings_select" ON public.savings_goals;
DROP POLICY IF EXISTS "savings_insert" ON public.savings_goals;
DROP POLICY IF EXISTS "savings_update" ON public.savings_goals;
DROP POLICY IF EXISTS "savings_update_extended" ON public.savings_goals;
DROP POLICY IF EXISTS "savings_delete" ON public.savings_goals;

-- Notifications: own rows; members may notify each other within a shared workspace
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications FOR SELECT USING (user_id = public.current_user_id());
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE USING (user_id = public.current_user_id());
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT WITH CHECK (
    user_id = public.current_user_id()
    OR (workspace_id IS NOT NULL AND public.check_is_workspace_member(workspace_id))
);

-- Activity log
DROP POLICY IF EXISTS "activity_select" ON public.activity_log;
CREATE POLICY "activity_select" ON public.activity_log FOR SELECT USING (public.check_is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "activity_insert" ON public.activity_log;
CREATE POLICY "activity_insert" ON public.activity_log FOR INSERT WITH CHECK (
    user_id = public.current_user_id() AND public.check_is_workspace_member(workspace_id)
);
