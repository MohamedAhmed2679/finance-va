/**
 * The AI endpoint must not send anything to the AI provider unless the caller's latest
 * consent record says yes. Supabase and Gemini are local fakes (no network, no real AI).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.VITE_SUPABASE_URL = 'https://sb.test';
process.env.VITE_SUPABASE_ANON_KEY = 'anon';
process.env.GEMINI_API_KEY = 'test-key';

let consent: { status: number; body: unknown } | 'network-error' = { status: 200, body: [{ granted: true }] };
let geminiCalls = 0;
let consentAuth = '';
vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    const auth = (init.headers as Record<string, string>)?.Authorization || '';
    if (u.startsWith('https://sb.test/auth/v1/user')) return new Response(JSON.stringify(auth.startsWith('Bearer user-') ? { id: auth.slice(7) } : {}), { status: auth.startsWith('Bearer user-') ? 200 : 401 });
    if (u.includes('/rest/v1/consent_events')) {
        consentAuth = auth;
        if (consent === 'network-error') throw new Error('socket hang up');
        return new Response(JSON.stringify(consent.body), { status: consent.status });
    }
    if (u.includes('generativelanguage.googleapis.com')) {
        geminiCalls++;
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello from the fake model.' }] } }] }), { status: 200 });
    }
    throw new Error('unexpected fetch ' + u);
});

const { POST } = await import('../../api/ai/zaylo');
const call = (body: object, token = 'user-consent-1') => POST(new Request('https://zaylo.cc/api/ai/zaylo', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const chat = { action: 'chat', messages: [{ role: 'user', text: 'How do I add a bill?' }], snapshot: { currency: 'EGP' } };

beforeEach(() => { consent = { status: 200, body: [{ granted: true }] }; geminiCalls = 0; consentAuth = ''; });

describe('AI consent is enforced on the server', () => {
    it('answers when the latest record says yes, checking with the caller\'s own token', async () => {
        const r = await call(chat);
        expect(r.status).toBe(200);
        expect(geminiCalls).toBe(1);
        expect(consentAuth).toBe('Bearer user-consent-1');
    });
    it('sends nothing when there is no record', async () => {
        consent = { status: 200, body: [] };
        const r = await call(chat);
        expect(r.status).toBe(403);
        expect((await r.json()).code).toBe('ai_consent_required');
        expect(geminiCalls).toBe(0);
    });
    it('sends nothing after consent is withdrawn', async () => {
        consent = { status: 200, body: [{ granted: false }] };
        expect((await call(chat)).status).toBe(403);
        expect(geminiCalls).toBe(0);
    });
    it('applies to every action that sends data', async () => {
        consent = { status: 200, body: [] };
        for (const action of ['chat', 'insights', 'extract', 'price_tag', 'sms_extract']) expect((await call({ ...chat, action, text: 'x' })).status).toBe(403);
        expect(geminiCalls).toBe(0);
    });
    it('fails closed when the record can\'t be read', async () => {
        consent = { status: 500, body: { message: 'boom' } };
        expect((await call(chat)).status).toBe(503);
        consent = 'network-error';
        expect((await call(chat)).status).toBe(503);
        consent = { status: 200, body: { not: 'a list' } };
        expect((await call(chat)).status).toBe(503);
        expect(geminiCalls).toBe(0);
    });
    it('keeps working on a database that doesn\'t have the consent table yet', async () => {
        consent = { status: 404, body: { code: 'PGRST205', message: 'Could not find the table' } };
        expect((await call(chat)).status).toBe(200);
        expect(geminiCalls).toBe(1);
    });
    it('lets the status check through without consent (it sends no data)', async () => {
        consent = { status: 200, body: [] };
        expect((await call({ action: 'status' })).status).toBe(200);
        expect(geminiCalls).toBe(0);
    });
    it('still requires sign-in first', async () => {
        expect((await call(chat, 'nope')).status).toBe(401);
        expect(geminiCalls).toBe(0);
    });
});
