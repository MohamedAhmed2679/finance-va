/**
 * "Approve all" for AutoTrack's Needs Review list.
 * Decides, for every waiting alert, the same thing a careful person would do one by one:
 *   1. link it to a record that already exists (the likely match the pipeline found, or a single
 *      record with the same amount and currency within two days), so nothing is counted twice;
 *   2. otherwise add it where it belongs (expense, income, transfer) with its suggested category;
 *   3. otherwise leave it for the person (amount unclear, pending or declined, money received that
 *      might not be earnings, a possible repeat of another alert).
 * Pure: no network. The page runs the plan with the existing per-item actions.
 */
import type { AutoTrackItem, Transfer } from './service';

export type BulkAction =
    | { kind: 'link'; item: AutoTrackItem; target: 'expense' | 'income' | 'transfer'; recordId: string }
    | { kind: 'post'; item: AutoTrackItem; target: 'expense' | 'income' | 'transfer'; category?: string }
    | { kind: 'ignore'; item: AutoTrackItem }
    | { kind: 'skip'; item: AutoTrackItem; why: string };

export interface BulkRecords {
    expenses: { id: string; amount: number; currency: string; purchaseAt: string }[];
    incomes: { id: string; amount: number; currency: string; date: string }[];
    transfers: Pick<Transfer, 'id' | 'amount' | 'currency' | 'occurred_at'>[];
}

const DAY = 86_400_000;
const sameMoney = (a: number, c: string, it: AutoTrackItem) => it.amount !== null && Math.abs(a - it.amount) < 0.005 && c === it.currency;

export function planBulk(items: AutoTrackItem[], records: BulkRecords): BulkAction[] {
    const claimed = new Set<string>();   // one existing record can absorb only one alert
    const exist = {
        expense: new Set(records.expenses.map(r => r.id)),
        income: new Set(records.incomes.map(r => r.id)),
        transfer: new Set(records.transfers.map(r => r.id)),
    };
    // oldest first, so the earliest alert claims a match
    const ordered = [...items].sort((a, b) => new Date(a.occurred_at ?? a.received_at).getTime() - new Date(b.occurred_at ?? b.received_at).getTime());

    return ordered.map((it): BulkAction => {
        if (it.status !== 'needs_review') return { kind: 'skip', item: it, why: 'Could not be read' };
        if (it.suggested_target === 'ignore') return { kind: 'ignore', item: it };
        if (it.amount === null || !it.currency) return { kind: 'skip', item: it, why: 'Amount unclear' };
        if (it.tx_status === 'declined' || it.tx_status === 'pending') return { kind: 'skip', item: it, why: it.tx_status === 'declined' ? 'Declined' : 'Not completed yet' };

        // 1a. the match the pipeline already found
        const dk = it.duplicate_of_kind;
        if ((dk === 'expense' || dk === 'income' || dk === 'transfer') && it.duplicate_of_id && exist[dk].has(it.duplicate_of_id) && !claimed.has(it.duplicate_of_id)) {
            claimed.add(it.duplicate_of_id);
            return { kind: 'link', item: it, target: dk, recordId: it.duplicate_of_id };
        }
        if (dk === 'autotrack') return { kind: 'skip', item: it, why: 'Possible repeat of another alert' };

        // 1b. exactly one record with the same money, close in time, on the right side
        const at = new Date(it.occurred_at ?? it.received_at).getTime();
        const near = (iso: string) => Math.abs(new Date(iso).getTime() - at) <= 2 * DAY;
        const cands: { target: 'expense' | 'income' | 'transfer'; id: string }[] = [];
        if (it.direction !== 'credit') records.expenses.forEach(r => { if (!claimed.has(r.id) && near(r.purchaseAt) && sameMoney(r.amount, r.currency, it)) cands.push({ target: 'expense', id: r.id }); });
        if (it.direction !== 'debit') records.incomes.forEach(r => { if (!claimed.has(r.id) && near(r.date) && sameMoney(r.amount, r.currency, it)) cands.push({ target: 'income', id: r.id }); });
        records.transfers.forEach(r => { if (!claimed.has(r.id) && near(r.occurred_at) && sameMoney(r.amount, r.currency, it)) cands.push({ target: 'transfer', id: r.id }); });
        if (cands.length === 1) { claimed.add(cands[0].id); return { kind: 'link', item: it, target: cands[0].target, recordId: cands[0].id }; }
        if (cands.length > 1) return { kind: 'skip', item: it, why: 'More than one possible match' };

        // 2. add it where it belongs
        const t = it.suggested_target;
        if (t === 'expense') return { kind: 'post', item: it, target: 'expense', category: it.category ?? 'other' };
        if (t === 'income') return { kind: 'post', item: it, target: 'income' };
        if (t === 'transfer') return { kind: 'post', item: it, target: 'transfer' };
        // "needs a decision": money out is spending; money in might be a loan or a gift, not earnings
        if (it.direction === 'debit') return { kind: 'post', item: it, target: 'expense', category: it.category ?? 'other' };
        return { kind: 'skip', item: it, why: 'Money received: income or not?' };
    });
}

export function summarise(plan: BulkAction[]) {
    const s = { link: 0, expense: 0, income: 0, transfer: 0, ignore: 0, skip: 0 };
    for (const a of plan) {
        if (a.kind === 'post') s[a.target]++;
        else s[a.kind]++;
    }
    return s;
}
