-- Finance VA Migration V14: Soft-delete standardization + phone auth + RLS hardening
-- Date: 2026-04-19

-- 1. Add is_deleted columns to all entity tables for consistency
ALTER TABLE public.incomes ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE public.monthly_bills ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- 2. Partial indexes for faster active-record queries
CREATE INDEX IF NOT EXISTS idx_incomes_active
    ON public.incomes(workspace_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_bills_active
    ON public.monthly_bills(workspace_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_goals_active
    ON public.savings_goals(workspace_id) WHERE is_deleted = FALSE;

-- 3. Phone auth support: allow phone-only users (email might be null)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
    ON public.users(email) WHERE email IS NOT NULL AND email != '';

-- 4. Update handle_new_user trigger to support phone-only users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (auth_id, name, email, phone)
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'name',
            CASE
                WHEN NEW.email IS NOT NULL AND NEW.email != ''
                    THEN split_part(NEW.email, '@', 1)
                WHEN NEW.phone IS NOT NULL AND NEW.phone != ''
                    THEN 'Phone User'
                ELSE 'User'
            END
        ),
        COALESCE(NEW.email, NEW.phone, ''),
        NEW.phone
    )
    ON CONFLICT (auth_id) DO NOTHING;
    RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- 5. RLS policies for delete operations (missing from initial schema)
DO $$
BEGIN
    -- Bills delete policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'bills_delete' AND tablename = 'monthly_bills') THEN
        CREATE POLICY "bills_delete" ON public.monthly_bills
            FOR DELETE USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.workspace_members
                    WHERE user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
                    AND role IN ('owner', 'admin', 'member')
                    AND status = 'active'
                )
            );
    END IF;

    -- Savings goals delete policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'savings_delete' AND tablename = 'savings_goals') THEN
        CREATE POLICY "savings_delete" ON public.savings_goals
            FOR DELETE USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.workspace_members
                    WHERE user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
                    AND role IN ('owner', 'admin', 'member')
                    AND status = 'active'
                )
            );
    END IF;

    -- Incomes delete policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'incomes_delete' AND tablename = 'incomes') THEN
        CREATE POLICY "incomes_delete" ON public.incomes
            FOR DELETE USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.workspace_members
                    WHERE user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
                    AND role IN ('owner', 'admin', 'member')
                    AND status = 'active'
                )
            );
    END IF;

    -- Incomes update policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'incomes_update' AND tablename = 'incomes') THEN
        CREATE POLICY "incomes_update" ON public.incomes
            FOR UPDATE USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.workspace_members
                    WHERE user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
                    AND role IN ('owner', 'admin', 'member')
                    AND status = 'active'
                )
            );
    END IF;

    -- Savings goals update policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'savings_update_extended' AND tablename = 'savings_goals') THEN
        CREATE POLICY "savings_update_extended" ON public.savings_goals
            FOR UPDATE USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.workspace_members
                    WHERE user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
                    AND role IN ('owner', 'admin', 'member')
                    AND status = 'active'
                )
            );
    END IF;

    -- Notifications insert policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notifications_insert' AND tablename = 'notifications') THEN
        CREATE POLICY "notifications_insert" ON public.notifications
            FOR INSERT WITH CHECK (
                user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
            );
    END IF;

    -- Activity log insert policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'activity_insert' AND tablename = 'activity_log') THEN
        CREATE POLICY "activity_insert" ON public.activity_log
            FOR INSERT WITH CHECK (
                user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
            );
    END IF;

    -- Workspace members insert policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'members_insert' AND tablename = 'workspace_members') THEN
        CREATE POLICY "members_insert" ON public.workspace_members
            FOR INSERT WITH CHECK (
                workspace_id IN (
                    SELECT id FROM public.workspaces
                    WHERE owner_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
                )
                OR
                workspace_id IN (
                    SELECT workspace_id FROM public.workspace_members
                    WHERE user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
                    AND role IN ('owner', 'admin')
                    AND status = 'active'
                )
            );
    END IF;
END $$;
