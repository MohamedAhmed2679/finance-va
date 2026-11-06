-- ============================================================================
-- v25: Zaylo AutoTrack (bank / wallet SMS → financial records)
--
--  autotrack_items     one row per transaction alert (structured fields only; never the full SMS).
--                      UNIQUE (user, fingerprint): the same alert can never be recorded twice,
--                      whichever device or retry sends it; dismissed alerts stay dismissed.
--  autotrack_rules     the user's own explicit rules ("AHMED SAMIR → transfer").
--  autotrack_settings  review-first / auto-add, AI consent, last processing status.
--  own_accounts        the user's own bank accounts, wallets, cards and cash (for transfers).
--  transfers           money moving between own accounts: not income, not spending.
--
--  Posting goes through autotrack_post / _undo / _link / _ignore (one transaction each,
--  idempotent, the caller's own items only, normal workspace permissions apply).
-- Safe to run more than once. Nothing is deleted.
-- ============================================================================

-- ---------------------------------------------------------------- own accounts
CREATE TABLE IF NOT EXISTS public.own_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE DEFAULT public.current_user_id(),
    label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
    kind TEXT NOT NULL CHECK (kind IN ('bank', 'wallet', 'card', 'cash')),
    provider_id TEXT,
    last4 TEXT CHECK (last4 IS NULL OR last4 ~ '^[0-9]{3,4}$'),
    currency TEXT NOT NULL DEFAULT 'EGP',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.own_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_accounts_owner ON public.own_accounts;
CREATE POLICY own_accounts_owner ON public.own_accounts FOR ALL USING (user_id = public.current_user_id()) WITH CHECK (user_id = public.current_user_id());

-- ---------------------------------------------------------------- transfers
CREATE TABLE IF NOT EXISTS public.transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.users(id) DEFAULT public.current_user_id(),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL,
    from_account_id UUID REFERENCES public.own_accounts(id) ON DELETE SET NULL,
    to_account_id UUID REFERENCES public.own_accounts(id) ON DELETE SET NULL,
    from_label TEXT,
    to_label TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    note TEXT DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'autotrack')),
    autotrack_item_id UUID,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transfers_ws_time ON public.transfers (workspace_id, occurred_at DESC);
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transfers_sel ON public.transfers;
DROP POLICY IF EXISTS transfers_ins ON public.transfers;
DROP POLICY IF EXISTS transfers_upd ON public.transfers;
DROP POLICY IF EXISTS transfers_del ON public.transfers;
CREATE POLICY transfers_sel ON public.transfers FOR SELECT USING (public.check_is_workspace_member(workspace_id));
CREATE POLICY transfers_ins ON public.transfers FOR INSERT WITH CHECK (
    public.check_is_workspace_member(workspace_id)
    AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = transfers.workspace_id AND m.user_id = public.current_user_id() AND m.role = 'viewer'));
CREATE POLICY transfers_upd ON public.transfers FOR UPDATE USING (
    public.check_is_workspace_member(workspace_id)
    AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = transfers.workspace_id AND m.user_id = public.current_user_id() AND m.role = 'viewer'));
CREATE POLICY transfers_del ON public.transfers FOR DELETE USING (public.check_is_workspace_admin(workspace_id));
DROP TRIGGER IF EXISTS transfers_stamp_created_by ON public.transfers;
CREATE TRIGGER transfers_stamp_created_by BEFORE INSERT OR UPDATE ON public.transfers FOR EACH ROW EXECUTE FUNCTION public.stamp_created_by();

-- ---------------------------------------------------------------- ledger links
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_source_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_source_check
    CHECK (source IN ('manual', 'ocr', 'import', 'bill', 'smart_cart', 'voice', 'sms', 'scan', 'upload', 'ai', 'autotrack'));
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS autotrack_item_id UUID;
ALTER TABLE public.incomes ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.incomes ADD COLUMN IF NOT EXISTS autotrack_item_id UUID;

