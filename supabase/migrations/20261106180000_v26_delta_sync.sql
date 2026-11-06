-- v26: download only what changed. Every synced table keeps an updated_at that moves on every
-- change (soft deletes included), with an index the app's "changed since" query uses.
-- Safe to run more than once. Nothing is deleted.
ALTER TABLE public.incomes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE public.incomes SET updated_at = coalesce(created_at, now()) WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS update_incomes_updated_at ON public.incomes;
CREATE TRIGGER update_incomes_updated_at BEFORE UPDATE ON public.incomes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_transfers_updated_at ON public.transfers;
CREATE TRIGGER update_transfers_updated_at BEFORE UPDATE ON public.transfers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS expenses_ws_updated ON public.expenses (workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS incomes_ws_updated ON public.incomes (workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS bills_ws_updated ON public.monthly_bills (workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS goals_ws_updated ON public.savings_goals (workspace_id, updated_at);

SELECT 'v26 ok';
