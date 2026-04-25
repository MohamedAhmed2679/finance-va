-- ============================================================================
-- Migration: Fix RLS Recursion and Add Missing Policies
-- Date: 2024-04-26
-- Description:
-- 1. Creates a SECURITY DEFINER function to bypass RLS when checking membership.
-- 2. Drops recursive workspace_members policies and replaces them.
-- 3. Adds missing members_insert policy.
-- 4. Optimizes all other table policies using the new function.
-- ============================================================================

-- 1. Create a helper function to safely check workspace membership without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.check_is_workspace_member(check_workspace_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Get the internal users.id for the current authenticated user
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check if they are an active member (Bypasses RLS because SECURITY DEFINER)
    RETURN EXISTS (
        SELECT 1 FROM public.workspace_members 
        WHERE workspace_id = check_workspace_id 
        AND user_id = v_user_id
        AND status = 'active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create a helper function to safely check workspace admin/owner status
CREATE OR REPLACE FUNCTION public.check_is_workspace_admin(check_workspace_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.workspace_members 
        WHERE workspace_id = check_workspace_id 
        AND user_id = v_user_id
        AND role IN ('owner', 'admin')
        AND status = 'active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- WORKSPACE MEMBERS POLICIES
-- ============================================================================

-- Drop the old recursive policy
DROP POLICY IF EXISTS "members_select" ON public.workspace_members;

-- Users can see members of workspaces they belong to
CREATE POLICY "members_select" ON public.workspace_members 
FOR SELECT USING (
    public.check_is_workspace_member(workspace_id)
);

-- Missing policy: Allow users to insert themselves into a workspace (during creation) 
-- or allow admins to invite users.
DROP POLICY IF EXISTS "members_insert" ON public.workspace_members;
CREATE POLICY "members_insert" ON public.workspace_members 
FOR INSERT WITH CHECK (
    -- User is adding themselves OR user is an admin of the workspace
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR public.check_is_workspace_admin(workspace_id)
);

-- Allow admins to update member roles/status
DROP POLICY IF EXISTS "members_update" ON public.workspace_members;
CREATE POLICY "members_update" ON public.workspace_members 
FOR UPDATE USING (
    public.check_is_workspace_admin(workspace_id)
);

-- ============================================================================
-- WORKSPACES POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "workspaces_select" ON public.workspaces;
CREATE POLICY "workspaces_select" ON public.workspaces 
FOR SELECT USING (
    public.check_is_workspace_member(id)
);

DROP POLICY IF EXISTS "workspaces_update" ON public.workspaces;
CREATE POLICY "workspaces_update" ON public.workspaces 
FOR UPDATE USING (
    owner_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR public.check_is_workspace_admin(id)
);

-- ============================================================================
-- EXPENSES POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "expenses_select" ON public.expenses;
CREATE POLICY "expenses_select" ON public.expenses 
FOR SELECT USING (
    public.check_is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "expenses_insert" ON public.expenses;
CREATE POLICY "expenses_insert" ON public.expenses 
FOR INSERT WITH CHECK (
    public.check_is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "expenses_update" ON public.expenses;
CREATE POLICY "expenses_update" ON public.expenses 
FOR UPDATE USING (
    created_by IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR public.check_is_workspace_admin(workspace_id)
);

-- ============================================================================
-- MONTHLY BILLS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "bills_select" ON public.monthly_bills;
CREATE POLICY "bills_select" ON public.monthly_bills 
FOR SELECT USING (
    public.check_is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "bills_insert" ON public.monthly_bills;
CREATE POLICY "bills_insert" ON public.monthly_bills 
FOR INSERT WITH CHECK (
    public.check_is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "bills_update" ON public.monthly_bills;
CREATE POLICY "bills_update" ON public.monthly_bills 
FOR UPDATE USING (
    public.check_is_workspace_member(workspace_id)
);

-- ============================================================================
-- SAVINGS GOALS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "savings_select" ON public.savings_goals;
CREATE POLICY "savings_select" ON public.savings_goals 
FOR SELECT USING (
    public.check_is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "savings_insert" ON public.savings_goals;
CREATE POLICY "savings_insert" ON public.savings_goals 
FOR INSERT WITH CHECK (
    public.check_is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "savings_update" ON public.savings_goals;
CREATE POLICY "savings_update" ON public.savings_goals 
FOR UPDATE USING (
    public.check_is_workspace_member(workspace_id)
);

-- ============================================================================
-- INCOMES POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "incomes_select" ON public.incomes;
CREATE POLICY "incomes_select" ON public.incomes 
FOR SELECT USING (
    public.check_is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "incomes_insert" ON public.incomes;
CREATE POLICY "incomes_insert" ON public.incomes 
FOR INSERT WITH CHECK (
    public.check_is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "incomes_update" ON public.incomes;
CREATE POLICY "incomes_update" ON public.incomes 
FOR UPDATE USING (
    public.check_is_workspace_member(workspace_id)
);

-- ============================================================================
-- ACTIVITY LOG POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "activity_select" ON public.activity_log;
CREATE POLICY "activity_select" ON public.activity_log 
FOR SELECT USING (
    public.check_is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "activity_insert" ON public.activity_log;
CREATE POLICY "activity_insert" ON public.activity_log 
FOR INSERT WITH CHECK (
    public.check_is_workspace_member(workspace_id)
);