-- ---------------------------------------------------------------- items
CREATE TABLE IF NOT EXISTS public.autotrack_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE DEFAULT public.current_user_id(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (status IN ('needs_review', 'auto_added', 'confirmed', 'linked', 'ignored', 'undone', 'failed')),
    suggested_target TEXT NOT NULL CHECK (suggested_target IN ('income', 'expense', 'transfer', 'review', 'ignore')),
    final_target TEXT CHECK (final_target IN ('income', 'expense', 'transfer')),
    direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit', 'unknown')),
    channel TEXT NOT NULL DEFAULT 'unknown',
    tx_status TEXT NOT NULL DEFAULT 'completed' CHECK (tx_status IN ('completed', 'pending', 'declined', 'reversed')),
    amount NUMERIC(14, 2) CHECK (amount IS NULL OR amount > 0),
    currency TEXT,
    fee NUMERIC(14, 2) CHECK (fee IS NULL OR fee > 0),
    balance_after NUMERIC(14, 2),          -- as printed in the SMS; informational, never a live balance
    counterparty TEXT,
    provider_id TEXT,
    provider_name TEXT,
    account_ref TEXT CHECK (account_ref IS NULL OR account_ref ~ '^[0-9]{3,4}$'),
    counterparty_ref TEXT CHECK (counterparty_ref IS NULL OR counterparty_ref ~ '^[0-9]{3,4}$'),
    reference TEXT,
    occurred_at TIMESTAMPTZ,
    occurred_at_from_text BOOLEAN NOT NULL DEFAULT FALSE,
    received_at TIMESTAMPTZ NOT NULL,
    category TEXT,
    from_account_id UUID REFERENCES public.own_accounts(id) ON DELETE SET NULL,
    to_account_id UUID REFERENCES public.own_accounts(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    issues TEXT[] NOT NULL DEFAULT '{}',
    confidence NUMERIC(3, 2),
    parser_version TEXT NOT NULL,
    ingestion TEXT NOT NULL CHECK (ingestion IN ('android', 'ios_shortcut', 'paste', 'share', 'history', 'assistant')),
    ai_used BOOLEAN NOT NULL DEFAULT FALSE,
    excerpt TEXT CHECK (excerpt IS NULL OR char_length(excerpt) <= 200),  -- redacted, short
    duplicate_of_kind TEXT CHECK (duplicate_of_kind IN ('expense', 'income', 'transfer', 'autotrack')),
    duplicate_of_id UUID,
    linked_kind TEXT CHECK (linked_kind IN ('expense', 'income', 'transfer')),
    linked_id UUID,
    fee_expense_id UUID,
    error TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS autotrack_items_user_status ON public.autotrack_items (user_id, status, received_at DESC);
ALTER TABLE public.autotrack_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autotrack_items_sel ON public.autotrack_items;
DROP POLICY IF EXISTS autotrack_items_ins ON public.autotrack_items;
DROP POLICY IF EXISTS autotrack_items_upd ON public.autotrack_items;
DROP POLICY IF EXISTS autotrack_items_del ON public.autotrack_items;
CREATE POLICY autotrack_items_sel ON public.autotrack_items FOR SELECT USING (user_id = public.current_user_id());
CREATE POLICY autotrack_items_ins ON public.autotrack_items FOR INSERT WITH CHECK (
    user_id = public.current_user_id() AND public.check_is_workspace_member(workspace_id)
    AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = autotrack_items.workspace_id AND m.user_id = public.current_user_id() AND m.role = 'viewer')
    AND status IN ('needs_review', 'ignored', 'failed'));          -- posting only happens through autotrack_post
CREATE POLICY autotrack_items_upd ON public.autotrack_items FOR UPDATE USING (user_id = public.current_user_id());
CREATE POLICY autotrack_items_del ON public.autotrack_items FOR DELETE USING (user_id = public.current_user_id());

-- Direct updates may only correct fields of an item still waiting for review; status changes go through the functions
CREATE OR REPLACE FUNCTION public.autotrack_item_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.user_id := coalesce(public.current_user_id(), NEW.user_id);
        RETURN NEW;
    END IF;
    NEW.updated_at := now();
    IF current_setting('zaylo.autotrack_op', true) = 'on' OR auth.role() = 'service_role' THEN RETURN NEW; END IF;
    IF NEW.user_id <> OLD.user_id OR NEW.fingerprint <> OLD.fingerprint OR NEW.status <> OLD.status
       OR NEW.linked_id IS DISTINCT FROM OLD.linked_id OR NEW.linked_kind IS DISTINCT FROM OLD.linked_kind
       OR NEW.final_target IS DISTINCT FROM OLD.final_target OR NEW.fee_expense_id IS DISTINCT FROM OLD.fee_expense_id THEN
        RAISE EXCEPTION 'autotrack: use Confirm, Ignore, Link or Undo to change an item''s status';
    END IF;
    IF OLD.status NOT IN ('needs_review', 'failed') THEN
        RAISE EXCEPTION 'autotrack: this item was already handled; edit the record itself or undo it first';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS autotrack_items_guard ON public.autotrack_items;
CREATE TRIGGER autotrack_items_guard BEFORE INSERT OR UPDATE ON public.autotrack_items FOR EACH ROW EXECUTE FUNCTION public.autotrack_item_guard();

-- ---------------------------------------------------------------- rules and settings
CREATE TABLE IF NOT EXISTS public.autotrack_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE DEFAULT public.current_user_id(),
    match TEXT NOT NULL CHECK (char_length(btrim(match)) BETWEEN 2 AND 60),
    target TEXT CHECK (target IN ('income', 'expense', 'transfer', 'review')),
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, match)
);
ALTER TABLE public.autotrack_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autotrack_rules_owner ON public.autotrack_rules;
CREATE POLICY autotrack_rules_owner ON public.autotrack_rules FOR ALL USING (user_id = public.current_user_id()) WITH CHECK (user_id = public.current_user_id());

