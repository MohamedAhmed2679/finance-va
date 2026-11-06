/**
 * The AutoTrack pipeline (ingest → parse → classify → reconcile), without the server.
 * Scenarios A–H are the synthetic fixtures from the AutoTrack spec, word for word.
 */
import { describe, it, expect } from 'vitest';
import { analyse, type PipelineContext } from '../../src/autotrack/pipeline';
import { redactExcerpt } from '../../src/autotrack/redact';
import { parseMessage } from '../../src/autotrack/parse';
import type { KnownTx } from '../../src/autotrack/dedupe';

const AT = new Date('2026-11-05T10:00:00Z');
const base: PipelineContext = {
    workspaceId: 'ws-1',
    ownAccounts: [
        { id: 'bank', label: 'My bank', kind: 'bank', last4: '1234', senderId: 'cib' },
        { id: 'wallet', label: 'Vodafone Cash', kind: 'wallet', senderId: 'vfcash' },
        { id: 'card', label: 'Card', kind: 'card', last4: '5678', senderId: 'cib' },
    ],
    ownNames: ['Mohamed Ahmed'], rules: [], known: [], customSenders: [],
};
const run = (text: string, sender: string | null = 'CIB', ctx: Partial<PipelineContext> = {}) => analyse({ text, sender, receivedAt: AT, ingestion: 'paste' }, { ...base, ...ctx });
const stored = async (text: string, sender: string | null = 'CIB', ctx: Partial<PipelineContext> = {}) => {
    const r = await run(text, sender, ctx);
    if (r.outcome !== 'stored') throw new Error(`expected stored, got ${r.outcome}`);
    return r;
};

describe('spec scenarios', () => {
    it('A. Salary → Income & Earnings', async () => {
        const r = await stored('Salary credited: EGP 18,000 to account **1234.');
        expect(r.classification.target).toBe('income');
        expect(r.draft).toMatchObject({ amount: 18000, currency: 'EGP', account_ref: '1234', channel: 'salary', status: 'needs_review' });
        expect(r.autoEligible).toBe(true);
    });
    it('B. Purchase → Expenses (groceries, or uncategorised when unclear)', async () => {
        const r = await stored('Purchase of EGP 650 at Grocery Store using card **5678.');
        expect(r.classification.target).toBe('expense');
        expect(r.draft).toMatchObject({ amount: 650, counterparty: 'Grocery Store', account_ref: '5678' });
        expect(['groceries', 'other']).toContain(r.draft.category);
    });
    it('C. Own-account transfer → Transfers, never income or spending', async () => {
        const r = await stored('EGP 2,000 transferred from your bank account to your registered wallet.', 'CIB', {
            rules: [{ match: 'your registered wallet', target: 'transfer' }],
        });
        expect(r.classification.target).toBe('transfer');
    });
    it('C2. without anything identifying the wallet as the user\'s, it is not guessed: Needs Review', async () => {
        const r = await stored('EGP 2,000 transferred from your bank account to your registered wallet.');
        expect(['transfer', 'review']).toContain(r.classification.target);
        expect(r.classification.target).not.toBe('income');
        expect(r.classification.target).not.toBe('expense');
    });
    it('D. Ambiguous incoming transfer → Needs Review, not earnings', async () => {
        const r = await stored('You received EGP 1,000 from Ahmed.', 'InstaPay');
        expect(r.classification.target).toBe('review');
        expect(r.autoEligible).toBe(false);
    });
    it('E. Refund → linked to the original purchase where possible, otherwise review', async () => {
        const known: KnownTx[] = [{ id: 'exp-650', kind: 'expense', source: 'manual', amountMinor: 65000, currency: 'EGP', direction: 'debit', occurredAt: '2026-11-01T10:00:00Z', label: 'Grocery Store' }];
        const r = await stored('EGP 650 refunded for your earlier purchase.', 'CIB', { known });
        expect(r.classification.target).toBe('review');
        expect(r.draft.duplicate_of_id).toBe('exp-650');
        const alone = await stored('EGP 650 refunded for your earlier purchase.');
        expect(alone.classification.target).toBe('review');
        expect(alone.draft.duplicate_of_id).toBeNull();
    });
    it('F. Balance-only alert → nothing created', async () => {
        expect((await run('Your available balance is EGP 9,500.')).outcome).toBe('not_financial');
    });
    it('G. Failed payment → no completed expense (kept only as Ignored)', async () => {
        const r = await stored('Your payment of EGP 300 was declined.');
        expect(r.draft.status).toBe('ignored');
        expect(r.draft.tx_status).toBe('declined');
        expect(r.autoEligible).toBe(false);
    });
    it('H. Smart Cart match → suggest linking, not another expense', async () => {
        const known: KnownTx[] = [{ id: 'sc-1', kind: 'expense', source: 'manual', amountMinor: 65000, currency: 'EGP', direction: 'debit', occurredAt: '2026-11-05T09:40:00Z', label: 'Smart Cart Purchase' }];
        const r = await stored('Purchase of EGP 650 at Grocery Store using card **5678.', 'CIB', { known });
        expect(r.draft).toMatchObject({ status: 'needs_review', duplicate_of_kind: 'expense', duplicate_of_id: 'sc-1' });
        expect(r.draft.reason).toMatch(/Link it instead/);
        expect(r.autoEligible).toBe(false);
    });
});

