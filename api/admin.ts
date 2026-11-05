/**
 * Zaylo admin API (Vercel edge function).
 * Every request must carry the caller's Supabase access token; the caller must be
 * an app admin (public.users.is_admin). Uses the service-role key, which never
 * leaves the server. Every write is recorded in public.audit_log.
 *
 * Required Vercel env: SUPABASE_SERVICE_ROLE_KEY (and VITE_SUPABASE_URL, already set).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

type Row = Record<string, any>;
interface Admin { id: string; auth_id: string; email: string | null; name: string }

async function audit(db: SupabaseClient, actor: Admin, action: string, target: string | null, details: Row = {}) {
    await db.from('audit_log').insert({ actor_id: actor.id, actor_email: actor.email, action, target_user_id: target, details });
}

async function allAuthUsers(db: SupabaseClient) {
    const out: Row[] = [];
    for (let page = 1; page <= 20; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        out.push(...data.users);
        if (data.users.length < 1000) break;
    }
    return out;
}

function summariseAuth(a: Row | undefined) {
    if (!a) return { providers: [], lastSignInAt: null, confirmed: false, banned: false };
    return {
        providers: Array.from(new Set((a.identities || []).map((i: Row) => i.provider))),
        lastSignInAt: a.last_sign_in_at ?? null,
        confirmed: Boolean(a.email_confirmed_at || a.phone_confirmed_at),
        banned: Boolean(a.banned_until && new Date(a.banned_until) > new Date()),
        authPhone: a.phone || null,
    };
}

/** Ask /api/push to send notifications that were just created (uses the admin's own session). */
async function pushNow(req: Request) {
    try {
        await fetch(new URL('/api/push', req.url), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.headers.get('Authorization') || '' }, body: JSON.stringify({ action: 'dispatch' }) });
    } catch { /* push is best-effort */ }
}

