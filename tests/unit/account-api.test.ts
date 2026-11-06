/**
 * The account-deletion endpoint with Supabase replaced by a local fake (no network):
 * nothing is deleted unless the right person types the right confirmation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.VITE_SUPABASE_URL = 'https://sb.test';
process.env.VITE_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-fixture';

let calls: { url: string; method: string; body: unknown }[] = [];
let rpcStatus = 200;
let authDeleteStatus = 200;
const users: Record<string, { id: string; email: string | null; phone: string | null }> = {
    'token-ann': { id: 'auth-ann', email: 'Ann@Example.test', phone: null },
    'token-phone': { id: 'auth-phone', email: null, phone: '+201000000000' },
};
vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    calls.push({ url: u, method, body: init.body ? JSON.parse(String(init.body)) : null });
    const headers = init.headers as Record<string, string>;
    if (u === 'https://sb.test/auth/v1/user') {
        const who = users[headers.Authorization.replace('Bearer ', '')];
        return new Response(JSON.stringify(who || {}), { status: who ? 200 : 401 });
    }
    if (u.endsWith('/rest/v1/rpc/delete_account_data')) {
        expect(headers.Authorization).toBe('Bearer service-fixture');
        if (rpcStatus !== 200) return new Response('{"message":"boom"}', { status: rpcStatus });
        return new Response(JSON.stringify({ deleted: true, workspacesDeleted: 1, workspacesTransferred: 1, storagePaths: ['smart-cart/auth-ann/c/a.jpg', 'chat-attachments/auth-ann/x.pdf'] }), { status: 200 });
    }
    if (u.includes('/storage/v1/object/')) return new Response('[]', { status: 200 });
    if (u.includes('/auth/v1/admin/users/')) return new Response('{}', { status: authDeleteStatus });
    throw new Error('unexpected fetch ' + u);
});

const { POST } = await import('../../api/account');
const call = (body: object, token = 'token-ann') => POST(new Request('https://zaylo.cc/api/account', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const deletes = () => calls.filter(c => c.url.endsWith('delete_account_data') || c.url.includes('/admin/users/'));

beforeEach(() => { calls = []; rpcStatus = 200; authDeleteStatus = 200; });

describe('POST /api/account delete', () => {
    it('needs a signed-in person', async () => {
        expect((await call({ action: 'delete', confirm: 'ann@example.test' }, 'stolen')).status).toBe(401);
        expect(deletes()).toEqual([]);
    });
    it('needs the exact email typed (any letter case)', async () => {
        for (const confirm of ['', 'ann@example', 'someone@else.test', 'DELETE']) {
            const r = await call({ action: 'delete', confirm });
            expect(r.status).toBe(400);
        }
        expect(deletes()).toEqual([]);
    });
    it('phone-only accounts type DELETE', async () => {
        expect((await call({ action: 'delete', confirm: 'delete' }, 'token-phone')).status).toBe(400);
        expect((await call({ action: 'delete', confirm: 'DELETE' }, 'token-phone')).status).toBe(200);
    });
    it('deletes the data, the files and the sign-in, for the caller only', async () => {
        const r = await call({ action: 'delete', confirm: '  ANN@example.test ' });
        expect(r.status).toBe(200);
        expect(await r.json()).toMatchObject({ deleted: true, signInRemoved: true, workspacesDeleted: 1, workspacesTransferred: 1 });
        expect(calls.find(c => c.url.endsWith('delete_account_data'))?.body).toEqual({ p_auth_id: 'auth-ann' });
        const storage = calls.filter(c => c.url.includes('/storage/v1/object/'));
        expect(storage.map(c => [c.url.split('/object/')[1], c.body])).toEqual([['smart-cart', { prefixes: ['auth-ann/c/a.jpg'] }], ['chat-attachments', { prefixes: ['auth-ann/x.pdf'] }]]);
        expect(calls.some(c => c.method === 'DELETE' && c.url === 'https://sb.test/auth/v1/admin/users/auth-ann')).toBe(true);
    });
    it('if the database step fails, the sign-in is not deleted', async () => {
        rpcStatus = 500;
        const r = await call({ action: 'delete', confirm: 'ann@example.test' });
        expect(r.status).toBe(500);
        expect(calls.some(c => c.url.includes('/admin/users/'))).toBe(false);
    });
    it('says so if the sign-in could not be removed after the data was', async () => {
        authDeleteStatus = 500;
        const body = await (await call({ action: 'delete', confirm: 'ann@example.test' })).json();
        expect(body).toMatchObject({ deleted: true, signInRemoved: false });
        expect(body.warning).toContain('support@zaylo.cc');
    });
});
