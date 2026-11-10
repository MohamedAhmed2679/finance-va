-- ============================================================================
-- Zaylo V29 — Help: support requests, consent records, AI feedback
--
-- 1. support_requests: a numbered request with a category, severity and status.
--    support_messages rows can belong to a request (request_id). Rows without one
--    are the earlier free-form conversation and keep working.
-- 2. SECURITY FIX: the old "support_mark_read" rule let a person UPDATE every column
--    of their own support messages, including from_admin and body, so a message
--    could be made to look as if the Zaylo team wrote it. People may now change
--    read_at only, and only on messages the team sent them.
-- 3. consent_events: an append-only record of each time a person allows or
--    withdraws a permission (first use: sending data to the AI provider).
-- 4. ai_feedback: helpful / not helpful / reported, for one AI answer.
--
-- Safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Support requests
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.support_request_number_seq START 1001;

CREATE TABLE IF NOT EXISTS public.support_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number BIGINT NOT NULL UNIQUE DEFAULT nextval('public.support_request_number_seq'),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN (
        'account', 'expenses_income', 'bills_savings', 'smart_cart', 'autotrack', 'workspaces',
        'sync_backup', 'ai_assistant', 'billing', 'feedback', 'other',
        'sec_account_compromise', 'sec_suspicious_activity', 'sec_unauthorized_record', 'sec_privacy', 'sec_vulnerability')),
    subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 140),
    severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting_on_you', 'resolved', 'closed')),
    confidential BOOLEAN NOT NULL DEFAULT FALSE,
    related_feature TEXT CHECK (related_feature IS NULL OR char_length(related_feature) <= 60),
    related_ref TEXT CHECK (related_ref IS NULL OR char_length(related_ref) <= 120),
    diagnostics JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    CONSTRAINT support_requests_security_is_confidential CHECK (category NOT LIKE 'sec\_%' OR confidential),
    CONSTRAINT support_requests_diagnostics_small CHECK (diagnostics IS NULL OR pg_column_size(diagnostics) <= 4096)
);
CREATE INDEX IF NOT EXISTS idx_support_requests_user ON public.support_requests(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON public.support_requests(status, updated_at DESC);
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_requests_select_own" ON public.support_requests;
CREATE POLICY "support_requests_select_own" ON public.support_requests FOR SELECT TO authenticated USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
-- People open requests for themselves, always as 'open'. They never UPDATE or DELETE rows directly:
-- closing and reopening go through the two functions below, everything else is the support team's.
DROP POLICY IF EXISTS "support_requests_insert_own" ON public.support_requests;
CREATE POLICY "support_requests_insert_own" ON public.support_requests FOR INSERT TO authenticated WITH CHECK (
    status = 'open' AND closed_at IS NULL
    AND user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
REVOKE UPDATE, DELETE ON public.support_requests FROM anon, authenticated;
REVOKE ALL ON public.support_requests FROM anon;

ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES public.support_requests(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_support_messages_request ON public.support_messages(request_id, created_at);

-- A message may only be attached to the sender's own request, and not to a closed one.
DROP POLICY IF EXISTS "support_insert_own" ON public.support_messages;
CREATE POLICY "support_insert_own" ON public.support_messages FOR INSERT WITH CHECK (
    from_admin = FALSE
    AND user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    AND (request_id IS NULL OR EXISTS (
        SELECT 1 FROM public.support_requests r
        WHERE r.id = request_id AND r.user_id = support_messages.user_id AND r.status <> 'closed'))
);

-- Keep the request's status and "last update" in step with its messages.
CREATE OR REPLACE FUNCTION public.support_request_touch()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.request_id IS NOT NULL THEN
        UPDATE public.support_requests
           SET updated_at = now(),
               status = CASE
                   WHEN NEW.from_admin AND status = 'open' THEN 'waiting_on_you'
                   WHEN NOT NEW.from_admin AND status IN ('waiting_on_you', 'resolved') THEN 'open'
                   ELSE status END,
               closed_at = CASE WHEN NOT NEW.from_admin AND status = 'resolved' THEN NULL ELSE closed_at END
         WHERE id = NEW.request_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS trg_support_request_touch ON public.support_messages;
CREATE TRIGGER trg_support_request_touch AFTER INSERT ON public.support_messages
    FOR EACH ROW EXECUTE FUNCTION public.support_request_touch();
REVOKE ALL ON FUNCTION public.support_request_touch() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.close_support_request(p_id UUID)
RETURNS public.support_requests AS $$
DECLARE r public.support_requests;
BEGIN
    UPDATE public.support_requests SET status = 'closed', closed_at = now(), updated_at = now()
     WHERE id = p_id AND status <> 'closed'
       AND user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    RETURNING * INTO r;
    IF r.id IS NULL THEN RAISE EXCEPTION 'request not found or already closed'; END IF;
    RETURN r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.reopen_support_request(p_id UUID)
RETURNS public.support_requests AS $$
DECLARE r public.support_requests;
BEGIN
    UPDATE public.support_requests SET status = 'open', closed_at = NULL, updated_at = now()
     WHERE id = p_id AND status IN ('closed', 'resolved')
       AND user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    RETURNING * INTO r;
    IF r.id IS NULL THEN RAISE EXCEPTION 'request not found or not closed'; END IF;
    RETURN r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.close_support_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_support_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_support_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_support_request(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Security fix: people may only mark the team's messages as read
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "support_mark_read" ON public.support_messages;
CREATE POLICY "support_mark_read" ON public.support_messages FOR UPDATE
    USING (from_admin = TRUE AND user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()))
    WITH CHECK (from_admin = TRUE AND user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));
REVOKE UPDATE ON public.support_messages FROM anon, authenticated;
GRANT UPDATE (read_at) ON public.support_messages TO authenticated;
-- Second lock, in case table privileges are ever granted back: only read_at can change.
CREATE OR REPLACE FUNCTION public.protect_support_message()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.role() = 'authenticated' THEN
        NEW.id := OLD.id; NEW.user_id := OLD.user_id; NEW.from_admin := OLD.from_admin;
        NEW.sender_name := OLD.sender_name; NEW.body := OLD.body; NEW.created_at := OLD.created_at;
        NEW.attachments := OLD.attachments; NEW.request_id := OLD.request_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS trg_protect_support_message ON public.support_messages;
CREATE TRIGGER trg_protect_support_message BEFORE UPDATE ON public.support_messages
    FOR EACH ROW EXECUTE FUNCTION public.protect_support_message();

-- ---------------------------------------------------------------------------
-- 3. Consent records (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('ai_processing')),
    granted BOOLEAN NOT NULL,
    notice_version TEXT NOT NULL CHECK (char_length(notice_version) BETWEEN 1 AND 40),
    provider TEXT CHECK (provider IS NULL OR char_length(provider) <= 80),
    surface TEXT CHECK (surface IS NULL OR char_length(surface) <= 40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_events_user ON public.consent_events(user_id, purpose, created_at DESC);
ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consent_select_own" ON public.consent_events;
CREATE POLICY "consent_select_own" ON public.consent_events FOR SELECT TO authenticated USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
DROP POLICY IF EXISTS "consent_insert_own" ON public.consent_events;
CREATE POLICY "consent_insert_own" ON public.consent_events FOR INSERT TO authenticated WITH CHECK (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
REVOKE UPDATE, DELETE ON public.consent_events FROM anon, authenticated;
REVOKE ALL ON public.consent_events FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Feedback on AI answers (the answer text is stored only when a person reports it)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    surface TEXT NOT NULL CHECK (surface IN ('assistant', 'insights')),
    rating TEXT NOT NULL CHECK (rating IN ('helpful', 'not_helpful', 'reported')),
    reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 500),
    answer_excerpt TEXT CHECK (answer_excerpt IS NULL OR char_length(answer_excerpt) <= 1200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ai_feedback_excerpt_only_when_reported CHECK (answer_excerpt IS NULL OR rating = 'reported')
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_time ON public.ai_feedback(created_at DESC);
ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_feedback_insert_own" ON public.ai_feedback;
CREATE POLICY "ai_feedback_insert_own" ON public.ai_feedback FOR INSERT TO authenticated WITH CHECK (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
DROP POLICY IF EXISTS "ai_feedback_select_own" ON public.ai_feedback;
CREATE POLICY "ai_feedback_select_own" ON public.ai_feedback FOR SELECT TO authenticated USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);
REVOKE UPDATE, DELETE ON public.ai_feedback FROM anon, authenticated;
REVOKE ALL ON public.ai_feedback FROM anon;

-- Realtime for request status changes (replies already arrive through support_messages)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'support_requests') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.support_requests;
    END IF;
END $$;

-- Check: what signed-in people can do with these tables
SELECT c.relname AS table_name,
       has_table_privilege('authenticated', c.oid, 'UPDATE') AS can_update_whole_row,
       has_table_privilege('authenticated', c.oid, 'DELETE') AS can_delete
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('support_requests', 'support_messages', 'consent_events', 'ai_feedback');
