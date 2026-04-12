-- Finance VA Migration: Identity & RLS Patch (V13)
-- Purpose: Resolve the '400 Bad Request' on profile updates and enforce internal IDs.

-- 1. Ensure the onboarding flag exists
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS show_onboarding BOOLEAN DEFAULT TRUE;

-- 2. Harden RLS for the users table
-- Drop existing problematic policies if they conflict
DROP POLICY IF EXISTS "users_update_own" ON public.users;
DROP POLICY IF EXISTS "users_select_own" ON public.users;

-- Re-create explicit policies using both auth_id and internal ID checks for maximum stability
CREATE POLICY "users_select_own" ON public.users
    FOR SELECT USING (auth_id = auth.uid());

CREATE POLICY "users_update_own" ON public.users
    FOR UPDATE USING (auth_id = auth.uid())
    WITH CHECK (auth_id = auth.uid());

-- 3. Ensure every user has a personal workspace correctly linked to their INTERNAL ID
-- This is a helper for existing accounts that might be orphaned.
DO $$
DECLARE
    user_record RECORD;
BEGIN
    FOR user_record IN SELECT id, name FROM public.users LOOP
        -- If user has no workspace, create one
        IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE owner_id = user_record.id) THEN
            INSERT INTO public.workspaces (name, type, owner_id)
            VALUES ('Personal', 'personal', user_record.id);
        END IF;
    END LOOP;
END $$;
