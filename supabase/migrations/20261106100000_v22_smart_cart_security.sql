-- ============================================================================
-- v22: Smart Cart + security fixes. Safe to run more than once. Nothing is deleted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SECURITY: app-admin flag
--    Before: a signed-in user without a profile row could create one with is_admin = true,
--    or use a listed admin email they don't own. Now only the service key can grant it, and
--    automatic promotion uses the account's verified email from auth.users.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_listed_admin()
RETURNS TRIGGER AS $$
DECLARE v_email TEXT;
BEGIN
    IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
    NEW.is_admin := FALSE;
    NEW.is_banned := FALSE;
    SELECT lower(email) INTO v_email FROM auth.users WHERE id = NEW.auth_id AND email_confirmed_at IS NOT NULL;
    IF v_email IS NOT NULL AND v_email IN (SELECT lower(email) FROM public.admin_emails) THEN
        NEW.is_admin := TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS users_promote_listed_admin ON public.users;
CREATE TRIGGER users_promote_listed_admin BEFORE INSERT ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.promote_listed_admin();

-- Rows written by members: the author is always the signed-in user (no spoofing someone else)
CREATE OR REPLACE FUNCTION public.stamp_created_by()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.role() = 'authenticated' THEN
        IF TG_OP = 'INSERT' THEN NEW.created_by := public.current_user_id();
        ELSE NEW.created_by := OLD.created_by; END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['expenses', 'incomes', 'monthly_bills'] LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'created_by') THEN
            EXECUTE format('DROP TRIGGER IF EXISTS %1$s_stamp_created_by ON public.%1$I', t);
            EXECUTE format('CREATE TRIGGER %1$s_stamp_created_by BEFORE INSERT OR UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.stamp_created_by()', t);
        END IF;
    END LOOP;
END $$;

-- Workspace roles: admins can't make anyone an owner, and nobody but the owner changes the owner's row
CREATE OR REPLACE FUNCTION public.guard_member_roles()
RETURNS TRIGGER AS $$
DECLARE v_owner UUID;
BEGIN
    IF auth.role() <> 'authenticated' THEN RETURN COALESCE(NEW, OLD); END IF;
    SELECT owner_id INTO v_owner FROM public.workspaces WHERE id = COALESCE(NEW.workspace_id, OLD.workspace_id);
    IF TG_OP = 'UPDATE' THEN
        IF NEW.workspace_id <> OLD.workspace_id OR NEW.user_id <> OLD.user_id THEN RAISE EXCEPTION 'membership cannot be moved'; END IF;
        IF OLD.role = 'owner' AND public.current_user_id() IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'only the owner can change the owner'; END IF;
    END IF;
    IF NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'a workspace has one owner'; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS members_guard_roles ON public.workspace_members;
CREATE TRIGGER members_guard_roles BEFORE INSERT OR UPDATE ON public.workspace_members
    FOR EACH ROW EXECUTE FUNCTION public.guard_member_roles();

-- ---------------------------------------------------------------------------
-- 2. Expenses can come from a Smart Cart: link + itemized snapshot
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_source_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_source_check
    CHECK (source IN ('manual', 'ocr', 'import', 'bill', 'smart_cart', 'voice', 'sms', 'scan', 'upload', 'ai'));
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS cart_id UUID;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS details JSONB;
-- One expense per cart, enforced by the database (repeated taps / retries can't duplicate)
CREATE UNIQUE INDEX IF NOT EXISTS expenses_one_per_cart ON public.expenses (cart_id) WHERE cart_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Smart Cart tables. A cart belongs to one user (only they see it); the expense it becomes
--    belongs to the workspace like any other expense.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smart_carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT CHECK (char_length(name) <= 80),
    store_name TEXT CHECK (char_length(store_name) <= 80),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'calculated', 'confirmed', 'discarded')),
    vat_mode TEXT NOT NULL DEFAULT 'add' CHECK (vat_mode IN ('none', 'add', 'included')),
    vat_rate_bp INTEGER NOT NULL DEFAULT 1400 CHECK (vat_rate_bp BETWEEN 0 AND 10000),
    calculated_total_minor BIGINT,
    calculated_at TIMESTAMPTZ,
    expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ,
    discarded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smart_carts_user_status ON public.smart_carts (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.smart_cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL REFERENCES public.smart_carts(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0 AND unit_price_minor < 100000000000),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    qty_milli INTEGER NOT NULL DEFAULT 1000 CHECK (qty_milli > 0 AND qty_milli <= 100000000),
    unit_basis TEXT NOT NULL DEFAULT 'each' CHECK (unit_basis IN ('each', 'kg', 'g', 'l', 'ml', 'm')),
    pack_size TEXT CHECK (char_length(pack_size) <= 40),
    barcode TEXT CHECK (char_length(barcode) <= 40),
    production_date DATE,
    expiry_date DATE,
    notes TEXT CHECK (char_length(notes) <= 500),
    vat_exempt BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('scan', 'manual')),
    image_paths TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(image_paths) <= 4),
    review_flags TEXT[] NOT NULL DEFAULT '{}',
    extraction JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smart_cart_items_cart ON public.smart_cart_items (cart_id, position);

