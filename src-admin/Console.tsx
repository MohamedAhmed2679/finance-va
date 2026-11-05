import { useEffect, useMemo, useState, useCallback, createContext, useContext } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Users, MessageSquare, Megaphone, Bell, ScrollText, Search, UserPlus, X, ShieldCheck, ShieldOff, Ban, KeyRound, Trash2, LogIn, Send, RefreshCw, FolderOpen, Plus, Gauge } from 'lucide-react';
import { adminCall, openAsUser, MAIN_APP_URL, sb, type Me } from './client';

/** Files a user attached to a support message, opened through short-lived signed links. */
function SupportFiles({ files }: { files?: { path: string; name: string; type: string; size: number }[] }) {
    const [urls, setUrls] = useState<Record<string, string>>({});
    const key = (files || []).map(f => f.path).join('|');
    useEffect(() => {
        if (!key || !sb) return;
        sb.storage.from('chat-attachments').createSignedUrls(key.split('|'), 3600).then(({ data }) => {
            const u: Record<string, string> = {};
            (data || []).forEach(d => { if (d.path && d.signedUrl) u[d.path] = d.signedUrl; });
            setUrls(u);
        });
    }, [key]);
    if (!files?.length) return null;
    return (
        <div style={{ display: 'grid', gap: 6, marginBottom: 4 }}>
            {files.map(f => f.type.startsWith('image/') && urls[f.path]
                ? <a key={f.path} href={urls[f.path]} target="_blank" rel="noreferrer"><img src={urls[f.path]} alt={f.name} style={{ maxWidth: 220, maxHeight: 180, borderRadius: 8, display: 'block' }} /></a>
                : <a key={f.path} href={urls[f.path]} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>📎 {f.name} ({Math.max(1, Math.round(f.size / 1024))} KB)</a>)}
        </div>
    );
}

const MeContext = createContext<Me | null>(null);

type Tab = 'overview' | 'users' | 'workspaces' | 'messages' | 'announcements' | 'notify' | 'logs';
type Row = Record<string, any>;

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'overview', label: 'Overview', icon: Gauge },
    { key: 'users', label: 'Users', icon: Users },
    { key: 'workspaces', label: 'Workspaces', icon: FolderOpen },
    { key: 'messages', label: 'Messages', icon: MessageSquare },
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
    { key: 'notify', label: 'Send notification', icon: Bell },
    { key: 'logs', label: 'Logs', icon: ScrollText },
];

const fmtDate = (v?: string | null) => v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const ago = (v?: string | null) => {
    if (!v) return 'never';
    const s = (Date.now() - new Date(v).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
};

function useAdmin<T>(action: string, payload: Row = {}, deps: unknown[] = []) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const load = useCallback(async () => {
        setLoading(true); setError('');
        try { setData(await adminCall<T>(action, payload)); }
        catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
        finally { setLoading(false); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    useEffect(() => { load(); }, [load]);
    return { data, error, loading, reload: load };
}

function ErrorBox({ error, onRetry }: { error: string; onRetry: () => void }) {
    const needsKey = /SUPABASE_SERVICE_ROLE_KEY/.test(error);
    return (
        <div className="card" style={{ borderColor: 'var(--cinnabar-soft)' }}>
            <div className="card-title" style={{ marginBottom: 6 }}>{needsKey ? 'The admin console needs one more setting' : 'Something went wrong'}</div>
            <p style={{ color: 'var(--ink-2)', fontSize: 14, marginBottom: 14 }}>
                {needsKey ? 'Add SUPABASE_SERVICE_ROLE_KEY (Supabase → Project settings → API → service_role) to the Vercel project\'s environment variables, then redeploy.' : error}
            </p>
            <button className="btn btn-secondary btn-sm" onClick={onRetry}><RefreshCw size={14} /> Try again</button>
        </div>
    );
}

// ───────────────────────── Overview ─────────────────────────
function Overview({ go }: { go: (t: Tab) => void }) {
    const { data, error, loading, reload } = useAdmin<Row>('stats');
    if (error) return <ErrorBox error={error} onRetry={reload} />;
    const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29 - i) * 864e5); return d.toISOString().slice(0, 10); });
    const max = Math.max(1, ...days.map(d => data?.signupsByDay?.[d] || 0));
    const stats = [
        ['Users', data?.users, 'users'], ['New this week', data?.newUsers, 'users'], ['Workspaces', data?.workspaces, 'workspaces'],
        ['Expenses recorded', data?.expenses, null], ['Chat messages this week', data?.messages, null], ['Unread support messages', data?.openSupport, 'messages'],
    ] as const;
    return (
        <>
            <div className="card-grid card-grid-3 mb-6">
                {stats.map(([label, value, target]) => (
                    <button key={label} className="card stat-card" style={{ textAlign: 'left', cursor: target ? 'pointer' : 'default' }} onClick={() => target && go(target as Tab)}>
                        <span className="stat-label">{label}</span>
                        <span className="stat-value">{loading ? <span className="skeleton" style={{ display: 'inline-block', width: 60, height: 26 }} /> : (value ?? 0).toLocaleString()}</span>
                    </button>
                ))}
            </div>
            <div className="card">
                <div className="card-head"><div className="card-title">Sign-ups, last 30 days</div></div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }} role="img" aria-label="Daily sign-ups for the last 30 days">
                    {days.map((d, i) => {
                        const v = data?.signupsByDay?.[d] || 0;
                        return (
                            <motion.div key={d} title={`${d}: ${v}`} initial={{ height: 0 }} animate={{ height: `${(v / max) * 100}%` }} transition={{ delay: i * 0.015 }}
                                style={{ flex: 1, minHeight: v ? 4 : 2, borderRadius: 3, background: v ? 'var(--note)' : 'var(--surface-3)' }} />
                        );
                    })}
                </div>
            </div>
        </>
    );
}

