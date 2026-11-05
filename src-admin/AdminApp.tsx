import { useEffect, useState } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { LogOut, ExternalLink, Menu, X } from 'lucide-react';
import { sb, MAIN_APP_URL, CONSOLE_BASE, type Me } from './client';
import { Seal } from '../src/components/brand/Brand';
import Console, { TAB_LIST, type Tab } from './Console';

type Gate =
    | { state: 'loading' }
    | { state: 'signed-out'; message?: string }
    | { state: 'recovery' }
    | { state: 'ready'; me: Me };

/** Reads public.users for the signed-in account; only is_admin accounts get in. */
async function resolveAdmin(): Promise<Gate> {
    if (!sb) return { state: 'signed-out', message: 'The console is not connected to the database.' };
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return { state: 'signed-out' };
    const { data: row, error } = await sb.from('users').select('id, name, email, is_admin').eq('auth_id', user.id).maybeSingle();
    if (error || !row?.is_admin) {
        await sb.auth.signOut();
        return { state: 'signed-out', message: `${user.email || 'This account'} is not an administrator.` };
    }
    return { state: 'ready', me: { id: row.id, name: row.name || user.email || 'Admin', email: row.email || user.email || '' } };
}

export default function AdminApp() {
    const [gate, setGate] = useState<Gate>({ state: 'loading' });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', 'light');
        const err = new URLSearchParams(window.location.search).get('error_description');
        resolveAdmin().then(g => setGate(err && g.state === 'signed-out' ? { state: 'signed-out', message: err } : g));
        const { data } = sb?.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') setGate({ state: 'recovery' });
            else if (event === 'SIGNED_OUT') setGate(g => g.state === 'ready' ? { state: 'signed-out' } : g);
        }) ?? { data: null };
        return () => data?.subscription.unsubscribe();
    }, []);

    let content;
    if (gate.state === 'loading') content = <div className="adm-loading"><Seal size={44} /></div>;
    else if (gate.state === 'signed-out') content = <SignIn message={gate.message} onDone={() => resolveAdmin().then(setGate)} />;
    else if (gate.state === 'recovery') content = <NewPassword onDone={() => resolveAdmin().then(setGate)} />;
    else content = <Shell me={gate.me} />;

    return (
        <MotionConfig reducedMotion="user">
            {content}
            <Toaster position="top-center" toastOptions={{ style: { background: 'var(--ink)', color: 'var(--paper)', borderRadius: 12, fontSize: 14 } }} />
        </MotionConfig>
    );
}