ALTER TABLE public.smart_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_cart_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smart_carts_own ON public.smart_carts;
CREATE POLICY smart_carts_own ON public.smart_carts FOR ALL TO authenticated
    USING (user_id = public.current_user_id())
    WITH CHECK (user_id = public.current_user_id()
        AND public.check_is_workspace_member(workspace_id)
        AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = smart_carts.workspace_id AND m.user_id = public.current_user_id() AND m.role = 'viewer'));

DROP POLICY IF EXISTS smart_cart_items_own ON public.smart_cart_items;
CREATE POLICY smart_cart_items_own ON public.smart_cart_items FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.smart_carts c WHERE c.id = cart_id AND c.user_id = public.current_user_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.smart_carts c WHERE c.id = cart_id AND c.user_id = public.current_user_id()));

-- State rules, enforced in the database:
--  * confirmed and discarded carts are frozen
--  * a cart only becomes "confirmed" through confirm_smart_cart, "calculated" through calculate_smart_cart
--  * editing anything moves a calculated cart back to draft, so an old summary can't be confirmed
CREATE OR REPLACE FUNCTION public.smart_cart_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'smart_cart: new carts start as draft'; END IF;
        NEW.user_id := COALESCE(public.current_user_id(), NEW.user_id);
        NEW.calculated_total_minor := NULL; NEW.calculated_at := NULL; NEW.expense_id := NULL; NEW.confirmed_at := NULL; NEW.discarded_at := NULL;
        RETURN NEW;
    END IF;
    IF OLD.status IN ('confirmed', 'discarded') THEN RAISE EXCEPTION 'smart_cart: this cart is % and can no longer change', OLD.status USING ERRCODE = 'P0001'; END IF;
    NEW.id := OLD.id; NEW.user_id := OLD.user_id; NEW.created_at := OLD.created_at; NEW.updated_at := now();
    IF NEW.workspace_id <> OLD.workspace_id OR NEW.currency <> OLD.currency THEN
        IF EXISTS (SELECT 1 FROM public.smart_cart_items i WHERE i.cart_id = OLD.id) THEN RAISE EXCEPTION 'smart_cart: empty the cart before changing its workspace or currency'; END IF;
    END IF;
    IF NEW.status = 'confirmed' AND current_setting('zaylo.smart_cart_op', true) IS DISTINCT FROM 'confirm' THEN RAISE EXCEPTION 'smart_cart: use confirm_smart_cart'; END IF;
    IF NEW.status = 'calculated' AND current_setting('zaylo.smart_cart_op', true) IS DISTINCT FROM 'calculate' THEN
        IF OLD.status = 'calculated' AND NEW.vat_mode = OLD.vat_mode AND NEW.vat_rate_bp = OLD.vat_rate_bp THEN RETURN NEW; END IF;
        NEW.status := 'draft';
    END IF;
    IF NEW.status = 'draft' THEN NEW.calculated_total_minor := NULL; NEW.calculated_at := NULL; END IF;
    IF NEW.status <> 'confirmed' THEN NEW.expense_id := OLD.expense_id; NEW.confirmed_at := OLD.confirmed_at; END IF;
    IF NEW.status = 'discarded' THEN NEW.discarded_at := now(); END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS smart_carts_guard ON public.smart_carts;
CREATE TRIGGER smart_carts_guard BEFORE INSERT OR UPDATE ON public.smart_carts FOR EACH ROW EXECUTE FUNCTION public.smart_cart_guard();

