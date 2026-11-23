/** "Approve all": every alert is linked, added, ignored or left — never counted twice. */
import { describe, it, expect } from 'vitest';
import { planBulk, summarise } from '../../src/autotrack/bulk';
import type { AutoTrackItem } from '../../src/autotrack/service';

let n = 0;
const item = (o: Partial<AutoTrackItem>): AutoTrackItem => ({
    id: `i${++n}`, status: 'needs_review', suggested_target: 'expense', direction: 'debit', channel: 'card', tx_status: 'completed',
    amount: 100, currency: 'EGP', occurred_at: '2026-11-20T10:00:00Z', received_at: '2026-11-20T10:00:00Z', category: 'groceries',
    duplicate_of_kind: null, duplicate_of_id: null, ...o,
} as AutoTrackItem);
const none = { expenses: [], incomes: [], transfers: [] };

describe('planBulk', () => {
    it('adds a card purchase as an expense with its category', () => {
        const [a] = planBulk([item({})], none);
        expect(a).toMatchObject({ kind: 'post', target: 'expense', category: 'groceries' });
    });
    it('links to the likely match the pipeline found', () => {
        const [a] = planBulk([item({ duplicate_of_kind: 'expense', duplicate_of_id: 'e1' })], { ...none, expenses: [{ id: 'e1', amount: 100, currency: 'EGP', purchaseAt: '2026-11-20T09:00:00Z' }] });
        expect(a).toMatchObject({ kind: 'link', target: 'expense', recordId: 'e1' });
    });
    it('links to a single same-amount record within two days, and only once', () => {
        const recs = { ...none, expenses: [{ id: 'e1', amount: 100, currency: 'EGP', purchaseAt: '2026-11-21T09:00:00Z' }] };
        const plan = planBulk([item({}), item({ occurred_at: '2026-11-20T12:00:00Z' })], recs);
        expect(plan.filter(a => a.kind === 'link')).toHaveLength(1);
        expect(plan.filter(a => a.kind === 'post')).toHaveLength(1);
    });
    it('does not link across currencies or far dates', () => {
        const recs = { ...none, expenses: [{ id: 'e1', amount: 100, currency: 'USD', purchaseAt: '2026-11-20T09:00:00Z' }, { id: 'e2', amount: 100, currency: 'EGP', purchaseAt: '2026-11-10T09:00:00Z' }] };
        expect(planBulk([item({})], recs)[0].kind).toBe('post');
    });
    it('leaves ambiguous matches, unclear amounts, declined and money received', () => {
        const recs = { ...none, expenses: [{ id: 'e1', amount: 100, currency: 'EGP', purchaseAt: '2026-11-20T09:00:00Z' }, { id: 'e2', amount: 100, currency: 'EGP', purchaseAt: '2026-11-20T11:00:00Z' }] };
        const plan = planBulk([item({}), item({ amount: null }), item({ tx_status: 'declined', amount: 7 }), item({ suggested_target: 'review', direction: 'credit', amount: 9 })], recs);
        expect(summarise(plan).skip).toBe(4);
    });
    it('treats an undecided payment out as an expense, and ignores non-transactions', () => {
        const plan = planBulk([item({ suggested_target: 'review', category: null, amount: 95 }), item({ suggested_target: 'ignore', amount: 5 })], none);
        expect(plan.find(a => a.item.amount === 95)).toMatchObject({ kind: 'post', target: 'expense', category: 'other' });
        expect(plan.find(a => a.item.amount === 5)?.kind).toBe('ignore');
    });
});
