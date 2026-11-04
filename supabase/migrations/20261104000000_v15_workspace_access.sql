-- ============================================================================
-- Finance VA V15 — workspace access hardening
-- 1. Owners can always read their own workspaces (even if the membership row is missing).
-- 2. Owners can delete their workspaces (the app now deletes in the cloud too).
-- 3. Every new workspace automatically gets its owner as an active member
--    (removes the race between creating a workspace and its membership row).
-- 4. Backfill missing owner memberships for existing workspaces.
-- Safe to run more than once.
-- ============================================================================

DROP POLICY IF EXISTS "workspaces_select" ON public.workspaces;
CREATE POLICY "workspaces_select" ON public.workspaces
FOR SELECT USING (
    owner_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    OR public.check_is_workspace_member(id)
);

DROP POLICY IF EXISTS "workspaces_delete" ON public.workspaces;
CREATE POLICY "workspaces_delete" ON public.workspaces
FOR DELETE USING (
    owner_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.add_owner_membership()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    VALUES (NEW.id, NEW.owner_id, 'owner', 'active')
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner', status = 'active';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_workspace_created ON public.workspaces;
CREATE TRIGGER on_workspace_created
    AFTER INSERT ON public.workspaces
    FOR EACH ROW EXECUTE FUNCTION public.add_owner_membership();

INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
SELECT w.id, w.owner_id, 'owner', 'active'
FROM public.workspaces w
WHERE NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = w.id AND m.user_id = w.owner_id
)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Membership helpers are SECURITY DEFINER; pin their search_path as well.
ALTER FUNCTION public.check_is_workspace_member(UUID) SET search_path = public;
ALTER FUNCTION public.check_is_workspace_admin(UUID) SET search_path = public;
