-- v17: multi-currency entries + chat attachments and gallery

-- ---------------------------------------------------------------------------
-- 1. Multi-currency: keep what was entered (amount/currency) and the value in
--    the workspace currency at entry time.
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS base_amount NUMERIC;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS base_currency TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS fx_rate NUMERIC;
ALTER TABLE public.incomes  ADD COLUMN IF NOT EXISTS base_amount NUMERIC;
ALTER TABLE public.incomes  ADD COLUMN IF NOT EXISTS base_currency TEXT;
ALTER TABLE public.incomes  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC;

-- ---------------------------------------------------------------------------
-- 2. Attachments on chat and support messages
--    attachments = [{ path, name, type, size, width?, height? }]
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_messages    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- A message may be attachments only
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_body_check;
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_body_or_files;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_body_or_files CHECK (
    char_length(body) <= 4000 AND (char_length(body) >= 1 OR jsonb_array_length(attachments) > 0)
);
ALTER TABLE public.support_messages DROP CONSTRAINT IF EXISTS support_messages_body_check;
ALTER TABLE public.support_messages DROP CONSTRAINT IF EXISTS support_body_or_files;
ALTER TABLE public.support_messages ADD CONSTRAINT support_body_or_files CHECK (
    char_length(body) <= 4000 AND (char_length(body) >= 1 OR jsonb_array_length(attachments) > 0)
);

CREATE INDEX IF NOT EXISTS idx_chat_has_files ON public.chat_messages(workspace_id, created_at DESC)
    WHERE jsonb_array_length(attachments) > 0;

-- ---------------------------------------------------------------------------
-- 3. Private storage bucket. Paths:
--      <workspace_id>/<uuid>-<file>          workspace chat
--      support/<users.id>/<uuid>-<file>      support conversation
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', FALSE, 52428800)
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = 52428800;

-- Text comparison so a non-uuid folder never raises a cast error
CREATE OR REPLACE FUNCTION public.can_access_chat_file(object_name TEXT)
RETURNS BOOLEAN AS $$
    SELECT CASE
        WHEN split_part(object_name, '/', 1) = 'support' THEN
            EXISTS (SELECT 1 FROM public.users u
                    WHERE u.auth_id = auth.uid() AND u.id::text = split_part(object_name, '/', 2))
        ELSE
            EXISTS (SELECT 1 FROM public.workspace_members m
                    JOIN public.users u ON u.id = m.user_id
                    WHERE u.auth_id = auth.uid() AND m.status = 'active'
                      AND m.workspace_id::text = split_part(object_name, '/', 1))
    END;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.can_access_chat_file(TEXT) TO authenticated;

DROP POLICY IF EXISTS "chat_files_read" ON storage.objects;
CREATE POLICY "chat_files_read" ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'chat-attachments' AND (public.can_access_chat_file(name) OR public.is_app_admin())
);
DROP POLICY IF EXISTS "chat_files_insert" ON storage.objects;
CREATE POLICY "chat_files_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'chat-attachments' AND public.can_access_chat_file(name)
);
DROP POLICY IF EXISTS "chat_files_delete" ON storage.objects;
CREATE POLICY "chat_files_delete" ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'chat-attachments' AND owner = auth.uid()
);
