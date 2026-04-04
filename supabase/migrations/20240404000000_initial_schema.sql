-- ============================================================================
-- Finance VA — Full Database Schema for Supabase (PostgreSQL)
-- Run this in the Supabase SQL Editor to create all tables.
-- ============================================================================

-- ============================================
-- USERS PROFILE (extends Supabase auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id UUID UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    avatar_url TEXT,
    country TEXT,
    referral_code TEXT UNIQUE NOT NULL DEFAULT ('FV-' || upper(substr(md5(random()::text), 1, 6))),
    referred_by UUID REFERENCES public.users(id),
    default_currency TEXT NOT NULL DEFAULT 'USD',
    language TEXT NOT NULL DEFAULT 'en',
    theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
    biometric_enabled BOOLEAN DEFAULT FALSE,
    hide_amounts BOOLEAN DEFAULT FALSE,
    store_ocr BOOLEAN DEFAULT FALSE,
    notify_daily BOOLEAN DEFAULT TRUE,
    notify_monthly BOOLEAN DEFAULT TRUE,
    notify_budget BOOLEAN DEFAULT TRUE,
    monthly_budget DECIMAL(12,2),
    backup_interval TEXT DEFAULT 'weekly' CHECK (backup_interval IN ('daily','weekly','monthly','manual')),
    connected_clouds TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- WORKSPACES
-- ============================================
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'shared')),
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'USD',
    icon TEXT DEFAULT '👤',
    color TEXT DEFAULT '#0f766e',
    cycle_start_day INT DEFAULT 1 CHECK (cycle_start_day BETWEEN 1 AND 31),
    invite_code TEXT UNIQUE DEFAULT upper(substr(md5(random()::text), 1, 8)),
    invite_link TEXT,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- WORKSPACE MEMBERS
-- ============================================
CREATE TABLE IF NOT EXISTS public.workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','removed')),
    joined_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(workspace_id, user_id)
);

-- ============================================
-- EXPENSES
-- ============================================
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.users(id),
    amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    merchant TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    last4 TEXT,
    tags TEXT[] DEFAULT '{}',
    notes TEXT DEFAULT '',
    receipt_url TEXT,
    ocr_text TEXT,
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual','ocr','import','bill')),
    purchased_at TIMESTAMPTZ NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- MONTHLY BILLS
-- ============================================
CREATE TABLE IF NOT EXISTS public.monthly_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.users(id),
    name TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    category TEXT NOT NULL,
    payment_method TEXT,
    due_day INT NOT NULL CHECK (due_day BETWEEN 1 AND 31),
    last_paid_month TEXT,
    last_notified_month TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- SAVINGS GOALS
-- ============================================
CREATE TABLE IF NOT EXISTS public.savings_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    reason TEXT DEFAULT '',
    target_amount DECIMAL(12,2) NOT NULL CHECK (target_amount > 0),
    saved_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (saved_amount >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    color TEXT DEFAULT '#0f766e',
    icon TEXT DEFAULT '🎯',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INCOMES
-- ============================================
CREATE TABLE IF NOT EXISTS public.incomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.users(id),
    name TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    type TEXT NOT NULL CHECK (type IN ('fixed','variable')),
    income_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
    workspace_name TEXT,
    message TEXT NOT NULL,
    sender_name TEXT,
    target_uid UUID,
    is_actioned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ACTIVITY LOG
-- ============================================
CREATE TABLE IF NOT EXISTS public.activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id),
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- CUSTOM CATEGORIES (per-user)
-- ============================================
CREATE TABLE IF NOT EXISTS public.custom_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    emoji TEXT DEFAULT '📦',
    color TEXT DEFAULT '#a0a0b8',
    UNIQUE(user_id, key)
);

-- ============================================
-- CUSTOM PAYMENT METHODS (per-user)
-- ============================================
CREATE TABLE IF NOT EXISTS public.custom_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    emoji TEXT DEFAULT '💳',
    UNIQUE(user_id, key)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_expenses_workspace ON public.expenses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_expenses_purchased ON public.expenses(purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_not_deleted ON public.expenses(workspace_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_bills_workspace ON public.monthly_bills(workspace_id);
CREATE INDEX IF NOT EXISTS idx_incomes_workspace ON public.incomes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_actioned);
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON public.activity_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_user ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_workspace ON public.workspace_members(workspace_id);

-- ============================================
-- ROW-LEVEL SECURITY
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_payment_methods ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own profile
CREATE POLICY "users_select_own" ON public.users FOR SELECT USING (auth_id = auth.uid());
CREATE POLICY "users_update_own" ON public.users FOR UPDATE USING (auth_id = auth.uid());
CREATE POLICY "users_insert_own" ON public.users FOR INSERT WITH CHECK (auth_id = auth.uid());

-- Workspace access: only members can see workspaces
CREATE POLICY "workspaces_select" ON public.workspaces FOR SELECT USING (
    id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active')
);
CREATE POLICY "workspaces_insert" ON public.workspaces FOR INSERT WITH CHECK (
    owner_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
CREATE POLICY "workspaces_update" ON public.workspaces FOR UPDATE USING (
    owner_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND role IN ('owner', 'admin') AND status = 'active')
);

-- Workspace members: only members can see other members
CREATE POLICY "members_select" ON public.workspace_members FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active')
);

-- Expenses: only workspace members can access expenses
CREATE POLICY "expenses_select" ON public.expenses FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active')
);
CREATE POLICY "expenses_insert" ON public.expenses FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active' AND role IN ('owner', 'admin', 'member'))
);
CREATE POLICY "expenses_update" ON public.expenses FOR UPDATE USING (
    created_by IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND role IN ('owner', 'admin') AND status = 'active')
);

-- Bills: same as expenses
CREATE POLICY "bills_select" ON public.monthly_bills FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active')
);
CREATE POLICY "bills_insert" ON public.monthly_bills FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active' AND role IN ('owner', 'admin', 'member'))
);
CREATE POLICY "bills_update" ON public.monthly_bills FOR UPDATE USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active' AND role IN ('owner', 'admin', 'member'))
);

-- Savings goals: same as expenses
CREATE POLICY "savings_select" ON public.savings_goals FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active')
);
CREATE POLICY "savings_insert" ON public.savings_goals FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active' AND role IN ('owner', 'admin', 'member'))
);
CREATE POLICY "savings_update" ON public.savings_goals FOR UPDATE USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active' AND role IN ('owner', 'admin', 'member'))
);

-- Incomes: same as expenses
CREATE POLICY "incomes_select" ON public.incomes FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active')
);
CREATE POLICY "incomes_insert" ON public.incomes FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active' AND role IN ('owner', 'admin', 'member'))
);

-- Notifications: users can only see their own
CREATE POLICY "notifications_select" ON public.notifications FOR SELECT USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- Activity log: workspace members can see activity
CREATE POLICY "activity_select" ON public.activity_log FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
    ) AND status = 'active')
);

-- Custom categories: users can only manage their own
CREATE POLICY "categories_all" ON public.custom_categories FOR ALL USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- Custom payment methods: users can only manage their own
CREATE POLICY "payment_methods_all" ON public.custom_payment_methods FOR ALL USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- ============================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bills_updated_at BEFORE UPDATE ON public.monthly_bills
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_goals_updated_at BEFORE UPDATE ON public.savings_goals
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (auth_id, name, email, phone)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.email, ''),
        NEW.phone
    );
    RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