// ───────────────────────── Users ─────────────────────────
function UsersTab({ onOpen }: { onOpen: (id: string) => void }) {
    const { data, error, loading, reload } = useAdmin<{ users: Row[] }>('listUsers');
    const [q, setQ] = useState('');
    const [filter, setFilter] = useState<'all' | 'admins' | 'suspended' | 'unconfirmed'>('all');
    const [creating, setCreating] = useState(false);
    const list = useMemo(() => (data?.users || []).filter(u => {
        const hay = `${u.name} ${u.email} ${u.phone}`.toLowerCase();
        if (q && !hay.includes(q.toLowerCase())) return false;
        if (filter === 'admins') return u.is_admin;
        if (filter === 'suspended') return u.is_banned || u.banned;
        if (filter === 'unconfirmed') return !u.confirmed;
        return true;
    }), [data, q, filter]);

    if (error) return <ErrorBox error={error} onRetry={reload} />;
    return (
        <>
            <div className="flex gap-3 mb-4" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="search-bar" style={{ flex: 1, minWidth: 220 }}>
                    <Search size={16} style={{ color: 'var(--ink-3)' }} />
                    <input placeholder="Search name, email or phone" value={q} onChange={e => setQ(e.target.value)} aria-label="Search users" />
                </div>
                <select className="form-select" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Filter users">
                    <option value="all">All users</option><option value="admins">Admins</option><option value="suspended">Suspended</option><option value="unconfirmed">Not confirmed</option>
                </select>
                <button className="btn btn-primary" onClick={() => setCreating(true)}><UserPlus size={16} /> Create user</button>
            </div>
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="data-table admin-table">
                    <thead><tr><th>Name</th><th>Sign-in</th><th>Joined</th><th>Last sign-in</th><th>Status</th></tr></thead>
                    <tbody>
                        {loading && !data ? [0, 1, 2, 3].map(i => <tr key={i}><td colSpan={5}><div className="skeleton" style={{ height: 16 }} /></td></tr>) :
                            list.map(u => (
                                <tr key={u.auth_id} onClick={() => u.id && onOpen(u.id)} style={{ cursor: u.id ? 'pointer' : 'default' }}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <span className="user-avatar" style={{ width: 30, height: 30, fontSize: 12 }}>{(u.name || '?')[0]?.toUpperCase()}</span>
                                            <span style={{ minWidth: 0 }}>
                                                <span style={{ display: 'block', fontWeight: 600 }}>{u.name}{u.orphan && <span className="badge badge-warning" style={{ marginLeft: 6 }}>no profile</span>}</span>
                                                <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{u.email || u.phone || u.authPhone || '—'}</span>
                                            </span>
                                        </div>
                                    </td>
                                    <td style={{ fontSize: 13, color: 'var(--ink-2)' }}>{(u.providers || []).join(', ') || '—'}</td>
                                    <td style={{ fontSize: 13, color: 'var(--ink-2)' }}>{fmtDate(u.created_at).split(',')[0]}</td>
                                    <td style={{ fontSize: 13, color: 'var(--ink-2)' }}>{ago(u.lastSignInAt)}</td>
                                    <td>
                                        <span className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                                            {u.is_admin && <span className="badge badge-primary">Admin</span>}
                                            {(u.is_banned || u.banned) && <span className="badge badge-danger">Suspended</span>}
                                            {!u.confirmed && <span className="badge badge-warning">Not confirmed</span>}
                                            {!u.is_admin && !u.is_banned && !u.banned && u.confirmed && <span className="badge">Active</span>}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        {data && list.length === 0 && <tr><td colSpan={5}><div className="empty-state"><div className="empty-desc">No users match.</div></div></td></tr>}
                    </tbody>
                </table>
            </div>
            <p className="text-xs text-muted mt-2">{data ? `${list.length} of ${data.users.length} users` : ''}</p>
            {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
        </>
    );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const [mode, setMode] = useState<'invite' | 'password' | 'phone'>('invite');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [makeAdmin, setMakeAdmin] = useState(false);
    const [busy, setBusy] = useState(false);
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        try {
            const res = await adminCall<Row>('createUser', {
                name, makeAdmin,
                email: mode !== 'phone' ? email : undefined,
                phone: mode === 'phone' ? phone : undefined,
                password: mode === 'password' ? password : undefined,
                redirectTo: `${MAIN_APP_URL}/`,
            });
            toast.success(res.invited ? `Invitation emailed to ${email}` : 'User created');
            onCreated();
        } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); }
        finally { setBusy(false); }
    }
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <form className="modal" onSubmit={submit}>
                <div className="modal-header"><h2 className="modal-title">Create user</h2><button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
                <div className="segmented mb-4">
                    {([['invite', 'Email invite'], ['password', 'Email + password'], ['phone', 'Phone']] as const).map(([k, l]) => (
                        <button type="button" key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>
                            {mode === k && <motion.span layoutId="cu-seg" className="seg-pill" />}<span>{l}</span>
                        </button>
                    ))}
                </div>
                <div className="form-group"><label className="form-label" htmlFor="cu-name">Full name</label><input id="cu-name" className="form-input" value={name} onChange={e => setName(e.target.value)} required /></div>
                {mode !== 'phone' && <div className="form-group"><label className="form-label" htmlFor="cu-email">Email</label><input id="cu-email" type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required /></div>}
                {mode === 'phone' && <div className="form-group"><label className="form-label" htmlFor="cu-phone">Phone with country code</label><input id="cu-phone" type="tel" className="form-input" placeholder="+20…" value={phone} onChange={e => setPhone(e.target.value)} required /><div className="text-xs text-muted mt-1">They sign in with a text-message code.</div></div>}
                {mode === 'password' && <div className="form-group"><label className="form-label" htmlFor="cu-pw">Temporary password</label><input id="cu-pw" type="text" autoComplete="off" className="form-input" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /><div className="text-xs text-muted mt-1">Share it privately and ask them to change it.</div></div>}
                {mode === 'invite' && <p className="text-xs text-muted mb-4">They get an email with a link to set their own password.</p>}
                <label className="flex items-center gap-2 mb-4" style={{ fontSize: 14 }}><input type="checkbox" checked={makeAdmin} onChange={e => setMakeAdmin(e.target.checked)} /> Make this user an admin</label>
                <button className="btn btn-primary w-full btn-lg" disabled={busy}>{busy ? 'Creating…' : mode === 'invite' ? 'Send invitation' : 'Create user'}</button>
            </form>
        </div>
    );
}

function UserDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
    const { data, error, loading, reload } = useAdmin<Row>('getUser', { id }, [id]);
    const me = useContext(MeContext);
    const [busy, setBusy] = useState('');
    const [note, setNote] = useState('');
    const u = data?.user;

    async function act(action: string, payload: Row, ok: string, confirmText?: string) {
        if (confirmText && !confirm(confirmText)) return;
        setBusy(action);
        try { await adminCall(action, payload); toast.success(ok); reload(); onChanged(); }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
        finally { setBusy(''); }
    }
    async function impersonate() {
        if (!confirm(`Open Zaylo as ${u?.name}? It opens in a new tab, signed in as them. You stay signed in here. This is logged.`)) return;
        setBusy('impersonate');
        try { await openAsUser(id); }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
        finally { setBusy(''); }
    }
    async function send() {
        if (!note.trim()) return;
        setBusy('send');
        try { await adminCall('sendMessage', { userId: id, body: note }); setNote(''); toast.success('Message sent'); reload(); }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
        finally { setBusy(''); }
    }
    const self = u && me?.id === u.id;

    return (
        <>
            <motion.div className="sheet-overlay" style={{ animation: 'none', zIndex: 1100 }} onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside className="admin-drawer" role="dialog" aria-label="User details" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 40 }}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="modal-title">{u?.name || 'User'}</h2>
                    <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
                </div>
                {error && <ErrorBox error={error} onRetry={reload} />}
                {loading && !data && <div className="skeleton" style={{ height: 200 }} />}
                {u && (
                    <>
                        <dl className="admin-dl">
                            <dt>Email</dt><dd>{u.email || '—'}</dd>
                            <dt>Phone</dt><dd>{u.phone || u.authPhone || '—'}</dd>
                            <dt>Country</dt><dd>{u.country || '—'}</dd>
                            <dt>Signs in with</dt><dd>{(u.providers || []).join(', ') || '—'}</dd>
                            <dt>Joined</dt><dd>{fmtDate(u.created_at)}</dd>
                            <dt>Last sign-in</dt><dd>{fmtDate(u.lastSignInAt)}</dd>
                            <dt>Currency</dt><dd>{u.default_currency}</dd>
                            <dt>Expenses / incomes</dt><dd>{data.counts.expenses} / {data.counts.incomes}</dd>
                            <dt>Total spent</dt><dd>{Object.entries(data.spendByCurrency || {}).map(([c, v]) => `${Number(v).toLocaleString()} ${c}`).join(' · ') || '—'}</dd>
                            <dt>Status</dt><dd className="flex gap-2">{u.is_admin && <span className="badge badge-primary">Admin</span>}{u.is_banned && <span className="badge badge-danger">Suspended</span>}{!u.confirmed && <span className="badge badge-warning">Not confirmed</span>}</dd>
                        </dl>

                        <div className="admin-actions">
                            <button className="btn btn-secondary btn-sm" disabled={!!busy || !!self} onClick={impersonate}><LogIn size={15} /> Open app as user</button>
                            <button className="btn btn-secondary btn-sm" disabled={!!busy || !u.email} onClick={() => act('resetPassword', { id, redirectTo: `${MAIN_APP_URL}/?type=recovery` }, 'Password reset email sent')}><KeyRound size={15} /> Send password reset</button>
                            <button className="btn btn-secondary btn-sm" disabled={!!busy || !!self} onClick={() => act('updateUser', { id, isAdmin: !u.is_admin }, u.is_admin ? 'Admin access removed' : 'Now an admin', u.is_admin ? undefined : `Give ${u.name} full admin access?`)}>
                                {u.is_admin ? <><ShieldOff size={15} /> Remove admin</> : <><ShieldCheck size={15} /> Make admin</>}
                            </button>
                            <button className="btn btn-secondary btn-sm" disabled={!!busy || !!self} onClick={() => act('updateUser', { id, banned: !u.is_banned }, u.is_banned ? 'Account restored' : 'Account suspended', u.is_banned ? undefined : `Suspend ${u.name}? They won't be able to sign in.`)}>
                                <Ban size={15} /> {u.is_banned ? 'Restore account' : 'Suspend'}
                            </button>
                            <button className="btn btn-sm" style={{ color: 'var(--cinnabar)', border: '1px solid var(--cinnabar-soft)' }} disabled={!!busy || !!self} onClick={() => act('deleteUser', { id }, 'User deleted', `Delete ${u.name} and all their workspaces and expenses permanently? This can't be undone.`).then(onClose)}>
                                <Trash2 size={15} /> Delete
                            </button>
                        </div>

                        <h3 className="admin-h3">Workspaces</h3>
                        {data.workspaces.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                            <div className="ledger">{data.workspaces.map((w: Row) => (
                                <div key={w.id} className="ledger-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                                    <div><div className="ledger-title">{w.name}</div><div className="ledger-sub">{w.type} · {w.currency}</div></div>
                                    <span className="badge">{w.role}</span>
                                </div>
                            ))}</div>
                        )}

                        <h3 className="admin-h3">Messages</h3>
                        <div className="admin-thread">
                            {data.support.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
                            {data.support.map((m: Row) => (
                                <div key={m.id} className={`bubble ${m.from_admin ? 'mine' : ''}`}><SupportFiles files={m.attachments} />{m.body && <div>{m.body}</div>}<time>{fmtDate(m.created_at)}</time></div>
                            ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                            <input className="form-input" placeholder={`Message ${u.name}`} value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} aria-label="Message" />
                            <button className="btn btn-primary" disabled={!note.trim() || busy === 'send'} onClick={send} aria-label="Send"><Send size={16} /></button>
                        </div>

                        <h3 className="admin-h3">Recent activity</h3>
                        {data.activity.length === 0 ? <p className="text-sm text-muted">No activity recorded.</p> : (
                            <ul className="admin-log">{data.activity.map((a: Row, i: number) => <li key={i}><span>{a.action} <em>{a.entity_type}</em></span><time>{ago(a.created_at)}</time></li>)}</ul>
                        )}
                    </>
                )}
            </motion.aside>
        </>
    );
}