CREATE OR REPLACE FUNCTION public.smart_cart_item_guard()
RETURNS TRIGGER AS $$
DECLARE v_status TEXT; v_cart UUID := COALESCE(NEW.cart_id, OLD.cart_id);
BEGIN
    SELECT status INTO v_status FROM public.smart_carts WHERE id = v_cart;
    IF v_status IN ('confirmed', 'discarded') THEN RAISE EXCEPTION 'smart_cart: this cart is % and can no longer change', v_status USING ERRCODE = 'P0001'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.cart_id <> OLD.cart_id THEN RAISE EXCEPTION 'smart_cart: items cannot move between carts'; END IF;
    -- any change invalidates a calculated summary
    UPDATE public.smart_carts SET status = 'draft', updated_at = now() WHERE id = v_cart AND status = 'calculated';
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    NEW.updated_at := now();
    NEW.name := btrim(NEW.name);
    IF NEW.expiry_date IS NOT NULL AND NEW.production_date IS NOT NULL AND NEW.expiry_date < NEW.production_date THEN
        RAISE EXCEPTION 'smart_cart: the expiry date is before the production date';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS smart_cart_items_guard ON public.smart_cart_items;
CREATE TRIGGER smart_cart_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.smart_cart_items FOR EACH ROW EXECUTE FUNCTION public.smart_cart_item_guard();

-- ---------------------------------------------------------------------------
-- 4. Totals, computed in the database with the same rules as src/smartcart/money.ts
--    (half-up per line, VAT once on the taxable subtotal).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.smart_cart_totals(p_cart_id UUID)
RETURNS JSONB AS $$
DECLARE
    c public.smart_carts;
    v_taxable NUMERIC := 0; v_exempt NUMERIC := 0; v_vat NUMERIC := 0; v_items INT := 0; v_qty BIGINT := 0;
    v_mismatch INT := 0; v_sub NUMERIC; v_total NUMERIC; v_before NUMERIC;