CREATE TABLE IF NOT EXISTS public.autotrack_settings (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE DEFAULT public.current_user_id(),
    mode TEXT NOT NULL DEFAULT 'review' CHECK (mode IN ('review', 'auto')),
    ai_consent BOOLEAN NOT NULL DEFAULT FALSE,
    ai_consent_at TIMESTAMPTZ,
    custom_senders TEXT[] NOT NULL DEFAULT '{}',
    last_processed_at TIMESTAMPTZ,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.autotrack_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autotrack_settings_owner ON public.autotrack_settings;
CREATE POLICY autotrack_settings_owner ON public.autotrack_settings FOR ALL USING (user_id = public.current_user_id()) WITH CHECK (user_id = public.current_user_id());

-- ---------------------------------------------------------------- posting
-- Records an item in Expenses / Income & Earnings / Transfers. Idempotent: posting an item twice
-- returns the first record. p_auto = true is the auto-add path and refuses anything not eligible.
CREATE OR REPLACE FUNCTION public.autotrack_post(
    p_item UUID, p_target TEXT, p_auto BOOLEAN DEFAULT FALSE,
    p_amount NUMERIC DEFAULT NULL, p_currency TEXT DEFAULT NULL, p_occurred_at TIMESTAMPTZ DEFAULT NULL,
    p_category TEXT DEFAULT NULL, p_title TEXT DEFAULT NULL, p_from UUID DEFAULT NULL, p_to UUID DEFAULT NULL,
    p_record_fee BOOLEAN DEFAULT TRUE)
RETURNS JSONB AS $$
DECLARE
    it public.autotrack_items;
    v_me UUID := public.current_user_id();
    v_amount NUMERIC; v_currency TEXT; v_at TIMESTAMPTZ; v_title TEXT; v_id UUID; v_fee UUID;
    v_from_label TEXT; v_to_label TEXT;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
    SELECT * INTO it FROM public.autotrack_items WHERE id = p_item AND user_id = v_me FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'autotrack: item not found' USING ERRCODE = 'P0002'; END IF;
    IF it.status IN ('auto_added', 'confirmed', 'linked') THEN
        RETURN jsonb_build_object('kind', it.linked_kind, 'id', it.linked_id, 'already', true);
    END IF;
    IF p_target NOT IN ('income', 'expense', 'transfer') THEN RAISE EXCEPTION 'autotrack: choose Income, Expense or Transfer'; END IF;
    IF p_auto THEN
        -- auto-add never overrides a decision or uses anything uncertain
        IF it.status <> 'needs_review' OR it.suggested_target <> p_target OR it.tx_status <> 'completed'
           OR it.amount IS NULL OR it.currency IS NULL OR it.direction = 'unknown' OR it.ai_used OR it.duplicate_of_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.autotrack_settings s WHERE s.user_id = v_me AND s.mode = 'auto') THEN
            RAISE EXCEPTION 'autotrack: not eligible for auto-add' USING ERRCODE = 'P0001';
        END IF;
        IF p_target = 'transfer' AND (it.from_account_id IS NULL AND it.to_account_id IS NULL) THEN
            RAISE EXCEPTION 'autotrack: transfer accounts not resolved' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    v_amount := coalesce(p_amount, it.amount);
    v_currency := upper(coalesce(p_currency, it.currency));
    v_at := coalesce(p_occurred_at, it.occurred_at, it.received_at);
    IF v_amount IS NULL OR v_amount <= 0 OR v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'autotrack: amount and currency are needed'; END IF;
    v_title := nullif(btrim(coalesce(p_title, it.counterparty, '')), '');
    PERFORM set_config('zaylo.autotrack_op', 'on', true);

    IF p_target = 'expense' THEN
        INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, description, category, payment_method,
                                     last4, tags, notes, source, purchased_at, autotrack_item_id)
        VALUES (it.workspace_id, v_me, v_amount, v_currency, coalesce(v_title, coalesce(it.provider_name, 'Bank') || ' payment'), '',
                coalesce(p_category, it.category, 'other'),
                CASE WHEN it.channel IN ('card_purchase', 'online_purchase') THEN 'card' WHEN it.channel IN ('wallet_transfer', 'mobile_recharge') THEN 'wallet'
                     WHEN it.channel IN ('instapay', 'bank_transfer') THEN 'bank_transfer' ELSE 'other' END,
                it.account_ref, ARRAY['autotrack'], 'Added by AutoTrack', 'autotrack', v_at, it.id)
        RETURNING id INTO v_id;
    ELSIF p_target = 'income' THEN
        INSERT INTO public.incomes (workspace_id, created_by, name, amount, currency, type, income_date, source, autotrack_item_id)
        VALUES (it.workspace_id, v_me,
                coalesce(v_title, CASE it.channel WHEN 'salary' THEN 'Salary' WHEN 'interest' THEN 'Interest' ELSE 'Income' END),
                v_amount, v_currency, 'variable', v_at, 'autotrack', it.id)
        RETURNING id INTO v_id;
    ELSE
        SELECT label INTO v_from_label FROM public.own_accounts WHERE id = coalesce(p_from, it.from_account_id) AND user_id = v_me;
        SELECT label INTO v_to_label FROM public.own_accounts WHERE id = coalesce(p_to, it.to_account_id) AND user_id = v_me;
        INSERT INTO public.transfers (workspace_id, created_by, amount, currency, from_account_id, to_account_id, from_label, to_label,
                                      occurred_at, note, source, autotrack_item_id)
        VALUES (it.workspace_id, v_me, v_amount, v_currency,
                CASE WHEN v_from_label IS NULL THEN NULL ELSE coalesce(p_from, it.from_account_id) END,
                CASE WHEN v_to_label IS NULL THEN NULL ELSE coalesce(p_to, it.to_account_id) END,
                coalesce(v_from_label, it.provider_name), coalesce(v_to_label, it.counterparty), v_at, 'Added by AutoTrack', 'autotrack', it.id)
        RETURNING id INTO v_id;
    END IF;

    -- A fee the message states separately is its own expense (never added to the amount as well)
    IF p_record_fee AND it.fee IS NOT NULL AND p_target IN ('expense', 'transfer') THEN
        INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, description, category, payment_method,
                                     tags, notes, source, purchased_at, autotrack_item_id)
        VALUES (it.workspace_id, v_me, it.fee, v_currency, coalesce(it.provider_name, 'Bank') || ' fee', '', 'other', 'other',
                ARRAY['autotrack'], 'Added by AutoTrack', 'autotrack', v_at, it.id)
        RETURNING id INTO v_fee;
    END IF;

    UPDATE public.autotrack_items SET status = CASE WHEN p_auto THEN 'auto_added' ELSE 'confirmed' END,
           final_target = p_target, linked_kind = p_target, linked_id = v_id, fee_expense_id = v_fee,
           amount = v_amount, currency = v_currency, occurred_at = v_at,
           category = coalesce(p_category, category), from_account_id = coalesce(p_from, from_account_id), to_account_id = coalesce(p_to, to_account_id),
           decided_at = now(), error = NULL
     WHERE id = it.id;
    RETURN jsonb_build_object('kind', p_target, 'id', v_id, 'feeId', v_fee, 'already', false);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Undo: the record leaves totals (soft delete, so history stays) and the alert won't come back
