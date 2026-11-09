/**
 * Zaylo monthly cloud backups (Google Drive, Microsoft OneDrive) and backup files for the apps.
 *
 *   POST /api/backup  Authorization: Bearer <Supabase access token>
 *     { action: 'status' }                         providers set up on the server + this user's connections
 *     { action: 'connect', provider }              → { url } to sign in with Google / Microsoft
 *     { action: 'disconnect', provider }
 *     { action: 'backup_now', provider? }          upload a backup right now (to every connection, or one)
 *     { action: 'export' }                         → backup files as base64 (desktop iCloud / iPhone Files)
 *   GET  /api/backup?code=…&state=…                OAuth redirect (the redirect URI to register is https://zaylo.cc/api/backup)
 *   GET  /api/backup?cron=monthly                  daily: back up last month for every connection that hasn't had it yet
 *
 * Each backup is two files in "Zaylo Backups" (Google Drive) or Apps/Zaylo (OneDrive):
 *   Zaylo backup YYYY-MM.xlsx  — everything ever recorded, every workspace, every section
 *   Zaylo report YYYY-MM.pdf   — that month's report
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
 *      GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET, MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET,
 *      PUBLIC_APP_URL (optional, default https://zaylo.cc), CRON_SECRET (set by Vercel for crons).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { buildPdf, buildXlsx, type ReportInput, type ReportWorkspace } from '../src/reports/report';
import { PLEX_REGULAR, PLEX_SEMIBOLD } from '../src/reports/reportFonts';
import { AR } from '../src/i18n/ar';
import type { Expense, Income, MonthlyBill } from '../src/store/useStore';

export const config = { maxDuration: 60 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- database rows have a different shape per table
type Row = Record<string, any>;
type Provider = 'google' | 'microsoft';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SB_URL = () => process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const APP_URL = () => (process.env.PUBLIC_APP_URL || 'https://zaylo.cc').replace(/\/$/, '');
const REDIRECT = () => `${APP_URL()}/api/backup`;
const FOLDER = 'Zaylo Backups';
const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };

const CREDS: Record<Provider, () => { id?: string; secret?: string }> = {
    google: () => ({ id: process.env.GOOGLE_DRIVE_CLIENT_ID, secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET }),
    microsoft: () => ({ id: process.env.MICROSOFT_CLIENT_ID, secret: process.env.MICROSOFT_CLIENT_SECRET }),
};
const configured = (p: Provider) => Boolean(CREDS[p]().id && CREDS[p]().secret);
const isProvider = (p: unknown): p is Provider => p === 'google' || p === 'microsoft';

// ------------------------------------------------------------------ database

async function db(path: string, init: RequestInit = {}) {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
        ...init,
        headers: { apikey: SERVICE(), Authorization: `Bearer ${SERVICE()}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DB ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
}
/** Reads every row (PostgREST returns at most 1000 per request). */
async function dbAll(path: string): Promise<Row[]> {
    const out: Row[] = [];
    for (let offset = 0; ; offset += 1000) {
        const page: Row[] = await db(`${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${offset}`);
        out.push(...page);
        if (page.length < 1000) return out;
    }
}

async function caller(req: Request): Promise<Row | null> {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
    if (!token || !SB_URL()) return null;
    const r = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    const rows = await db(`users?auth_id=eq.${u.id}&select=id,name,email,language,default_currency`);
    return rows?.[0] || null;
}

// ------------------------------------------------------------------ secrets

const key = () => createHash('sha256').update(`zaylo-cloud-tokens-v1:${SERVICE()}`).digest();
function seal(plain: string) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key(), iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function unseal(sealed: string) {
    const b = Buffer.from(sealed, 'base64');
    const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = (s: string) => b64url(createHmac('sha256', key()).update(`state:${s}`).digest());
function makeState(userId: string, provider: Provider, back: string) {
    const body = b64url(JSON.stringify({ u: userId, p: provider, t: Date.now(), n: b64url(randomBytes(9)), b: back }));
    return `${body}.${sign(body)}`;
}
function readState(state: string): { u: string; p: Provider; t: number; b: string } | null {
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const want = Buffer.from(sign(body)), got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const s = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!isProvider(s.p) || Date.now() - s.t > 20 * 60_000) return null;
    return s;
}