BEGIN
    SELECT * INTO c FROM public.smart_carts WHERE id = p_cart_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'smart_cart: not found' USING ERRCODE = 'P0002'; END IF;
    SELECT
        COALESCE(SUM(CASE WHEN NOT vat_exempt THEN floor((unit_price_minor::numeric * qty_milli * 2 + 1000) / 2000) END), 0),
        COALESCE(SUM(CASE WHEN vat_exempt THEN floor((unit_price_minor::numeric * qty_milli * 2 + 1000) / 2000) END), 0),
        COUNT(*), COALESCE(SUM(qty_milli), 0), COUNT(*) FILTER (WHERE currency <> c.currency)
    INTO v_taxable, v_exempt, v_items, v_qty, v_mismatch
    FROM public.smart_cart_items WHERE cart_id = p_cart_id;
    v_sub := v_taxable + v_exempt;
    IF c.vat_mode = 'add' THEN
        v_vat := floor((v_taxable * c.vat_rate_bp * 2 + 10000) / 20000); v_total := v_sub + v_vat; v_before := v_sub;
    ELSIF c.vat_mode = 'included' THEN
        v_vat := floor((v_taxable * c.vat_rate_bp * 2 + (10000 + c.vat_rate_bp)) / (2 * (10000 + c.vat_rate_bp))); v_total := v_sub; v_before := v_sub - v_vat;
    ELSE
        v_vat := 0; v_total := v_sub; v_before := v_sub;
    END IF;
    RETURN jsonb_build_object(
        'currency', c.currency, 'mode', c.vat_mode, 'rateBp', c.vat_rate_bp,
        'itemCount', v_items, 'totalQtyMilli', v_qty,
        'subtotal', v_sub, 'taxable', v_taxable, 'exempt', v_exempt,
        'vat', v_vat, 'beforeVat', v_before, 'total', v_total, 'currencyMismatches', v_mismatch
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public;

CREATE OR REPLACE FUNCTION public.calculate_smart_cart(p_cart_id UUID)
RETURNS JSONB AS $$
DECLARE t JSONB; c public.smart_carts;
BEGIN
    SELECT * INTO c FROM public.smart_carts WHERE id = p_cart_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'smart_cart: not found' USING ERRCODE = 'P0002'; END IF;
    IF c.status NOT IN ('draft', 'calculated') THEN RAISE EXCEPTION 'smart_cart: this cart is %', c.status; END IF;
    t := public.smart_cart_totals(p_cart_id);
    IF (t->>'itemCount')::int = 0 THEN RAISE EXCEPTION 'smart_cart: add at least one item first'; END IF;
    IF (t->>'currencyMismatches')::int > 0 THEN RAISE EXCEPTION 'smart_cart: some items use a different currency'; END IF;
    PERFORM set_config('zaylo.smart_cart_op', 'calculate', true);
    UPDATE public.smart_carts SET status = 'calculated', calculated_total_minor = (t->>'total')::bigint, calculated_at = now() WHERE id = p_cart_id;
    PERFORM set_config('zaylo.smart_cart_op', '', true);
    RETURN t;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 5. Confirm: one transaction creates exactly one expense and freezes the cart.
--    Calling it again for a confirmed cart returns the same expense (safe to retry).
--    p_expected_total_minor must match the server's recalculation, so the user always confirms
--    the numbers they saw.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_smart_cart(
    p_cart_id UUID,
    p_expected_total_minor BIGINT,
    p_category TEXT,
    p_payment_method TEXT,
    p_purchased_at TIMESTAMPTZ,
    p_notes TEXT DEFAULT NULL,
    p_actual_minor BIGINT DEFAULT NULL,
    p_fx_rate NUMERIC DEFAULT NULL   -- cart currency → workspace currency, only when they differ
) RETURNS JSONB AS $$
DECLARE
    c public.smart_carts; t JSONB; v_amount BIGINT; v_expense UUID; v_items JSONB; v_title TEXT; v_me UUID := public.current_user_id();
    v_ws_currency TEXT; v_base NUMERIC; v_base_cur TEXT; v_rate NUMERIC;
BEGIN
    SELECT * INTO c FROM public.smart_carts WHERE id = p_cart_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'smart_cart: not found' USING ERRCODE = 'P0002'; END IF;
    IF c.status = 'confirmed' THEN
        RETURN jsonb_build_object('expenseId', c.expense_id, 'alreadyConfirmed', true);
    END IF;
    IF c.status = 'discarded' THEN RAISE EXCEPTION 'smart_cart: this cart was discarded'; END IF;
    IF NOT public.check_is_workspace_member(c.workspace_id)
       OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = c.workspace_id AND m.user_id = v_me AND m.role = 'viewer') THEN
        RAISE EXCEPTION 'smart_cart: you can''t add expenses to this workspace' USING ERRCODE = '42501';
    END IF;
    t := public.smart_cart_totals(p_cart_id);
    IF (t->>'itemCount')::int = 0 THEN RAISE EXCEPTION 'smart_cart: add at least one item first'; END IF;
    IF (t->>'currencyMismatches')::int > 0 THEN RAISE EXCEPTION 'smart_cart: some items use a different currency'; END IF;
    IF p_expected_total_minor IS DISTINCT FROM (t->>'total')::bigint THEN
        RAISE EXCEPTION 'smart_cart: totals_changed' USING DETAIL = t::text;
    END IF;
    IF p_actual_minor IS NOT NULL AND (p_actual_minor < 0 OR p_actual_minor >= 100000000000) THEN RAISE EXCEPTION 'smart_cart: invalid checkout amount'; END IF;
    IF p_purchased_at IS NULL OR p_purchased_at > now() + interval '1 day' THEN RAISE EXCEPTION 'smart_cart: invalid purchase date'; END IF;
    IF char_length(COALESCE(p_category, '')) NOT BETWEEN 1 AND 40 OR char_length(COALESCE(p_payment_method, '')) NOT BETWEEN 1 AND 40 THEN
        RAISE EXCEPTION 'smart_cart: choose a category and payment method';
    END IF;

    v_amount := COALESCE(p_actual_minor, (t->>'total')::bigint);
    SELECT currency INTO v_ws_currency FROM public.workspaces WHERE id = c.workspace_id;
    IF v_ws_currency IS NOT NULL AND v_ws_currency <> c.currency AND p_fx_rate IS NOT NULL THEN
        IF p_fx_rate <= 0 OR p_fx_rate > 1000000 THEN RAISE EXCEPTION 'smart_cart: invalid exchange rate'; END IF;
        v_rate := p_fx_rate; v_base_cur := v_ws_currency; v_base := round(v_amount * p_fx_rate) / 100.0;
    END IF;
    v_title := CASE WHEN COALESCE(btrim(c.store_name), '') <> '' THEN 'Shopping · ' || btrim(c.store_name) ELSE 'Smart Cart Purchase' END;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', name, 'unitPriceMinor', unit_price_minor, 'qtyMilli', qty_milli, 'unitBasis', unit_basis,
        'lineMinor', floor((unit_price_minor::numeric * qty_milli * 2 + 1000) / 2000),
        'vatExempt', vat_exempt, 'packSize', pack_size, 'barcode', barcode,
        'productionDate', production_date, 'expiryDate', expiry_date, 'notes', notes,
        'source', source, 'imagePaths', to_jsonb(image_paths)
    ) ORDER BY position, created_at), '[]'::jsonb) INTO v_items
    FROM public.smart_cart_items WHERE cart_id = p_cart_id;

    INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, description, category, payment_method,
                                 notes, source, purchased_at, cart_id, details, base_amount, base_currency, fx_rate)
    VALUES (c.workspace_id, v_me, v_amount / 100.0, c.currency, v_title,
            (t->>'itemCount') || ' items', p_category, p_payment_method, COALESCE(left(p_notes, 1000), ''), 'smart_cart',
            p_purchased_at, c.id,
            jsonb_build_object(
                'kind', 'smart_cart', 'version', 1, 'cartId', c.id, 'cartName', c.name, 'storeName', c.store_name,
                'currency', c.currency, 'vatMode', c.vat_mode, 'vatRateBp', c.vat_rate_bp,
                'subtotalMinor', (t->>'subtotal')::bigint, 'taxableMinor', (t->>'taxable')::bigint, 'exemptMinor', (t->>'exempt')::bigint,
                'vatMinor', (t->>'vat')::bigint, 'beforeVatMinor', (t->>'beforeVat')::bigint,
                'estimatedTotalMinor', (t->>'total')::bigint, 'actualTotalMinor', p_actual_minor,
                'differenceMinor', CASE WHEN p_actual_minor IS NULL THEN NULL ELSE p_actual_minor - (t->>'total')::bigint END,
                'recordedMinor', v_amount, 'itemCount', (t->>'itemCount')::int, 'totalQtyMilli', (t->>'totalQtyMilli')::bigint,
                'items', v_items, 'confirmedAt', now()),
            v_base, v_base_cur, v_rate)
    RETURNING id INTO v_expense;

    PERFORM set_config('zaylo.smart_cart_op', 'confirm', true);
    UPDATE public.smart_carts SET status = 'confirmed', expense_id = v_expense, confirmed_at = now(),
        calculated_total_minor = (t->>'total')::bigint WHERE id = p_cart_id;
    PERFORM set_config('zaylo.smart_cart_op', '', true);
    RETURN jsonb_build_object('expenseId', v_expense, 'alreadyConfirmed', false, 'recordedMinor', v_amount);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- Discard: no expense, ever. Returns the image paths so the app can delete the files.