CREATE OR REPLACE FUNCTION public.autotrack_undo(p_item UUID)
RETURNS JSONB AS $$
DECLARE it public.autotrack_items; v_me UUID := public.current_user_id();
BEGIN
    SELECT * INTO it FROM public.autotrack_items WHERE id = p_item AND user_id = v_me FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'autotrack: item not found' USING ERRCODE = 'P0002'; END IF;
    IF it.status = 'undone' THEN RETURN jsonb_build_object('undone', true, 'already', true); END IF;
    IF it.status NOT IN ('auto_added', 'confirmed', 'linked') THEN RAISE EXCEPTION 'autotrack: nothing to undo'; END IF;
    PERFORM set_config('zaylo.autotrack_op', 'on', true);
    IF it.status <> 'linked' THEN   -- a link to an existing record never deletes that record
        IF it.linked_kind = 'expense' THEN UPDATE public.expenses SET is_deleted = TRUE WHERE id = it.linked_id;
        ELSIF it.linked_kind = 'income' THEN UPDATE public.incomes SET is_deleted = TRUE WHERE id = it.linked_id;
        ELSIF it.linked_kind = 'transfer' THEN UPDATE public.transfers SET is_deleted = TRUE WHERE id = it.linked_id; END IF;
        IF it.fee_expense_id IS NOT NULL THEN UPDATE public.expenses SET is_deleted = TRUE WHERE id = it.fee_expense_id; END IF;
    ELSIF it.linked_kind = 'expense' THEN
        UPDATE public.expenses SET autotrack_item_id = NULL WHERE id = it.linked_id AND autotrack_item_id = it.id;
    END IF;
    UPDATE public.autotrack_items SET status = 'undone', decided_at = now() WHERE id = it.id;
    RETURN jsonb_build_object('undone', true, 'already', false);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Link to a record that already exists (a manual or Smart Cart expense, an income, a transfer)