export default async function handler(req: Request) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return json({ error: 'Admin API is not configured. Add SUPABASE_SERVICE_ROLE_KEY in Vercel.' }, 503);

    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // ── Who is calling? ──
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Sign in required' }, 401);
    const { data: caller, error: callerErr } = await db.auth.getUser(token);
    if (callerErr || !caller?.user) return json({ error: 'Session expired. Sign in again.' }, 401);
    const { data: me } = await db.from('users').select('id, auth_id, email, name, is_admin').eq('auth_id', caller.user.id).maybeSingle();
    const envAdmins = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const isAdmin = Boolean(me?.is_admin) || (caller.user.email && envAdmins.includes(caller.user.email.toLowerCase()));
    if (!me || !isAdmin) return json({ error: 'Admins only' }, 403);
    const admin: Admin = { id: me.id, auth_id: me.auth_id, email: me.email, name: me.name };

    let body: Row;
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const action = String(body.action || '');

    try {
        switch (action) {
            case 'me':
                return json({ ok: true, admin });

            case 'stats': {
                const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
                const count = async (table: string, filter?: (q: any) => any) => {
                    let q = db.from(table).select('*', { count: 'exact', head: true });
                    if (filter) q = filter(q);
                    const { count: c } = await q;
                    return c ?? 0;
                };
                const [users, newUsers, workspaces, expenses, messages, openSupport] = await Promise.all([
                    count('users'),
                    count('users', q => q.gte('created_at', since7)),
                    count('workspaces'),
                    count('expenses', q => q.eq('is_deleted', false)),
                    count('chat_messages', q => q.gte('created_at', since7)),
                    count('support_messages', q => q.eq('from_admin', false).is('read_at', null)),
                ]);
                const { data: signups } = await db.from('users').select('created_at').gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString());
                const byDay: Record<string, number> = {};
                (signups || []).forEach(r => { const d = String(r.created_at).slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; });
                return json({ users, newUsers, workspaces, expenses, messages, openSupport, signupsByDay: byDay });
            }

            case 'listUsers': {
                const [{ data: profiles, error }, authUsers] = await Promise.all([
                    db.from('users').select('id, auth_id, name, email, phone, country, is_admin, is_banned, created_at, last_seen_at, default_currency').order('created_at', { ascending: false }),
                    allAuthUsers(db),
                ]);
                if (error) throw error;
                const byAuth = new Map(authUsers.map(a => [a.id, a]));
                const users = (profiles || []).map(p => ({ ...p, ...summariseAuth(byAuth.get(p.auth_id)) }));
                // Auth accounts that never got a profile row (sign-up trigger failed)
                const orphans = authUsers.filter(a => !(profiles || []).some(p => p.auth_id === a.id))
                    .map(a => ({ id: null, auth_id: a.id, name: a.user_metadata?.full_name || '(no profile)', email: a.email, phone: a.phone, created_at: a.created_at, is_admin: false, is_banned: false, orphan: true, ...summariseAuth(a) }));
                return json({ users: [...users, ...orphans] });
            }

            case 'getUser': {
                const { data: p, error } = await db.from('users').select('*').eq('id', body.id).single();
                if (error) throw error;
                const [{ data: authRes }, { data: memberships }, { data: owned }, expCount, incCount, { data: activity }, { data: support }] = await Promise.all([
                    db.auth.admin.getUserById(p.auth_id),
                    db.from('workspace_members').select('role, status, workspace_id, workspaces(id, name, type, currency)').eq('user_id', p.id),
                    db.from('workspaces').select('id, name, type, currency, created_at').eq('owner_id', p.id),
                    db.from('expenses').select('*', { count: 'exact', head: true }).eq('created_by', p.id).eq('is_deleted', false),
                    db.from('incomes').select('*', { count: 'exact', head: true }).eq('created_by', p.id),
                    db.from('activity_log').select('action, entity_type, created_at, workspace_id').eq('user_id', p.id).order('created_at', { ascending: false }).limit(25),
                    db.from('support_messages').select('*').eq('user_id', p.id).order('created_at', { ascending: true }).limit(200),
                ]);
                const { data: totals } = await db.from('expenses').select('amount, currency').eq('created_by', p.id).eq('is_deleted', false).limit(5000);
                const spendByCurrency: Record<string, number> = {};
                (totals || []).forEach(r => { spendByCurrency[r.currency] = (spendByCurrency[r.currency] || 0) + Number(r.amount); });
                return json({
                    user: { ...p, ...summariseAuth(authRes?.user) },
                    workspaces: [
                        ...(owned || []).map(w => ({ ...w, role: 'owner' })),
                        ...(memberships || []).filter(m => !(owned || []).some(o => o.id === m.workspace_id)).map(m => ({ ...(m as Row).workspaces, role: m.role, status: m.status })),
                    ],
                    counts: { expenses: expCount.count ?? 0, incomes: incCount.count ?? 0 },
                    spendByCurrency,
                    activity: activity || [],
                    support: support || [],
                });
            }

            case 'createUser': {
                const email = body.email ? String(body.email).trim().toLowerCase() : undefined;
                const phone = body.phone ? String(body.phone).replace(/[^\d+]/g, '') : undefined;
                if (!email && !phone) return json({ error: 'Enter an email or a phone number' }, 400);
                const meta = { full_name: String(body.name || '').trim() || undefined };
                let authUser;
                if (email && !body.password) {
                    const { data, error } = await db.auth.admin.inviteUserByEmail(email, { data: meta, redirectTo: body.redirectTo });
                    if (error) throw error;
                    authUser = data.user;
                } else {
                    const { data, error } = await db.auth.admin.createUser({
                        email, phone, password: body.password || undefined,
                        email_confirm: Boolean(email), phone_confirm: Boolean(phone), user_metadata: meta,
                    });
                    if (error) throw error;
                    authUser = data.user;
                }
                // The DB trigger creates the profile; make sure it exists and apply flags
                await new Promise(r => setTimeout(r, 300));
                let { data: profile } = await db.from('users').select('id').eq('auth_id', authUser!.id).maybeSingle();
                if (!profile) {
                    const ins = await db.from('users').insert({ auth_id: authUser!.id, name: meta.full_name || email?.split('@')[0] || 'Member', email: email || null, phone: phone || null }).select('id').single();
                    profile = ins.data;
                }
                if (profile && body.makeAdmin) await db.from('users').update({ is_admin: true }).eq('id', profile.id);
                await audit(db, admin, 'user.create', profile?.id ?? null, { email, phone, invited: Boolean(email && !body.password), admin: Boolean(body.makeAdmin) });
                return json({ ok: true, id: profile?.id, invited: Boolean(email && !body.password) });
            }

            case 'updateUser': {
                const { data: p, error } = await db.from('users').select('id, auth_id, email').eq('id', body.id).single();
                if (error) throw error;
                const patch: Row = {};
                if (typeof body.name === 'string') patch.name = body.name.trim();
                if (typeof body.isAdmin === 'boolean') {
                    if (p.id === admin.id && !body.isAdmin) return json({ error: "You can't remove your own admin access" }, 400);
                    patch.is_admin = body.isAdmin;
                }
                if (typeof body.banned === 'boolean') {
                    if (p.id === admin.id) return json({ error: "You can't suspend yourself" }, 400);
                    patch.is_banned = body.banned;
                    const { error: banErr } = await db.auth.admin.updateUserById(p.auth_id, { ban_duration: body.banned ? '876000h' : 'none' });
                    if (banErr) throw banErr;
                }
                if (Object.keys(patch).length) {
                    const { error: upErr } = await db.from('users').update(patch).eq('id', p.id);
                    if (upErr) throw upErr;
                }
                await audit(db, admin, 'user.update', p.id, patch);
                return json({ ok: true });
            }

            case 'resetPassword': {
                const { data: p } = await db.from('users').select('id, email').eq('id', body.id).single();
                if (!p?.email) return json({ error: 'This user has no email address' }, 400);
                const { error } = await db.auth.resetPasswordForEmail(p.email, { redirectTo: body.redirectTo });
                if (error) throw error;
                await audit(db, admin, 'user.reset_password', p.id, { email: p.email });
                return json({ ok: true });
            }

            case 'deleteUser': {
                const { data: p } = await db.from('users').select('id, auth_id, email').eq('id', body.id).single();
                if (!p) return json({ error: 'User not found' }, 404);
                if (p.id === admin.id) return json({ error: "You can't delete your own account here" }, 400);
                const { error: authErr } = await db.auth.admin.deleteUser(p.auth_id);
                if (authErr && !/not found/i.test(authErr.message)) throw authErr;
                await db.from('users').delete().eq('id', p.id);
                await audit(db, admin, 'user.delete', p.id, { email: p.email });
                return json({ ok: true });
            }

            case 'impersonate': {
                const { data: p } = await db.from('users').select('id, auth_id, email, name, is_admin').eq('id', body.id).single();
                if (!p) return json({ error: 'User not found' }, 404);
                let email = p.email;
                if (!email) {
                    const { data: a } = await db.auth.admin.getUserById(p.auth_id);
                    email = a?.user?.email || null;
                }
                if (!email) return json({ error: 'Impersonation needs the user to have an email address' }, 400);
                const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
                if (error) throw error;
                await audit(db, admin, 'user.impersonate', p.id, { email });
                return json({ ok: true, tokenHash: data.properties?.hashed_token, email, name: p.name });
            }

            case 'logs': {
                const limit = Math.min(Number(body.limit) || 150, 500);
                const [{ data: auditRows }, { data: activity }, { data: signups }] = await Promise.all([
                    db.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit),
                    db.from('activity_log').select('user_name, action, entity_type, created_at, workspace_id').order('created_at', { ascending: false }).limit(limit),
                    db.from('users').select('id, name, email, phone, created_at').order('created_at', { ascending: false }).limit(50),
                ]);
                const rows = [
                    ...(auditRows || []).map(r => ({ kind: 'admin', at: r.created_at, who: r.actor_email, what: r.action, details: r.details, target: r.target_user_id })),
                    ...(activity || []).map(r => ({ kind: 'activity', at: r.created_at, who: r.user_name, what: `${r.action} (${r.entity_type})`, details: { workspace_id: r.workspace_id } })),
                    ...(signups || []).map(r => ({ kind: 'signup', at: r.created_at, who: r.name, what: 'signed up', details: { email: r.email, phone: r.phone }, target: r.id })),
                ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
                return json({ logs: rows });
            }

            case 'listAnnouncements': {
                const { data, error } = await db.from('announcements').select('*').order('created_at', { ascending: false });
                if (error) throw error;
                return json({ announcements: data });
            }
            case 'saveAnnouncement': {
                const row = {
                    title: String(body.title || '').trim(),
                    body: String(body.body || '').trim(),
                    level: ['info', 'success', 'warning'].includes(body.level) ? body.level : 'info',
                    is_active: body.isActive !== false,
                    ends_at: body.endsAt || null,
                };
                if (!row.title) return json({ error: 'Add a title' }, 400);
                const res = body.id
                    ? await db.from('announcements').update(row).eq('id', body.id).select().single()
                    : await db.from('announcements').insert({ ...row, created_by: admin.id }).select().single();
                if (res.error) throw res.error;
                await audit(db, admin, body.id ? 'announcement.update' : 'announcement.create', null, { title: row.title, active: row.is_active });
                return json({ announcement: res.data });
            }
            case 'deleteAnnouncement': {
                const { error } = await db.from('announcements').delete().eq('id', body.id);
                if (error) throw error;
                await audit(db, admin, 'announcement.delete', null, { id: body.id });
                return json({ ok: true });
            }

            case 'notify': {
                const message = String(body.message || '').trim();
                if (!message) return json({ error: 'Write a message' }, 400);
                let ids: string[] = Array.isArray(body.userIds) ? body.userIds : [];
                if (body.audience === 'all') {
                    const { data } = await db.from('users').select('id').eq('is_banned', false);
                    ids = (data || []).map(r => r.id);
                }
                if (!ids.length) return json({ error: 'Choose who receives it' }, 400);
                const rows = ids.map(id => ({ user_id: id, type: 'admin_notice', message, sender_name: 'Zaylo team', link: body.link || null }));
                for (let i = 0; i < rows.length; i += 500) {
                    const { error } = await db.from('notifications').insert(rows.slice(i, i + 500));
                    if (!error) await pushNow(req);
                    if (error) throw error;
                }
                await audit(db, admin, 'notification.send', ids.length === 1 ? ids[0] : null, { recipients: ids.length, message: message.slice(0, 120) });
                return json({ ok: true, sent: ids.length });
            }

            case 'listThreads': {
                const { data, error } = await db.from('support_messages').select('user_id, body, from_admin, created_at, read_at').order('created_at', { ascending: false }).limit(2000);
                if (error) throw error;
                const latest = new Map<string, Row>();
                const unread: Record<string, number> = {};
                (data || []).forEach(m => {
                    if (!latest.has(m.user_id)) latest.set(m.user_id, m);
                    if (!m.from_admin && !m.read_at) unread[m.user_id] = (unread[m.user_id] || 0) + 1;
                });
                const ids = [...latest.keys()];
                const { data: people } = ids.length ? await db.from('users').select('id, name, email, phone').in('id', ids) : { data: [] as Row[] };
                const threads = ids.map(id => ({ user: (people || []).find(p => p.id === id) || { id }, last: latest.get(id), unread: unread[id] || 0 }));
                return json({ threads });
            }
            case 'getThread': {
                const { data, error } = await db.from('support_messages').select('*').eq('user_id', body.userId).order('created_at', { ascending: true }).limit(500);
                if (error) throw error;
                await db.from('support_messages').update({ read_at: new Date().toISOString() }).eq('user_id', body.userId).eq('from_admin', false).is('read_at', null);
                return json({ messages: data });
            }
            case 'sendMessage': {
                const text = String(body.body || '').trim();
                if (!text || !body.userId) return json({ error: 'Write a message' }, 400);
                const { data, error } = await db.from('support_messages').insert({ user_id: body.userId, from_admin: true, sender_name: 'Zaylo team', body: text }).select().single();
                if (error) throw error;
                await db.from('notifications').insert({ user_id: body.userId, type: 'admin_message', message: `New message from the Zaylo team: ${text.slice(0, 120)}`, sender_name: 'Zaylo team', link: '/messages' });
                await pushNow(req);
                await audit(db, admin, 'message.send', body.userId, { preview: text.slice(0, 120) });
                return json({ message: data });
            }

            case 'listWorkspaces': {
                const { data, error } = await db.from('workspaces').select('id, name, type, currency, created_at, owner_id, users!workspaces_owner_id_fkey(name, email)').order('created_at', { ascending: false }).limit(500);
                if (error) throw error;
                const { data: members } = await db.from('workspace_members').select('workspace_id').eq('status', 'active');
                const counts: Record<string, number> = {};
                (members || []).forEach(m => { counts[m.workspace_id] = (counts[m.workspace_id] || 0) + 1; });
                return json({ workspaces: (data || []).map(w => ({ ...w, members: counts[w.id] || 0 })) });
            }
            case 'workspaceMembers': {
                const { data, error } = await db.from('workspace_members').select('user_id, role, status, joined_at, users(name, email, phone)').eq('workspace_id', body.workspaceId);
                if (error) throw error;
                return json({ members: data });
            }
            case 'addWorkspaceMember': {
                const ident = String(body.identifier || '').trim().toLowerCase();
                const { data: target } = await db.from('users').select('id, name').or(`email.ilike.${ident},phone.eq.${ident.replace(/[^\d+]/g, '') || 'x'}`).limit(1).maybeSingle();
                if (!target) return json({ error: 'No Zaylo account uses that email or phone' }, 404);
                const role = ['admin', 'member', 'viewer'].includes(body.role) ? body.role : 'member';
                const { error } = await db.from('workspace_members').upsert({ workspace_id: body.workspaceId, user_id: target.id, role, status: 'active' }, { onConflict: 'workspace_id,user_id' });
                if (error) throw error;
                const { data: ws } = await db.from('workspaces').select('name, type').eq('id', body.workspaceId).single();
                if (ws?.type === 'personal') await db.from('workspaces').update({ type: 'shared' }).eq('id', body.workspaceId);
                await db.from('notifications').insert({ user_id: target.id, type: 'member_added', workspace_id: body.workspaceId, workspace_name: ws?.name, message: `You were added to "${ws?.name}" by the Zaylo team.`, sender_name: 'Zaylo team' });
                await pushNow(req);
                await audit(db, admin, 'workspace.member_add', target.id, { workspaceId: body.workspaceId, role });
                return json({ ok: true });
            }
            case 'removeWorkspaceMember': {
                const { data: m } = await db.from('workspace_members').select('role').eq('workspace_id', body.workspaceId).eq('user_id', body.userId).maybeSingle();
                if (m?.role === 'owner') return json({ error: 'The owner cannot be removed' }, 400);
                const { error } = await db.from('workspace_members').delete().eq('workspace_id', body.workspaceId).eq('user_id', body.userId);
                if (error) throw error;
                await audit(db, admin, 'workspace.member_remove', body.userId, { workspaceId: body.workspaceId });
                return json({ ok: true });
            }

            default:
                return json({ error: `Unknown action: ${action}` }, 400);
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : (err as Row)?.message || 'Unexpected error';
        return json({ error: message }, 500);
    }
}