// ───────────────────────── Sign in ─────────────────────────
function SignIn({ message, onDone }: { message?: string; onDone: () => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(message || '');
    const [info, setInfo] = useState('');

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!sb) return;
        setBusy(true); setError(''); setInfo('');
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        setBusy(false);
        if (error) setError(/invalid login/i.test(error.message) ? 'That email and password don\'t match an account.' : error.message);
        else onDone();
    }
    async function microsoft() {
        if (!sb) return;
        setError('');
        const { error } = await sb.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email openid profile', redirectTo: `${window.location.origin}${CONSOLE_BASE}/` } });
        if (error) setError(error.message);
    }
    async function forgot() {
        if (!sb) return;
        if (!email.trim()) { setError('Enter your email first, then choose "Set or reset password".'); return; }
        setBusy(true); setError('');
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${CONSOLE_BASE}/` });
        setBusy(false);
        if (error) setError(error.message); else setInfo(`We sent a link to ${email.trim()}. Open it on this device to choose a password.`);
    }

    return (
        <main className="adm-auth">
            <motion.form className="adm-auth-card" onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                <div className="adm-auth-brand"><Seal size={40} /><div><strong>Finance VA</strong><span>Administration</span></div></div>
                <h1 className="auth-title">Sign in to the console</h1>
                <p className="auth-sub">For Finance VA administrators only. Every action is logged.</p>
                {error && <div className="auth-msg error" role="alert">{error}</div>}
                {info && <div className="auth-msg" style={{ background: 'var(--note-soft)', color: 'var(--note)' }} role="status">{info}</div>}
                <div className="form-group"><label className="form-label" htmlFor="a-email">Email</label>
                    <input id="a-email" type="email" autoComplete="username" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required /></div>
                <div className="form-group"><label className="form-label" htmlFor="a-pw">Password</label>
                    <input id="a-pw" type="password" autoComplete="current-password" className="form-input" value={password} onChange={e => setPassword(e.target.value)} required /></div>
                <button className="btn btn-primary w-full btn-lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
                <button type="button" className="adm-link" onClick={forgot} disabled={busy}>Set or reset password</button>
                <div className="auth-or">or</div>
                <button type="button" className="btn btn-secondary w-full" onClick={microsoft}>
                    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true"><path fill="#F25022" d="M0 0h10v10H0z" /><path fill="#7FBA00" d="M11 0h10v10H11z" /><path fill="#00A4EF" d="M0 11h10v10H0z" /><path fill="#FFB900" d="M11 11h10v10H11z" /></svg>
                    Sign in with Microsoft
                </button>
            </motion.form>
        </main>
    );
}

function NewPassword({ onDone }: { onDone: () => void }) {
    const [pw, setPw] = useState('');
    const [pw2, setPw2] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (pw !== pw2) { setError('The two passwords are different.'); return; }
        setBusy(true);
        const { error } = await sb!.auth.updateUser({ password: pw });
        setBusy(false);
        if (error) setError(error.message); else onDone();
    }
    return (
        <main className="adm-auth">
            <form className="adm-auth-card" onSubmit={submit}>
                <div className="adm-auth-brand"><Seal size={40} /><div><strong>Finance VA</strong><span>Administration</span></div></div>
                <h1 className="auth-title">Choose a new password</h1>
                <p className="auth-sub">At least 8 characters. You'll use it with your email to sign in here and in the app.</p>
                {error && <div className="auth-msg error" role="alert">{error}</div>}
                <div className="form-group"><label className="form-label" htmlFor="np1">New password</label><input id="np1" type="password" autoComplete="new-password" minLength={8} className="form-input" value={pw} onChange={e => setPw(e.target.value)} required /></div>
                <div className="form-group"><label className="form-label" htmlFor="np2">Repeat it</label><input id="np2" type="password" autoComplete="new-password" minLength={8} className="form-input" value={pw2} onChange={e => setPw2(e.target.value)} required /></div>
                <button className="btn btn-primary w-full btn-lg" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
            </form>
        </main>
    );
}

// ───────────────────────── Shell ─────────────────────────
function Shell({ me }: { me: Me }) {
    const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') as Tab) || 'overview');
    const [navOpen, setNavOpen] = useState(false);
    useEffect(() => {
        const u = new URL(window.location.href);
        u.search = ''; u.hash = ''; u.searchParams.set('tab', tab);
        window.history.replaceState({}, '', u);
    }, [tab]);
    const current = TAB_LIST.find(t => t.key === tab)!;

    return (
        <div className="adm-shell">
            <aside className={`adm-rail ${navOpen ? 'open' : ''}`} aria-label="Console sections">
                <div className="adm-rail-brand"><Seal size={34} tone="paper" /><div><strong>Finance VA</strong><span>Admin console</span></div>
                    <button className="adm-rail-close" onClick={() => setNavOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
                <nav>
                    {TAB_LIST.map(t => (
                        <button key={t.key} className={`adm-rail-item ${tab === t.key ? 'active' : ''}`} aria-current={tab === t.key ? 'page' : undefined}
                            onClick={() => { setTab(t.key); setNavOpen(false); }}>
                            {tab === t.key && <motion.span layoutId="adm-pill" className="adm-rail-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                            <t.icon size={18} /><span>{t.label}</span>
                        </button>
                    ))}
                </nav>
                <div className="adm-rail-foot">
                    <a className="adm-rail-item" href={MAIN_APP_URL} target="_blank" rel="noreferrer"><ExternalLink size={17} /><span>Open Finance VA</span></a>
                    <div className="adm-me">
                        <span className="user-avatar" style={{ width: 32, height: 32, fontSize: 13 }}>{me.name[0]?.toUpperCase()}</span>
                        <span className="adm-me-text"><strong>{me.name}</strong><span>{me.email}</span></span>
                        <button className="adm-icon" onClick={() => sb?.auth.signOut()} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
                    </div>
                </div>
            </aside>
            {navOpen && <div className="adm-scrim" onClick={() => setNavOpen(false)} />}
            <main className="adm-main">
                <header className="adm-top">
                    <button className="adm-icon adm-menu" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
                    <h1>{current.label}</h1>
                </header>
                <div className="adm-body">
                    <Console me={me} tab={tab} setTab={setTab} />
                </div>
            </main>
        </div>
    );
}
