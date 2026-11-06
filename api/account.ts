/**
 * Account deletion.
 *
 *   POST /api/account  Authorization: Bearer <Supabase access token>
 *     { action: 'delete', confirm: '<the account's email, or DELETE for phone-only accounts>' }
 *
 * Steps: check the token with Supabase Auth → public.delete_account_data (one transaction) →
 * delete the person's files from Storage → delete the sign-in account. Nothing happens unless the
 * confirmation text matches.
 *
 * Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */
export const config = { maxDuration: 30 };

type Row = Record<string, unknown>;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const SB_URL = () => process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON = () => process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const admin = (extra: Record<string, string> = {}) => ({ apikey: SERVICE(), Authorization: `Bearer ${SERVICE()}`, 'Content-Type': 'application/json', ...extra });

/** The signed-in person behind the bearer token, as Supabase Auth sees it. */
async function caller(req: Request): Promise<{ id: string; email: string | null; phone: string | null } | null> {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || !SB_URL()) return null;
    const r = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: ANON(), Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id, email: u.email || null, phone: u.phone || null } : null;
}

/** What the person must type to confirm. */
export const confirmationFor = (u: { email: string | null }) => (u.email ? u.email.trim().toLowerCase() : 'DELETE');

async function removeFiles(paths: string[]) {
    const byBucket = new Map<string, string[]>();
    for (const p of paths) {
        const i = p.indexOf('/');
        if (i > 0) byBucket.set(p.slice(0, i), [...(byBucket.get(p.slice(0, i)) || []), p.slice(i + 1)]);
    }
    let removed = 0;
    for (const [bucket, names] of byBucket) {
        for (let i = 0; i < names.length; i += 100) {
            const chunk = names.slice(i, i + 100);
            const r = await fetch(`${SB_URL()}/storage/v1/object/${encodeURIComponent(bucket)}`, { method: 'DELETE', headers: admin(), body: JSON.stringify({ prefixes: chunk }) });
            if (r.ok) removed += chunk.length;
        }
    }
    return removed;
}

async function deleteAccount(req: Request) {
    const me = await caller(req);
    if (!me) return json({ error: 'Sign in again, then try deleting your account.' }, 401);
    const body: Row = await req.json().catch(() => ({}));
    if (body.action !== 'delete') return json({ error: 'Unknown action' }, 400);
    const expected = confirmationFor(me);
    const typed = String(body.confirm || '').trim();
    if ((expected === 'DELETE' ? typed : typed.toLowerCase()) !== expected) {
        return json({ error: expected === 'DELETE' ? 'Type DELETE to confirm.' : 'Type your email address exactly to confirm.' }, 400);
    }
    if (!SERVICE()) return json({ error: 'Account deletion isn\'t available right now. Try again later.' }, 503);

    const r = await fetch(`${SB_URL()}/rest/v1/rpc/delete_account_data`, { method: 'POST', headers: admin(), body: JSON.stringify({ p_auth_id: me.id }) });
    const text = await r.text();
    if (!r.ok) {
        console.error('[account] delete_account_data failed', r.status, text.slice(0, 300));
        const missing = /delete_account_data|PGRST202|schema cache/i.test(text);
        return json({ error: missing ? 'Account deletion needs the latest database update.' : 'Couldn\'t delete your account. Nothing was changed. Try again.' }, missing ? 503 : 500);
    }
    const result: Row = JSON.parse(text || '{}');
    const filesRemoved = await removeFiles(Array.isArray(result.storagePaths) ? result.storagePaths : []).catch(() => 0);

    // Finally the sign-in account itself, so the email or phone can't be used to sign back in
    const del = await fetch(`${SB_URL()}/auth/v1/admin/users/${me.id}`, { method: 'DELETE', headers: admin() });
    if (!del.ok && del.status !== 404) {
        console.error('[account] auth user delete failed', del.status);
        return json({ deleted: true, signInRemoved: false, workspacesDeleted: result.workspacesDeleted ?? 0, workspacesTransferred: result.workspacesTransferred ?? 0, filesRemoved,
            warning: 'Your data was deleted, but your sign-in couldn\'t be removed yet. Contact support@zaylo.cc and we\'ll finish it.' });
    }
    return json({ deleted: true, signInRemoved: true, workspacesDeleted: result.workspacesDeleted ?? 0, workspacesTransferred: result.workspacesTransferred ?? 0, filesRemoved });
}

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
export async function POST(req: Request) {
    try { return await deleteAccount(req); } catch (e) { console.error('[account]', e); return json({ error: 'Couldn\'t delete your account. Try again.' }, 500); }
}