// ───────────────────────── Workspaces ─────────────────────────
function WorkspacesTab() {
    const { data, error, reload } = useAdmin<{ workspaces: Row[] }>('listWorkspaces');
    const [open, setOpen] = useState<Row | null>(null);
    const [members, setMembers] = useState<Row[] | null>(null);
    const [ident, setIdent] = useState('');
    const [role, setRole] = useState('member');
    const loadMembers = async (ws: Row) => { setMembers(null); const r = await adminCall<{ members: Row[] }>('workspaceMembers', { workspaceId: ws.id }); setMembers(r.members); };
    if (error) return <ErrorBox error={error} onRetry={reload} />;
    return (
        <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
            <div className="card" style={{ padding: 8 }}>
                {(data?.workspaces || []).map(w => (
                    <button key={w.id} className={`dropdown-item w-full ${open?.id === w.id ? 'active' : ''}`} style={{ border: 'none', background: open?.id === w.id ? 'var(--surface-2)' : 'none' }} onClick={() => { setOpen(w); loadMembers(w); }}>
                        <span className="flex-1" style={{ textAlign: 'start' }}>
                            <span style={{ display: 'block', fontWeight: 600, color: 'var(--ink)' }}>{w.name}</span>
                            <span style={{ fontSize: 12.5 }}>{w.users?.name || 'Unknown owner'} · {w.members} member{w.members === 1 ? '' : 's'} · {w.currency}</span>
                        </span>
                        <span className="badge">{w.type}</span>
                    </button>
                ))}
                {data && data.workspaces.length === 0 && <div className="empty-state"><div className="empty-desc">No workspaces yet.</div></div>}
            </div>
            <div className="card">
                {!open ? <p className="text-sm text-muted">Choose a workspace to manage its members and chat access.</p> : (
                    <>
                        <div className="card-head"><div className="card-title">{open.name}</div></div>
                        <div className="ledger mb-4">
                            {!members && <div className="skeleton" style={{ height: 60 }} />}
                            {members?.map(m => (
                                <div key={m.user_id} className="ledger-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
                                    <div><div className="ledger-title">{m.users?.name}</div><div className="ledger-sub">{m.users?.email || m.users?.phone}</div></div>
                                    <span className="badge">{m.role}</span>
                                    {m.role !== 'owner' ? (
                                        <button className="icon-btn" aria-label={`Remove ${m.users?.name}`} onClick={async () => {
                                            if (!confirm(`Remove ${m.users?.name} from ${open.name}? They lose access to its data and chat.`)) return;
                                            try { await adminCall('removeWorkspaceMember', { workspaceId: open.id, userId: m.user_id }); toast.success('Removed'); loadMembers(open); reload(); }
                                            catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
                                        }}><Trash2 size={15} style={{ color: 'var(--cinnabar)' }} /></button>
                                    ) : <span />}
                                </div>
                            ))}
                        </div>
                        <form className="flex gap-2" style={{ flexWrap: 'wrap' }} onSubmit={async e => {
                            e.preventDefault();
                            try { await adminCall('addWorkspaceMember', { workspaceId: open.id, identifier: ident, role }); toast.success('Added'); setIdent(''); loadMembers(open); reload(); }
                            catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); }
                        }}>
                            <input className="form-input" style={{ flex: 1, minWidth: 180 }} placeholder="Email or phone of a user" value={ident} onChange={e => setIdent(e.target.value)} required aria-label="User email or phone" />
                            <select className="form-select" style={{ width: 'auto' }} value={role} onChange={e => setRole(e.target.value)} aria-label="Role"><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select>
                            <button className="btn btn-primary"><Plus size={16} /> Add</button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}

// ───────────────────────── Messages ─────────────────────────
function MessagesTab() {
    const { data, error, reload } = useAdmin<{ threads: Row[] }>('listThreads');
    const [sel, setSel] = useState<Row | null>(null);
    const [msgs, setMsgs] = useState<Row[]>([]);
    const [text, setText] = useState('');
    const open = async (t: Row) => { setSel(t); const r = await adminCall<{ messages: Row[] }>('getThread', { userId: t.user.id }); setMsgs(r.messages); reload(); };
    async function send() {
        if (!sel || !text.trim()) return;
        try { const r = await adminCall<{ message: Row }>('sendMessage', { userId: sel.user.id, body: text }); setMsgs(m => [...m, r.message]); setText(''); }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    }
    if (error) return <ErrorBox error={error} onRetry={reload} />;
    return (
        <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,0.9fr) minmax(0,1.4fr)', gap: 16, alignItems: 'start' }}>
            <div className="card" style={{ padding: 8 }}>
                {data?.threads?.length === 0 && <div className="empty-state"><div className="empty-title">No conversations</div><div className="empty-desc">Messages users send from the Messages page appear here. You can start one from a user's details.</div></div>}
                {(data?.threads || []).map(t => (
                    <button key={t.user.id} className="dropdown-item w-full" style={{ border: 'none', background: sel?.user.id === t.user.id ? 'var(--surface-2)' : 'none', alignItems: 'flex-start' }} onClick={() => open(t)}>
                        <span className="flex-1" style={{ textAlign: 'start', minWidth: 0 }}>
                            <span style={{ display: 'block', fontWeight: 600, color: 'var(--ink)' }}>{t.user.name || t.user.email}</span>
                            <span className="truncate" style={{ display: 'block', fontSize: 12.5 }}>{t.last.from_admin ? 'You: ' : ''}{t.last.body || '📎 Attachment'}</span>
                        </span>
                        {t.unread > 0 && <span className="nav-badge">{t.unread}</span>}
                    </button>
                ))}
            </div>
            <div className="card">
                {!sel ? <p className="text-sm text-muted">Choose a conversation.</p> : (
                    <>
                        <div className="card-head"><div className="card-title">{sel.user.name}</div><span className="text-xs text-muted">{sel.user.email || sel.user.phone}</span></div>
                        <div className="admin-thread" style={{ maxHeight: 420 }}>
                            {msgs.map(m => <div key={m.id} className={`bubble ${m.from_admin ? 'mine' : ''}`}><SupportFiles files={m.attachments} />{m.body && <div>{m.body}</div>}<time>{fmtDate(m.created_at)}</time></div>)}
                        </div>
                        <div className="flex gap-2 mt-2">
                            <input className="form-input" placeholder="Reply" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} aria-label="Reply" />
                            <button className="btn btn-primary" onClick={send} disabled={!text.trim()} aria-label="Send"><Send size={16} /></button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ───────────────────────── Announcements ─────────────────────────
function AnnouncementsTab() {
    const { data, error, reload } = useAdmin<{ announcements: Row[] }>('listAnnouncements');
    const [draft, setDraft] = useState<Row>({ title: '', body: '', level: 'info', endsAt: '' });
    async function save(e: React.FormEvent) {
        e.preventDefault();
        try { await adminCall('saveAnnouncement', { ...draft, endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null }); toast.success('Announcement published'); setDraft({ title: '', body: '', level: 'info', endsAt: '' }); reload(); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); }
    }
    if (error) return <ErrorBox error={error} onRetry={reload} />;
    return (
        <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 16, alignItems: 'start' }}>
            <form className="card" onSubmit={save}>
                <div className="card-title mb-4">New announcement</div>
                <p className="text-sm text-muted mb-4">Shows as a banner at the top of the app for every signed-in user until it ends or you switch it off.</p>
                <div className="form-group"><label className="form-label" htmlFor="an-t">Title</label><input id="an-t" className="form-input" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} required /></div>
                <div className="form-group"><label className="form-label" htmlFor="an-b">Details (optional)</label><textarea id="an-b" className="form-input" value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></div>
                <div className="flex gap-3">
                    <div className="form-group flex-1"><label className="form-label" htmlFor="an-l">Tone</label><select id="an-l" className="form-select" value={draft.level} onChange={e => setDraft({ ...draft, level: e.target.value })}><option value="info">Information</option><option value="success">Good news</option><option value="warning">Warning</option></select></div>
                    <div className="form-group flex-1"><label className="form-label" htmlFor="an-e">Ends (optional)</label><input id="an-e" type="datetime-local" className="form-input" value={draft.endsAt} onChange={e => setDraft({ ...draft, endsAt: e.target.value })} /></div>
                </div>
                <button className="btn btn-primary w-full"><Megaphone size={16} /> Publish</button>
            </form>
            <div className="card">
                <div className="card-title mb-4">All announcements</div>
                {data?.announcements?.length === 0 && <p className="text-sm text-muted">None yet.</p>}
                <div className="ledger">
                    {(data?.announcements || []).map(a => (
                        <div key={a.id} className="ledger-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                            <div>
                                <div className="ledger-title">{a.title}</div>
                                <div className="ledger-sub">{a.is_active ? (a.ends_at ? `Live until ${fmtDate(a.ends_at)}` : 'Live') : 'Off'} · {a.level}</div>
                            </div>
                            <div className="flex gap-2">
                                <button className="btn btn-secondary btn-sm" onClick={async () => { await adminCall('saveAnnouncement', { id: a.id, title: a.title, body: a.body, level: a.level, isActive: !a.is_active, endsAt: a.ends_at }); reload(); }}>{a.is_active ? 'Switch off' : 'Switch on'}</button>
                                <button className="icon-btn" aria-label={`Delete ${a.title}`} onClick={async () => { if (confirm('Delete this announcement?')) { await adminCall('deleteAnnouncement', { id: a.id }); reload(); } }}><Trash2 size={15} style={{ color: 'var(--cinnabar)' }} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ───────────────────────── Notify ─────────────────────────
function NotifyTab() {
    const { data } = useAdmin<{ users: Row[] }>('listUsers');
    const [audience, setAudience] = useState<'all' | 'some'>('all');
    const [picked, setPicked] = useState<string[]>([]);
    const [q, setQ] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const people = (data?.users || []).filter(u => u.id && `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
    async function send(e: React.FormEvent) {
        e.preventDefault();
        if (audience === 'all' && !confirm(`Send this to all ${data?.users.length ?? ''} users?`)) return;
        setBusy(true);
        try { const r = await adminCall<Row>('notify', { audience, userIds: picked, message }); toast.success(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`); setMessage(''); setPicked([]); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); }
        finally { setBusy(false); }
    }
    return (
        <form className="card" onSubmit={send} style={{ maxWidth: 720 }}>
            <div className="card-title mb-4">Send a notification</div>
            <p className="text-sm text-muted mb-4">It appears in the person's Activity & Notifications page and as a pop-up if they have the app open.</p>
            <div className="segmented mb-4">
                {(['all', 'some'] as const).map(k => (
                    <button type="button" key={k} aria-pressed={audience === k} onClick={() => setAudience(k)}>{audience === k && <motion.span layoutId="nt-seg" className="seg-pill" />}<span>{k === 'all' ? 'Everyone' : 'Chosen people'}</span></button>
                ))}
            </div>
            {audience === 'some' && (
                <div className="mb-4">
                    <div className="search-bar mb-2"><Search size={16} /><input placeholder="Find people" value={q} onChange={e => setQ(e.target.value)} aria-label="Find people" /></div>
                    <div className="category-chips" style={{ flexWrap: 'wrap', maxHeight: 160, overflowY: 'auto' }}>
                        {people.map(u => (
                            <button type="button" key={u.id} className={`chip ${picked.includes(u.id) ? 'selected' : ''}`} onClick={() => setPicked(p => p.includes(u.id) ? p.filter(x => x !== u.id) : [...p, u.id])}>{u.name}</button>
                        ))}
                    </div>
                    <p className="text-xs text-muted mt-2">{picked.length} chosen</p>
                </div>
            )}
            <div className="form-group"><label className="form-label" htmlFor="nt-m">Message</label><textarea id="nt-m" className="form-input" maxLength={500} value={message} onChange={e => setMessage(e.target.value)} required /></div>
            <button className="btn btn-primary" disabled={busy || (audience === 'some' && !picked.length)}><Send size={16} /> {busy ? 'Sending…' : 'Send notification'}</button>
        </form>
    );
}

// ───────────────────────── Logs ─────────────────────────
function LogsTab() {
    const { data, error, reload, loading } = useAdmin<{ logs: Row[] }>('logs', { limit: 300 });
    const [kind, setKind] = useState('all');
    if (error) return <ErrorBox error={error} onRetry={reload} />;
    const rows = (data?.logs || []).filter(l => kind === 'all' || l.kind === kind);
    return (
        <>
            <div className="flex gap-3 mb-4 items-center">
                <select className="form-select" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)} aria-label="Log type">
                    <option value="all">Everything</option><option value="admin">Admin actions</option><option value="signup">Sign-ups</option><option value="activity">Workspace activity</option>
                </select>
                <button className="btn btn-secondary btn-sm" onClick={reload} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
            </div>
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="data-table admin-table">
                    <thead><tr><th>When</th><th>Type</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
                    <tbody>
                        {rows.map((l, i) => (
                            <tr key={i}>
                                <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDate(l.at)}</td>
                                <td><span className={`badge ${l.kind === 'admin' ? 'badge-primary' : l.kind === 'signup' ? 'badge-success' : ''}`}>{l.kind}</span></td>
                                <td style={{ fontSize: 13 }}>{l.who || '—'}</td>
                                <td style={{ fontSize: 13 }}>{l.what}</td>
                                <td style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 320 }} className="truncate">{l.details ? Object.entries(l.details).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : ''}</td>
                            </tr>
                        ))}
                        {data && rows.length === 0 && <tr><td colSpan={5}><div className="empty-state"><div className="empty-desc">Nothing logged yet.</div></div></td></tr>}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ───────────────────────── Shell ─────────────────────────
export const TAB_LIST = TABS;
export type { Tab };

export default function Console({ me, tab, setTab }: { me: Me; tab: Tab; setTab: (t: Tab) => void }) {
    const [openUser, setOpenUser] = useState<string | null>(null);
    const [usersKey, setUsersKey] = useState(0);
    return (
        <MeContext.Provider value={me}>
            <AnimatePresence mode="wait">
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                    {tab === 'overview' && <Overview go={setTab} />}
                    {tab === 'users' && <UsersTab key={usersKey} onOpen={setOpenUser} />}
                    {tab === 'workspaces' && <WorkspacesTab />}
                    {tab === 'messages' && <MessagesTab />}
                    {tab === 'announcements' && <AnnouncementsTab />}
                    {tab === 'notify' && <NotifyTab />}
                    {tab === 'logs' && <LogsTab />}
                </motion.div>
            </AnimatePresence>
            <AnimatePresence>
                {openUser && <UserDrawer id={openUser} onClose={() => setOpenUser(null)} onChanged={() => setUsersKey(k => k + 1)} />}
            </AnimatePresence>
        </MeContext.Provider>
    );
}