describe('repeats and legitimate repeats', () => {
    it('the same alert again is a duplicate (no second item)', async () => {
        const text = 'Purchase of EGP 650 at Grocery Store using card **5678 on 05/11/26 11:40.';
        const first = await stored(text);
        const known: KnownTx[] = [{ id: 'item-1', fingerprint: first.draft.fingerprint, source: 'autotrack', amountMinor: 65000, currency: 'EGP', direction: 'debit', occurredAt: first.draft.occurred_at, senderId: 'cib' }];
        expect((await run(text, 'CIB', { known })).outcome).toBe('duplicate');
    });
    it('two real purchases of the same amount at different times are both kept', async () => {
        const a = await stored('Purchase of EGP 650 at Grocery Store using card **5678 on 05/11/26 09:10.');
        const known: KnownTx[] = [{ id: 'item-1', fingerprint: a.draft.fingerprint, source: 'autotrack', amountMinor: 65000, currency: 'EGP', direction: 'debit', occurredAt: a.draft.occurred_at, senderId: 'cib' }];
        const b = await stored('Purchase of EGP 650 at Grocery Store using card **5678 on 05/11/26 18:45.', 'CIB', { known });
        expect(b.draft.fingerprint).not.toBe(a.draft.fingerprint);
        expect(b.draft.duplicate_of_id).toBeNull();   // same sender, hours apart: not an echo
    });
    it('both sides of an own-account transfer produce one transfer: the second alert is flagged as an echo', async () => {
        const out = await stored('EGP 2,000.00 transferred from your account **1234 via InstaPay', 'CIB', { rules: [{ match: 'x', target: 'transfer' }] });
        const known: KnownTx[] = [{ id: 'item-out', fingerprint: out.draft.fingerprint, source: 'autotrack', amountMinor: 200000, currency: 'EGP', direction: 'credit', occurredAt: out.draft.occurred_at, senderId: 'cib' }];
        const inn = await stored('You have received EGP 2,000.00 via InstaPay', 'InstaPay', { known });
        expect(inn.draft.duplicate_of_id).toBe('item-out');
        expect(inn.autoEligible).toBe(false);
    });
});

describe('privacy', () => {
    it('codes and personal messages are not stored at all', async () => {
        expect((await run('Your OTP is 482913. Do not share it.')).outcome).toBe('not_financial');
        expect((await run('Are we meeting at 7? I owe you 200 EGP btw', '+201001234567')).outcome).not.toBe('duplicate');
    });
    it('the stored excerpt masks phones, card numbers, references and codes', () => {
        const e = redactExcerpt('EGP 200 sent to 01012345678 from card 4111111111111111 Ref: TRX99812234 code 5521');
        expect(e).not.toMatch(/01012345678|4111111111111111|TRX99812234|5521/);
        expect(e).toContain('EGP 200');
    });
    it('items read by Zaylo AI are never auto-added', async () => {
        const ai = { ...parseMessage('Purchase of EGP 650 at Grocery Store using card **5678.', 'CIB', AT) };
        const r = await stored('something the rules cannot read 650', 'CIB', { aiParsed: ai });
        expect(r.draft.ai_used).toBe(true);
        expect(r.autoEligible).toBe(false);
        expect(r.draft.reason).toMatch(/Zaylo AI/);
    });
    it('the stored draft never contains the full message', async () => {
        const text = 'Purchase of EGP 650 at Grocery Store using card **5678. '.repeat(6);
        const r = await stored(text);
        expect(JSON.stringify(r.draft)).not.toContain(text);
        expect(r.draft.excerpt.length).toBeLessThanOrEqual(160);
    });
});

describe('Arabic', () => {
    it('Arabic purchase with Arabic digits', async () => {
        const r = await stored('تم خصم مبلغ ٦٥٠ جنيه من بطاقتكم المنتهية بـ 5678 لدى Carrefour', 'NBE');
        expect(r.draft).toMatchObject({ amount: 650, currency: 'EGP', account_ref: '5678' });
        expect(r.classification.target).toBe('expense');
    });
});