// ------------------------------------------------------------------ providers

const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
const MS_SCOPE = 'offline_access openid email User.Read Files.ReadWrite.AppFolder';
const MS_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';

function authUrl(p: Provider, state: string) {
    const { id } = CREDS[p]();
    if (p === 'google') {
        return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
            client_id: id!, redirect_uri: REDIRECT(), response_type: 'code', scope: GOOGLE_SCOPE,
            access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
        });
    }
    return `${MS_BASE}/authorize?` + new URLSearchParams({
        client_id: id!, redirect_uri: REDIRECT(), response_type: 'code', scope: MS_SCOPE, response_mode: 'query', prompt: 'select_account', state,
    });
}

async function tokenRequest(p: Provider, params: Record<string, string>) {
    const { id, secret } = CREDS[p]();
    const url = p === 'google' ? 'https://oauth2.googleapis.com/token' : `${MS_BASE}/token`;
    const body = new URLSearchParams({ client_id: id!, client_secret: secret!, ...params, ...(p === 'microsoft' ? { scope: MS_SCOPE } : {}) });
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) {
        const err = new Error(data.error_description || data.error || `Token request failed (${r.status})`);
        (err as Error & { revoked?: boolean }).revoked = data.error === 'invalid_grant';
        throw err;
    }
    return data as { access_token: string; refresh_token?: string; id_token?: string };
}

