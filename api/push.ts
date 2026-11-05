/**
 * Zaylo push notifications (Web Push / VAPID).
 *
 *   POST /api/push  Authorization: Bearer <Supabase access token>
 *     { action: 'dispatch' }               send every notification that hasn't been pushed yet
 *     { action: 'chat', messageId }        tell the other members of a workspace about a new chat message
 *     { action: 'test' }                   send a test push to the caller's devices
 *   GET  /api/push?cron=reminders          daily: create payment / payday reminders, then dispatch
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY (push keys are derived from it unless VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are set),
 *      VAPID_SUBJECT (optional),
 *      VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, CRON_SECRET (optional, set by Vercel for crons).
 */
import webpush from 'web-push';
import { createECDH, createHash } from 'crypto';

export const config = { maxDuration: 30 };

type Row = Record<string, any>;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SB_URL = () => process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Minimal PostgREST client with the service key (server only). */
async function db(path: string, init: RequestInit = {}) {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
        ...init,
        headers: { apikey: SERVICE(), Authorization: `Bearer ${SERVICE()}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DB ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
}
const rpc = (fn: string, args: Row = {}) => db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

async function caller(req: Request): Promise<Row | null> {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
    if (!token || !SB_URL()) return null;
    const r = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    const rows = await db(`users?auth_id=eq.${u.id}&select=id,name`);
    return rows?.[0] || null;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** VAPID keys: explicit env vars, or a P-256 key pair derived from the server's service key (never sent to clients). */
function vapidKeys(): { publicKey: string; privateKey: string } | null {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    if (!SERVICE()) return null;
    const seed = createHash('sha256').update(`zaylo-web-push-v1:${SERVICE()}`).digest();
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(seed);
    return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(seed) };
}

let vapidReady = false;
function setupVapid() {
    if (vapidReady) return true;
    const k = vapidKeys();
    if (!k) return false;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@zaylo.cc', k.publicKey, k.privateKey);
    vapidReady = true;
    return true;
}

const TITLES: Record<string, string> = {
    member_added: 'Added to a workspace', member_joined: 'New member', member_removed: 'Removed from a workspace', member_left: 'Someone left',
    role_change: 'Your role changed', invite: 'Workspace invite', join_request: 'Join request', admin_message: 'Message from Zaylo',
    admin_notice: 'Zaylo', bill_due: 'Payment reminder', payday: 'Payday', expense_added: 'New expense', workspace_archived: 'Workspace archived', workspace_deleted: 'Workspace deleted',
};
const LINKS: Record<string, string> = { bill_due: '/bills', payday: '/earnings', admin_message: '/messages', member_added: '/workspaces', member_joined: '/workspaces', role_change: '/workspaces' };

interface Payload { title: string; body: string; url: string; tag?: string }

/** Send to every device of the given users; forget devices the push service says are gone. */
async function sendTo(userIds: string[], payloadFor: (userId: string) => Payload) {
    if (!userIds.length || !setupVapid()) return { sent: 0, devices: 0 };
    const ids = [...new Set(userIds)];
    const subs: Row[] = await db(`push_subscriptions?user_id=in.(${ids.join(',')})&select=id,user_id,endpoint,p256dh,auth`);
    let sent = 0;
    const gone: string[] = [];
    await Promise.all(subs.map(async s => {
        try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payloadFor(s.user_id)), { TTL: 60 * 60 * 24, urgency: 'high' });
            sent++;
        } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) gone.push(s.id);
        }
    }));
    if (gone.length) await db(`push_subscriptions?id=in.(${gone.join(',')})`, { method: 'DELETE' }).catch(() => {});
    if (sent) await db(`push_subscriptions?id=in.(${subs.map(s => s.id).filter(id => !gone.includes(id)).join(',') || '00000000-0000-0000-0000-000000000000'})`, { method: 'PATCH', body: JSON.stringify({ last_used_at: new Date().toISOString() }) }).catch(() => {});
    return { sent, devices: subs.length };
}

async function dispatchPending() {
    const rows: Row[] = await rpc('claim_unpushed_notifications', { p_limit: 300 });
    let sent = 0;
    // One push per notification, to that notification's owner
    for (const n of rows) {
        const r = await sendTo([n.user_id], () => ({
            title: TITLES[n.type] || 'Zaylo',
            body: String(n.message || '').slice(0, 240),
            url: n.link || LINKS[n.type] || '/activity',
            tag: n.dedupe_key || n.id,
        }));
        sent += r.sent;
    }
    return { notifications: rows.length, sent };
}

async function chatPush(me: Row, messageId: string) {
    const msgs: Row[] = await db(`chat_messages?id=eq.${messageId}&select=id,workspace_id,user_id,body,attachments`);
    const m = msgs[0];
    if (!m || m.user_id !== me.id) return { sent: 0 };
    const [ws]: Row[] = await db(`workspaces?id=eq.${m.workspace_id}&select=id,name`);
    const members: Row[] = await db(`workspace_members?workspace_id=eq.${m.workspace_id}&status=eq.active&select=user_id`);
    const files = Array.isArray(m.attachments) ? m.attachments.length : 0;
    const body = m.body ? String(m.body).slice(0, 200) : files ? `Sent ${files === 1 ? 'a file' : `${files} files`}` : 'New message';
    return sendTo(members.map(x => x.user_id).filter(id => id !== me.id), () => ({
        title: `${me.name || 'Someone'} · ${ws?.name || 'Workspace chat'}`, body, url: '/chat', tag: `chat:${m.workspace_id}`,
    }));
}

async function handlePost(req: Request) {
    const me = await caller(req);
    if (!me) return json({ error: 'Sign in first' }, 401);
    const body = await req.json().catch(() => ({}));
    if (!SERVICE()) return json({ error: 'Push needs SUPABASE_SERVICE_ROLE_KEY on the server.' }, 503);
    if (!setupVapid()) return json({ error: 'Push isn\'t set up on the server yet.', configured: false }, 503);
    switch (body.action) {
        case 'dispatch': return json(await dispatchPending());
        case 'chat': return json(await chatPush(me, String(body.messageId || '')));
        case 'test': return json(await sendTo([me.id], () => ({ title: 'Notifications are on', body: 'You\'ll hear from Zaylo about payments, payday, chats and workspace changes.', url: '/settings', tag: 'test' })));
        default: return json({ error: 'Unknown action' }, 400);
    }
}

async function handleCron(req: Request) {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get('Authorization') !== `Bearer ${secret}`) return json({ error: 'Not allowed' }, 401);
    const created = await rpc('create_due_reminders', {});
    const pushed = setupVapid() ? await dispatchPending() : { notifications: 0, sent: 0, note: 'VAPID keys missing' };
    return json({ reminders: created, ...pushed });
}

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
export async function POST(req: Request) {
    try { return await handlePost(req); } catch (e) { console.error('[push]', e); return json({ error: (e as Error).message }, 500); }
}
export async function GET(req: Request) {
    const url = new URL(req.url);
    try {
        if (url.searchParams.get('cron') === 'reminders') return await handleCron(req);
        const k = vapidKeys();
        return new Response(JSON.stringify({ configured: Boolean(k), publicKey: k?.publicKey || null }), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
    } catch (e) { console.error('[push]', e); return json({ error: (e as Error).message }, 500); }
}