CREATE OR REPLACE FUNCTION public.autotrack_link(p_item UUID, p_kind TEXT, p_record UUID)
RETURNS JSONB AS $$
DECLARE it public.autotrack_items; v_me UUID := public.current_user_id(); v_ok BOOLEAN;
BEGIN
    SELECT * INTO it FROM public.autotrack_items WHERE id = p_item AND user_id = v_me FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'autotrack: item not found' USING ERRCODE = 'P0002'; END IF;
    IF it.status IN ('auto_added', 'confirmed', 'linked') THEN
        IF it.linked_id = p_record THEN RETURN jsonb_build_object('linked', true, 'already', true); END IF;
        RAISE EXCEPTION 'autotrack: already recorded; undo it first';
    END IF;
    -- the record must be one the caller can see (RLS applies inside this function)
    v_ok := CASE p_kind
        WHEN 'expense' THEN EXISTS (SELECT 1 FROM public.expenses WHERE id = p_record AND NOT coalesce(is_deleted, false))
        WHEN 'income' THEN EXISTS (SELECT 1 FROM public.incomes WHERE id = p_record AND NOT coalesce(is_deleted, false))
        WHEN 'transfer' THEN EXISTS (SELECT 1 FROM public.transfers WHERE id = p_record AND NOT is_deleted)
        ELSE FALSE END;
    IF NOT v_ok THEN RAISE EXCEPTION 'autotrack: that record isn''t available' USING ERRCODE = 'P0002'; END IF;
    PERFORM set_config('zaylo.autotrack_op', 'on', true);
    IF p_kind = 'expense' THEN UPDATE public.expenses SET autotrack_item_id = it.id WHERE id = p_record AND autotrack_item_id IS NULL; END IF;
    IF p_kind = 'income' THEN UPDATE public.incomes SET autotrack_item_id = it.id WHERE id = p_record AND autotrack_item_id IS NULL; END IF;
    UPDATE public.autotrack_items SET status = 'linked', linked_kind = p_kind, linked_id = p_record, final_target = p_kind, decided_at = now() WHERE id = it.id;
    RETURN jsonb_build_object('linked', true, 'already', false);
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.autotrack_ignore(p_item UUID)
RETURNS JSONB AS $$
DECLARE it public.autotrack_items; v_me UUID := public.current_user_id();
BEGIN
    SELECT * INTO it FROM public.autotrack_items WHERE id = p_item AND user_id = v_me FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'autotrack: item not found' USING ERRCODE = 'P0002'; END IF;
    IF it.status IN ('auto_added', 'confirmed', 'linked') THEN RAISE EXCEPTION 'autotrack: undo it first, then ignore'; END IF;
    PERFORM set_config('zaylo.autotrack_op', 'on', true);
    UPDATE public.autotrack_items SET status = 'ignored', decided_at = now() WHERE id = it.id;
    RETURN jsonb_build_object('ignored', true);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Bring an ignored or undone item back to Needs Review (only when the user asks)