function emailFromIdToken(idToken?: string) {
    try { return JSON.parse(Buffer.from(idToken!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).email || null; }
    catch { return null; }
}

/** A fresh access token for a stored connection (Microsoft also rotates the refresh token). */
async function accessFor(conn: Row) {
    const t = await tokenRequest(conn.provider, { grant_type: 'refresh_token', refresh_token: unseal(conn.refresh_token_enc) });
    if (t.refresh_token) await db(`cloud_connections?id=eq.${conn.id}`, { method: 'PATCH', body: JSON.stringify({ refresh_token_enc: seal(t.refresh_token) }) }).catch(() => {});
    return t.access_token;
}

interface OutFile { name: string; mime: string; bytes: Uint8Array }

async function googleFolder(token: string, conn: Row) {
    const H = { Authorization: `Bearer ${token}` };
    if (conn.folder_id) {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${conn.folder_id}?fields=id,trashed`, { headers: H });
        if (r.ok && !(await r.json()).trashed) return conn.folder_id as string;
    }
    const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    });
    if (!r.ok) throw new Error(`Google Drive: couldn't create the "${FOLDER}" folder (${r.status})`);
    const { id } = await r.json();
    await db(`cloud_connections?id=eq.${conn.id}`, { method: 'PATCH', body: JSON.stringify({ folder_id: id }) });
    return id as string;
}

async function uploadGoogle(token: string, conn: Row, files: OutFile[]) {
    const H = { Authorization: `Bearer ${token}` };
    const folder = await googleFolder(token, conn);
    const out: { name: string; url: string }[] = [];
    for (const f of files) {
        const q = encodeURIComponent(`name = '${f.name.replace(/'/g, "\\'")}' and '${folder}' in parents and trashed = false`);
        const found = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: H }).then(r => r.json()).catch(() => ({}));
        const existing = found.files?.[0]?.id;
        // Resumable upload: one request for the metadata, one for the bytes
        const start = await fetch(existing
            ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=resumable&fields=id,webViewLink`
            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
            method: existing ? 'PATCH' : 'POST',
            headers: { ...H, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': f.mime, 'X-Upload-Content-Length': String(f.bytes.length) },
            body: JSON.stringify(existing ? {} : { name: f.name, parents: [folder], mimeType: f.mime }),
        });
        const loc = start.headers.get('location');
        if (!start.ok || !loc) throw new Error(`Google Drive upload failed (${start.status})`);
        const put = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': f.mime }, body: f.bytes as BodyInit });
        if (!put.ok) throw new Error(`Google Drive upload failed (${put.status})`);
        const meta = await put.json();
        out.push({ name: f.name, url: meta.webViewLink || `https://drive.google.com/drive/folders/${folder}` });
    }
    return out;
}

async function uploadMicrosoft(token: string, files: OutFile[]) {
    const H = { Authorization: `Bearer ${token}` };
    const out: { name: string; url: string }[] = [];
    for (const f of files) {
        const path = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(f.name)}`;
        let meta: Row;
        if (f.bytes.length < 4 * 1024 * 1024) {
            const r = await fetch(`${path}:/content?@microsoft.graph.conflictBehavior=replace`, { method: 'PUT', headers: { ...H, 'Content-Type': f.mime }, body: f.bytes as BodyInit });
            if (!r.ok) throw new Error(`OneDrive upload failed (${r.status})`);
            meta = await r.json();
        } else {
            const s = await fetch(`${path}:/createUploadSession`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) });
            if (!s.ok) throw new Error(`OneDrive upload failed (${s.status})`);
            const { uploadUrl } = await s.json();
            const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(f.bytes.length), 'Content-Range': `bytes 0-${f.bytes.length - 1}/${f.bytes.length}` }, body: f.bytes as BodyInit });
            if (!r.ok) throw new Error(`OneDrive upload failed (${r.status})`);
            meta = await r.json();
        }
        out.push({ name: f.name, url: meta.webUrl || 'https://onedrive.live.com/' });
    }
    return out;
}

// ------------------------------------------------------------------ backup content

const CAT: Record<string, string> = { groceries: 'Groceries', dining: 'Dining', transport: 'Transport', shopping: 'Shopping', entertainment: 'Entertainment', utilities: 'Utilities', healthcare: 'Healthcare', travel: 'Travel', education: 'Education', savings: 'Savings', income: 'Income', other: 'Other' };
const PM: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank Transfer', wallet: 'Digital Wallet', other: 'Other' };
const humanize = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const fx = (r: Row) => ({ baseAmount: r.base_amount == null ? undefined : Number(r.base_amount), baseCurrency: r.base_currency || undefined, fxRate: r.fx_rate == null ? undefined : Number(r.fx_rate) });
const notDeleted = 'or=(is_deleted.is.null,is_deleted.eq.false)';

let ratesMemo: { at: number; rates: Record<string, number> } | null = null;
async function rates() {
    if (ratesMemo && Date.now() - ratesMemo.at < 6 * 3600_000) return ratesMemo.rates;
    try {
        const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const d = await r.json();
        if (d.rates) ratesMemo = { at: Date.now(), rates: d.rates };
    } catch { /* totals then skip entries without a saved rate */ }
    return ratesMemo?.rates || {};
}

async function loadWorkspaces(user: Row, lang: 'en' | 'ar'): Promise<ReportWorkspace[]> {
    const memberships: Row[] = await db(`workspace_members?user_id=eq.${user.id}&status=eq.active&select=workspace_id`);
    const ids = [...new Set(memberships.map(m => m.workspace_id))];
    const filter = ids.length ? `or=(owner_id.eq.${user.id},id.in.(${ids.join(',')}))` : `owner_id=eq.${user.id}`;
    const wss: Row[] = (await db(`workspaces?${filter}&select=id,name,currency,is_archived`)).filter((w: Row) => !w.is_archived);
    if (!wss.length) return [];
    const inWs = `workspace_id=in.(${wss.map(w => w.id).join(',')})`;
    const [exp, inc, bills, custom] = await Promise.all([
        dbAll(`expenses?${inWs}&${notDeleted}&select=*&order=purchased_at.asc`),
        dbAll(`incomes?${inWs}&${notDeleted}&select=*`),
        dbAll(`monthly_bills?${inWs}&${notDeleted}&select=*`),
        db(`custom_categories?user_id=eq.${user.id}&select=key,label`).catch(() => []),
    ]);
    const tr = (s: string) => (lang === 'ar' ? AR[s] || s : s);
    const cats: Record<string, string> = {};
    for (const [k, v] of Object.entries(CAT)) cats[k] = tr(v);
    for (const c of custom as Row[]) cats[c.key] = c.label;
    const methods = Object.fromEntries(Object.entries(PM).map(([k, v]) => [k, tr(v)]));
    const labelled = new Proxy(cats, { get: (t, k: string) => t[k] ?? humanize(String(k)) });

    return wss.map(w => ({
        name: w.name || 'Workspace',
        currency: w.currency || user.default_currency || 'USD',
        categoryLabels: labelled,
        methodLabels: methods,
        expenses: exp.filter(r => r.workspace_id === w.id).map((r): Expense => ({
            id: r.id, workspaceId: r.workspace_id, createdByUid: r.created_by || '', createdByName: r.created_by_name || '',
            createdAt: r.created_at || '', updatedAt: r.updated_at || '', purchaseAt: r.purchased_at || r.created_at || '',
            amount: Number(r.amount) || 0, currency: r.currency || 'USD', merchant: r.merchant || '', description: r.description || '',
            category: r.category || 'other', paymentMethod: r.payment_method || 'cash', tags: Array.isArray(r.tags) ? r.tags : [], notes: r.notes || '',
            source: 'manual', deleted: false, ...fx(r),
        })),
        incomes: inc.filter(r => r.workspace_id === w.id).map((r): Income => ({
            id: r.id, workspaceId: r.workspace_id, createdByUid: r.created_by || '', name: r.name || '', amount: Number(r.amount) || 0,
            currency: r.currency || 'USD', type: r.type === 'variable' ? 'variable' : 'fixed', date: r.income_date || r.date || r.created_at || '', createdAt: r.created_at || '', ...fx(r),
        })),
        bills: bills.filter(r => r.workspace_id === w.id).map((r): MonthlyBill => ({
            id: r.id, workspaceId: r.workspace_id, createdByUid: r.created_by || '', name: r.name || '', amount: Number(r.amount) || 0,
            currency: r.currency || 'USD', category: r.category || 'other', paymentMethod: r.payment_method || undefined,
            dueDate: Number(r.due_day) || 1, lastPaidMonth: r.last_paid_month || undefined, createdAt: r.created_at || '',
        })),
    }));
}

const monthName = (ym: string, lang: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const prevMonth = (d = new Date()) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); return x.toISOString().slice(0, 7); };

/** The two backup files for a month: everything as Excel, that month as PDF. */
async function backupFiles(user: Row, month: string): Promise<OutFile[]> {
    const lang: 'en' | 'ar' = user.language === 'ar' ? 'ar' : 'en';
    const workspaces = await loadWorkspaces(user, lang);
    const r = await rates();
    const convert = (a: number, f: string, t: string) => (r[f] && r[t] ? Math.round((a / r[f]) * r[t] * 100) / 100 : null);
    const base: Omit<ReportInput, 'periodLabel'> = { lang, owner: user.name || user.email || 'Zaylo', sections: ['expenses', 'bills', 'income'], workspaces, convert, generatedAt: new Date() };
    const all = await buildXlsx({ ...base, periodLabel: lang === 'ar' ? `كل السجلات حتى ${monthName(month, lang)}` : `Everything up to ${monthName(month, lang)}`, to: lastDay(month) });
    const pdf = await buildPdf({ ...base, periodLabel: monthName(month, lang), from: `${month}-01`, to: lastDay(month) }, { regular: PLEX_REGULAR, semibold: PLEX_SEMIBOLD });
    return [
        { name: `Zaylo backup ${month}.xlsx`, mime: MIME.xlsx, bytes: all },
        { name: `Zaylo report ${month}.pdf`, mime: MIME.pdf, bytes: pdf },
    ];
}

async function runBackup(conn: Row, user: Row, month: string, opts: { scheduled: boolean }) {
    try {
        const files = await backupFiles(user, month);
        const token = await accessFor(conn);
        const uploaded = conn.provider === 'google' ? await uploadGoogle(token, conn, files) : await uploadMicrosoft(token, files);
        const patch: Row = { last_backup_at: new Date().toISOString(), last_files: uploaded, last_error: null, updated_at: new Date().toISOString() };
        if (opts.scheduled) patch.last_backup_month = month;
        await db(`cloud_connections?id=eq.${conn.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
        if (opts.scheduled) {
            const where = conn.provider === 'google' ? 'Google Drive' : 'OneDrive';
            await db('notifications', {
                method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
                body: JSON.stringify({ user_id: user.id, type: 'backup', message: `Your ${monthName(month, 'en')} backup is saved to ${where}.`, dedupe_key: `backup:${conn.id}:${month}` }),
            }).catch(() => {});
        }
        return { ok: true, files: uploaded };
    } catch (e) {
        const err = e as Error & { revoked?: boolean };
        const msg = err.revoked ? 'Access was removed. Connect again to keep backing up.' : err.message.slice(0, 300);
        await db(`cloud_connections?id=eq.${conn.id}`, { method: 'PATCH', body: JSON.stringify({ last_error: msg, updated_at: new Date().toISOString(), ...(opts.scheduled && err.revoked ? { last_backup_month: month } : {}) }) }).catch(() => {});
        return { ok: false, error: msg };
    }
}

// ------------------------------------------------------------------ handlers

const publicConn = (c: Row) => ({ provider: c.provider, accountEmail: c.account_email, lastBackupAt: c.last_backup_at, lastBackupMonth: c.last_backup_month, lastFiles: c.last_files || [], lastError: c.last_error });

async function handlePost(req: Request) {
    if (!SERVICE()) return json({ error: 'Backups need SUPABASE_SERVICE_ROLE_KEY on the server.' }, 503);
    const me = await caller(req);
    if (!me) return json({ error: 'Sign in first' }, 401);
    const body = await req.json().catch(() => ({}));
    const providers = { google: configured('google'), microsoft: configured('microsoft') };

    if (body.action === 'export') {
        const month = typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month) ? body.month : new Date().toISOString().slice(0, 7);
        const files = await backupFiles(me, month);
        return json({ files: files.map(f => ({ name: f.name, mime: f.mime, base64: Buffer.from(f.bytes).toString('base64') })) });
    }

    let conns: Row[] = [];
    try { conns = await db(`cloud_connections?user_id=eq.${me.id}&select=*`); }
    catch (e) { if (/cloud_connections/.test((e as Error).message)) return json({ providers, connections: [], setupNeeded: 'database' }, body.action === 'status' ? 200 : 503); throw e; }

    switch (body.action) {
        case 'status':
            return json({ providers, connections: conns.map(publicConn) });
        case 'connect': {
            if (!isProvider(body.provider)) return json({ error: 'Unknown provider' }, 400);
            if (!configured(body.provider)) return json({ error: `${body.provider === 'google' ? 'Google Drive' : 'OneDrive'} isn't set up on the server yet.`, setupNeeded: body.provider }, 503);
            const back = typeof body.returnTo === 'string' && body.returnTo.startsWith('/') ? body.returnTo : '/settings';
            return json({ url: authUrl(body.provider, makeState(me.id, body.provider, back)) });
        }
        case 'disconnect': {
            const c = conns.find(x => x.provider === body.provider);
            if (c?.provider === 'google') await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(unseal(c.refresh_token_enc))}`, { method: 'POST' }).catch(() => {});
            if (c) await db(`cloud_connections?id=eq.${c.id}`, { method: 'DELETE' });
            return json({ ok: true });
        }
        case 'backup_now': {
            const targets = conns.filter(c => !body.provider || c.provider === body.provider);
            if (!targets.length) return json({ error: 'Connect Google Drive or OneDrive first.' }, 400);
            const month = new Date().toISOString().slice(0, 7);
            const results = [];
            for (const c of targets) results.push({ provider: c.provider, ...(await runBackup(c, me, month, { scheduled: false })) });
            return json({ results });
        }
        default:
            return json({ error: 'Unknown action' }, 400);
    }
}

async function handleCallback(url: URL) {
    const fail = (why: string, back = '/settings') => Response.redirect(`${APP_URL()}${back}?section=cloud&cloud_error=${encodeURIComponent(why)}`, 302);
    const state = readState(url.searchParams.get('state') || '');
    if (!state) return fail('This sign-in link expired. Try connecting again.');
    if (url.searchParams.get('error')) return fail(url.searchParams.get('error_description') || 'Sign-in was cancelled.', state.b);
    const code = url.searchParams.get('code');
    if (!code) return fail('Sign-in was cancelled.', state.b);
    try {
        const t = await tokenRequest(state.p, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT() });
        if (!t.refresh_token) return fail('No offline access was granted. Try connecting again.', state.b);
        let email = emailFromIdToken(t.id_token);
        if (!email && state.p === 'microsoft') {
            const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => r.json()).catch(() => ({}));
            email = me.mail || me.userPrincipalName || null;
        }
        const [conn]: Row[] = await db('cloud_connections?on_conflict=user_id,provider', {
            method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify({ user_id: state.u, provider: state.p, account_email: email, refresh_token_enc: seal(t.refresh_token), last_error: null, last_backup_month: prevMonth(), updated_at: new Date().toISOString() }),
        });
        // First backup straight away, so the files are there to check
        const [user]: Row[] = await db(`users?id=eq.${state.u}&select=id,name,email,language,default_currency`);
        const first = user ? await runBackup(conn, user, new Date().toISOString().slice(0, 7), { scheduled: false }) : { ok: false };
        return Response.redirect(`${APP_URL()}${state.b}?section=cloud&cloud_connected=${state.p}${first.ok ? '' : '&cloud_first=failed'}`, 302);
    } catch (e) {
        console.error('[backup] callback', e);
        return fail((e as Error).message, state.b);
    }
}

async function handleCron(req: Request) {
    // With CRON_SECRET set (recommended), Vercel sends it; without it, only Vercel's scheduler user agent is accepted.
    const secret = process.env.CRON_SECRET;
    if (secret ? req.headers.get('Authorization') !== `Bearer ${secret}` : !/vercel-cron/i.test(req.headers.get('user-agent') || '')) return json({ error: 'Not allowed' }, 401);
    const month = prevMonth();
    const started = Date.now();
    const due: Row[] = await db(`cloud_connections?or=(last_backup_month.is.null,last_backup_month.lt.${month})&select=*&order=updated_at.asc&limit=40`);
    const users = new Map<string, Row>();
    let done = 0, failed = 0;
    for (const c of due) {
        if (Date.now() - started > 45_000) break; // the rest run tomorrow
        if (!users.has(c.user_id)) users.set(c.user_id, (await db(`users?id=eq.${c.user_id}&select=id,name,email,language,default_currency`))[0]);
        const u = users.get(c.user_id);
        if (!u) continue;
        const r = await runBackup(c, u, month, { scheduled: true });
        if (r.ok) done++; else failed++;
    }
    return json({ month, due: due.length, done, failed });
}

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
export async function POST(req: Request) {
    try { return await handlePost(req); } catch (e) { console.error('[backup]', e); return json({ error: (e as Error).message }, 500); }
}
export async function GET(req: Request) {
    const url = new URL(req.url);
    try {
        if (url.searchParams.get('cron') === 'monthly') return await handleCron(req);
        if (url.searchParams.has('state')) return await handleCallback(url);
        return json({ ok: true, providers: { google: configured('google'), microsoft: configured('microsoft') }, redirectUri: REDIRECT() });
    } catch (e) { console.error('[backup]', e); return json({ error: (e as Error).message }, 500); }
}