CREATE OR REPLACE FUNCTION public.discard_smart_cart(p_cart_id UUID)
RETURNS JSONB AS $$
DECLARE c public.smart_carts; v_paths TEXT[];
BEGIN
    SELECT * INTO c FROM public.smart_carts WHERE id = p_cart_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'smart_cart: not found' USING ERRCODE = 'P0002'; END IF;
    IF c.status = 'discarded' THEN RETURN jsonb_build_object('discarded', true, 'imagePaths', '[]'::jsonb); END IF;
    IF c.status = 'confirmed' THEN RAISE EXCEPTION 'smart_cart: a confirmed purchase can''t be discarded'; END IF;
    SELECT COALESCE(array_agg(p), '{}') INTO v_paths FROM public.smart_cart_items, unnest(image_paths) p WHERE cart_id = p_cart_id;
    UPDATE public.smart_carts SET status = 'discarded' WHERE id = p_cart_id;
    RETURN jsonb_build_object('discarded', true, 'imagePaths', to_jsonb(v_paths));
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.calculate_smart_cart(UUID), public.confirm_smart_cart(UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, BIGINT, NUMERIC),
    public.discard_smart_cart(UUID), public.smart_cart_totals(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_smart_cart(UUID), public.confirm_smart_cart(UUID, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, BIGINT, NUMERIC),
    public.discard_smart_cart(UUID), public.smart_cart_totals(UUID) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_carts, public.smart_cart_items TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Private image storage: <auth uid>/<cart id>/<file>. Only the owner can read or delete.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('smart-cart', 'smart-cart', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS smart_cart_files_read ON storage.objects;
CREATE POLICY smart_cart_files_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'smart-cart' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS smart_cart_files_insert ON storage.objects;
CREATE POLICY smart_cart_files_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'smart-cart' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS smart_cart_files_delete ON storage.objects;
CREATE POLICY smart_cart_files_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'smart-cart' AND (storage.foldername(name))[1] = auth.uid()::text);

SELECT 'v22 ok' AS result;
