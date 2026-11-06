/** Zaylo AI reading of an unfamiliar SMS (action sms_extract), with Gemini and Supabase replaced by local fakes. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.VITE_SUPABASE_URL = 'https://sb.test';
process.env.VITE_SUPABASE_ANON_KEY = 'anon';
process.env.GEMINI_API_KEY = 'test-key';

let geminiReply: unknown = null;
let geminiCalls: string[] = [];
vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (u.startsWith('https://sb.test/auth/v1/user')) {
        const auth = (init.headers as Record<string, string>).Authorization;
        return new Response(JSON.stringify(auth.startsWith('Bearer user-') ? { id: auth.slice(7) } : {}), { status: auth.startsWith('Bearer user-') ? 200 : 401 });
    }
    if (u.includes('generativelanguage.googleapis.com')) {
        geminiCalls.push(String(init.body));
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply) }] } }] }), { status: 200 });
    }
    throw new Error('unexpected fetch ' + u);
});
const { POST } = await import('../../api/ai/zaylo');
const call = (text: string, token = 'user-ai') => POST(new Request('https://zaylo.cc/api/ai/zaylo', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sms_extract', text, sender: 'MyBank', receivedAt: '2026-11-05T10:00:00Z' }) }));

beforeEach(() => {
    geminiCalls = [];
    geminiReply = { is_transaction: true, direction: 'debit', status: 'completed', channel: 'card_purchase', amount: '1,250.50', currency: 'EGP', counterparty: 'SOME SHOP', account_last_digits: '4821', reference: '' };
});

describe('POST sms_extract', () => {
    it('requires a signed-in user', async () => { expect((await call('anything', 'nope')).status).toBe(401); });
    it('never sends a security code to the AI', async () => {
        const body = await (await call('Your OTP is 482913, do not share')).json();
        expect(body.parsed).toBeNull();
        expect(geminiCalls).toHaveLength(0);
    });
    it('returns structured fields marked for review, amounts parsed exactly', async () => {
        const body = await (await call('Strange format: SOME SHOP 1,250.50 EGP card 4821 ok')).json();
        expect(body.parsed).toMatchObject({ kind: 'transaction', direction: 'debit', amountMinor: 125050, currency: 'EGP', accountRef: '4821', confidence: 0.5 });
        expect(body.parsed.issues[0]).toMatch(/Read by Zaylo AI/);
        expect(geminiCalls[0]).toContain('untrusted data');
    });
    it('does not fill in what the AI could not read', async () => {
        geminiReply = { ...(geminiReply as object), amount: '', currency: '' };
        const body = await (await call('Strange format with no amount')).json();
        expect(body.parsed).toMatchObject({ amountMinor: null, currency: null });
        expect(body.parsed.issues.join(' ')).toMatch(/amount couldn't be read/);
    });
    it('"not a transaction" stays not a transaction', async () => {
        geminiReply = { ...(geminiReply as object), is_transaction: false };
        expect((await (await call('Happy holidays from your bank')).json()).parsed).toBeNull();
    });
});
