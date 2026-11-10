/**
 * The price-tag endpoint with Supabase auth and Gemini replaced by local fakes
 * (no network, no real AI): checks validation, auth, limits and failure handling.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.VITE_SUPABASE_URL = 'https://sb.test';
process.env.VITE_SUPABASE_ANON_KEY = 'anon';
process.env.GEMINI_API_KEY = 'test-key';

let geminiReply: unknown = null;
let geminiStatus = 200;
let geminiCalls = 0;
vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (u.startsWith('https://sb.test/auth/v1/user')) {
        const auth = (init.headers as Record<string, string>).Authorization;
        return new Response(JSON.stringify(auth.startsWith('Bearer user-') ? { id: auth.slice(7) } : {}), { status: auth.startsWith('Bearer user-') ? 200 : 401 });
    }
    if (u.includes('/rest/v1/consent_events')) return new Response(JSON.stringify([{ granted: true }]), { status: 200 }); // this person allowed AI
    if (u.includes('generativelanguage.googleapis.com')) {
        geminiCalls++;
        if (geminiStatus !== 200) return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: geminiStatus });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof geminiReply === 'string' ? geminiReply : JSON.stringify(geminiReply) }] } }] }), { status: 200 });
    }
    throw new Error('unexpected fetch ' + u);
});

const { POST } = await import('../../api/ai/zaylo');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64');
const call = (body: object, token = 'user-1') => POST(new Request('https://zaylo.cc/api/ai/zaylo', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'price_tag', cartCurrency: 'EGP', ...body }) }));

beforeEach(() => { geminiStatus = 200; geminiCalls = 0; geminiReply = { readable: true, products: [{ name: 'Milk', prices: [{ text: '34.95', kind: 'package', currencyText: 'EGP' }] }] }; });

describe('POST price_tag', () => {
    it('requires a signed-in user', async () => {
        expect((await call({ image: { mime: 'image/jpeg', data: JPEG } }, 'nope')).status).toBe(401);
    });
    it('returns a reviewable item for a readable tag', async () => {
        const r = await call({ image: { mime: 'image/jpeg', data: JPEG } });
        const body = await r.json();
        expect(r.status).toBe(200);
        expect(body.status).toBe('ok');
        expect(body.candidates[0].packageOptions[0].minor).toBe(3495);
    });
    it('rejects non-image types and files that only claim to be images', async () => {
        expect((await call({ image: { mime: 'image/svg+xml', data: JPEG } })).status).toBe(415);
        const svg = Buffer.from('<svg onload="alert(1)"/>').toString('base64');
        expect((await call({ image: { mime: 'image/jpeg', data: svg } })).status).toBe(415);
        expect(geminiCalls).toBe(0);
    });
    it('rejects oversized images before calling the AI', async () => {
        const big = Buffer.alloc(3 * 1024 * 1024 + 10, 1); big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
        expect((await call({ image: { mime: 'image/jpeg', data: big.toString('base64') } })).status).toBe(413);
        expect(geminiCalls).toBe(0);
    });
    it('an unreadable photo comes back as unreadable, not as a made-up item', async () => {
        geminiReply = { readable: false, note: 'Too dark to read.', products: [] };
        const body = await (await call({ image: { mime: 'image/jpeg', data: JPEG } }, 'user-2')).json();
        expect(body).toMatchObject({ status: 'unreadable', candidates: [] });
    });
    it('a broken AI answer is an error the app can retry, not an item', async () => {
        geminiReply = 'not json at all';
        expect((await call({ image: { mime: 'image/jpeg', data: JPEG } }, 'user-3')).status).toBe(502);
    });
    it('AI outages surface as errors', async () => {
        geminiStatus = 400;
        expect((await call({ image: { mime: 'image/jpeg', data: JPEG } }, 'user-4')).status).toBeGreaterThanOrEqual(500);
    });
    it('limits how many scans one account can run in a short time', async () => {
        let last = 200;
        for (let i = 0; i < 41; i++) last = (await call({ image: { mime: 'image/jpeg', data: JPEG } }, 'user-5')).status;
        expect(last).toBe(429);
    });
});