CREATE OR REPLACE FUNCTION public.autotrack_restore(p_item UUID)
RETURNS JSONB AS $$
DECLARE v_me UUID := public.current_user_id(); n INT;
BEGIN
    PERFORM set_config('zaylo.autotrack_op', 'on', true);
    UPDATE public.autotrack_items SET status = 'needs_review', linked_kind = NULL, linked_id = NULL, fee_expense_id = NULL, final_target = NULL, decided_at = NULL
     WHERE id = p_item AND user_id = v_me AND status IN ('ignored', 'undone');
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN jsonb_build_object('restored', n = 1);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Delete imported alerts. p_records: also remove the records AutoTrack created (linked existing
-- records are never deleted, only unlinked). Without it the records stay as ordinary entries.
CREATE OR REPLACE FUNCTION public.autotrack_delete_imported(p_records BOOLEAN DEFAULT FALSE)
RETURNS JSONB AS $$
DECLARE v_me UUID := public.current_user_id(); n_items INT; n_records INT := 0; r RECORD;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
    PERFORM set_config('zaylo.autotrack_op', 'on', true);
    FOR r IN SELECT * FROM public.autotrack_items WHERE user_id = v_me LOOP
        IF p_records AND r.status IN ('auto_added', 'confirmed') THEN
            IF r.linked_kind = 'expense' THEN UPDATE public.expenses SET is_deleted = TRUE WHERE id = r.linked_id;
            ELSIF r.linked_kind = 'income' THEN UPDATE public.incomes SET is_deleted = TRUE WHERE id = r.linked_id;
            ELSIF r.linked_kind = 'transfer' THEN UPDATE public.transfers SET is_deleted = TRUE WHERE id = r.linked_id; END IF;
            IF r.fee_expense_id IS NOT NULL THEN UPDATE public.expenses SET is_deleted = TRUE WHERE id = r.fee_expense_id; END IF;
            n_records := n_records + 1;
        END IF;
        UPDATE public.expenses SET autotrack_item_id = NULL WHERE autotrack_item_id = r.id;
        UPDATE public.incomes SET autotrack_item_id = NULL WHERE autotrack_item_id = r.id;
        UPDATE public.transfers SET autotrack_item_id = NULL WHERE autotrack_item_id = r.id;
    END LOOP;
    DELETE FROM public.autotrack_items WHERE user_id = v_me;
    GET DIAGNOSTICS n_items = ROW_COUNT;
    RETURN jsonb_build_object('items', n_items, 'recordsRemoved', n_records);
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.autotrack_post(UUID, TEXT, BOOLEAN, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.autotrack_undo(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.autotrack_link(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.autotrack_ignore(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.autotrack_restore(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.autotrack_delete_imported(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.autotrack_post(UUID, TEXT, BOOLEAN, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.autotrack_undo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.autotrack_link(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.autotrack_ignore(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.autotrack_restore(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.autotrack_delete_imported(BOOLEAN) TO authenticated;

-- Account deletion (v24) also removes AutoTrack data
CREATE OR REPLACE FUNCTION public.autotrack_forget_user() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.name = 'Deleted user' AND OLD.name IS DISTINCT FROM NEW.name THEN
        DELETE FROM public.autotrack_items WHERE user_id = NEW.id;
        DELETE FROM public.autotrack_rules WHERE user_id = NEW.id;
        DELETE FROM public.autotrack_settings WHERE user_id = NEW.id;
        UPDATE public.own_accounts SET is_deleted = TRUE, label = 'Deleted', last4 = NULL WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS users_autotrack_forget ON public.users;
CREATE TRIGGER users_autotrack_forget AFTER UPDATE OF name ON public.users FOR EACH ROW EXECUTE FUNCTION public.autotrack_forget_user();

SELECT 'v25 ok';
