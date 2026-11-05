-- v18: checkpoints — every change to money data and profiles is kept, and can be restored.

CREATE TABLE IF NOT EXISTS public.change_history (
    id BIGSERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    workspace_id UUID,
    op TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
    old_row JSONB,
    new_row JSONB,
    changed_by UUID,              -- auth.users id of whoever made the change
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_history_ws_time  ON public.change_history (workspace_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_row_time ON public.change_history (table_name, row_id, changed_at DESC);
ALTER TABLE public.change_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "history_read" ON public.change_history;
CREATE POLICY "history_read" ON public.change_history FOR SELECT TO authenticated USING (
    (workspace_id IS NOT NULL AND public.check_is_workspace_member(workspace_id))
    OR (table_name = 'users' AND row_id IN (SELECT id::text FROM public.users WHERE auth_id = auth.uid()))
    OR public.is_app_admin()
);
-- No insert/update/delete policies: only the trigger (security definer) writes, and history is never edited.

CREATE OR REPLACE FUNCTION public.record_change()
RETURNS TRIGGER AS $$
DECLARE
    v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
    v_new JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
    v_row JSONB := COALESCE(v_new, v_old);
    v_ws  UUID;
    noise TEXT[] := ARRAY['updated_at', 'last_seen_at', 'last_sign_in_at'];
BEGIN
    -- Skip updates that change nothing a person would care about
    IF TG_OP = 'UPDATE' AND (v_old - noise) = (v_new - noise) THEN RETURN NEW; END IF;

    v_ws := CASE
        WHEN TG_TABLE_NAME = 'workspaces' THEN (v_row->>'id')::uuid
        WHEN TG_TABLE_NAME = 'users' THEN NULL
        ELSE NULLIF(v_row->>'workspace_id', '')::uuid
    END;

    INSERT INTO public.change_history (table_name, row_id, workspace_id, op, old_row, new_row, changed_by)
    VALUES (TG_TABLE_NAME, v_row->>'id', v_ws, TG_OP, v_old, v_new, auth.uid());
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['expenses', 'incomes', 'monthly_bills', 'savings_goals', 'workspaces', 'users'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS zz_record_change ON public.%I', t);
        EXECUTE format('CREATE TRIGGER zz_record_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.record_change()', t);
    END LOOP;
END $$;

-- Restore the version of a row from before a given change (undo an edit or bring back a deleted item).
CREATE OR REPLACE FUNCTION public.restore_checkpoint(p_history_id BIGINT)
RETURNS TEXT AS $$
DECLARE
    h public.change_history;
    v_snapshot JSONB;
    v_cols TEXT;
    v_set TEXT;
    v_role TEXT;
    profile_cols TEXT[] := ARRAY['name', 'default_currency', 'language', 'theme', 'hide_amounts', 'monthly_budget', 'backup_interval', 'phone'];
BEGIN
    SELECT * INTO h FROM public.change_history WHERE id = p_history_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Checkpoint not found'; END IF;
    IF h.table_name NOT IN ('expenses', 'incomes', 'monthly_bills', 'savings_goals', 'workspaces', 'users') THEN
        RAISE EXCEPTION 'This change can''t be restored';
    END IF;

    -- Insert: going back means removing the row that was added
    IF h.op = 'INSERT' THEN
        IF h.table_name IN ('expenses', 'incomes') THEN
            v_snapshot := h.new_row || jsonb_build_object('is_deleted', true);
        ELSE
            RAISE EXCEPTION 'Delete it from its page instead';
        END IF;
    ELSE
        v_snapshot := h.old_row;
    END IF;

    IF h.table_name = 'users' THEN
        IF NOT EXISTS (SELECT 1 FROM public.users WHERE id::text = h.row_id AND auth_id = auth.uid()) THEN
            RAISE EXCEPTION 'Not allowed';
        END IF;
        SELECT string_agg(format('%I = (jsonb_populate_record(NULL::public.users, $1)).%I', column_name, column_name), ', ')
          INTO v_set
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = ANY(profile_cols) AND v_snapshot ? column_name;
        IF v_set IS NULL THEN RETURN 'nothing to restore'; END IF;
        EXECUTE format('UPDATE public.users SET %s WHERE id::text = $2', v_set) USING v_snapshot, h.row_id;
        RETURN 'restored';
    END IF;

    SELECT m.role INTO v_role FROM public.workspace_members m JOIN public.users u ON u.id = m.user_id
     WHERE m.workspace_id = h.workspace_id AND u.auth_id = auth.uid() AND m.status = 'active';
    IF (v_role IS NULL OR v_role = 'viewer') AND NOT public.is_app_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
    IF h.table_name = 'workspaces' AND v_role NOT IN ('owner', 'admin') AND NOT public.is_app_admin() THEN RAISE EXCEPTION 'Only workspace owners and admins can restore workspace settings'; END IF;

    SELECT string_agg(quote_ident(column_name), ', '),
           string_agg(format('%I = EXCLUDED.%I', column_name, column_name), ', ') FILTER (WHERE column_name <> 'id')
      INTO v_cols, v_set
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = h.table_name AND v_snapshot ? column_name;

    EXECUTE format(
        'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1) ON CONFLICT (id) DO UPDATE SET %3$s',
        h.table_name, v_cols, v_set
    ) USING v_snapshot;
    RETURN 'restored';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.restore_checkpoint(BIGINT) TO authenticated;

select 'v18 ok' as result;
