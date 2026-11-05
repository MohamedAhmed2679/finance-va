import { tx } from '../i18n/translations';
import { hasPendingJoin } from '../components/JoinInvite';
import { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, Smartphone, ArrowLeft } from 'lucide-react';
import { useStore } from '../store/useStore';
import { signInWithOAuth, signInWithEmail, signUpWithEmail, sendPhoneOtp, verifyPhoneOtp, resetPassword, updatePassword, onAuthStateChange, getAuthAvailability, friendlyAuthError, type AuthAvailability } from '../services/authProvider';
import { ZayloWave, ZPattern, ZayloLogo } from '../components/brand/Brand';

interface AuthPageProps { onAuth: () => void; }
type Mode = 'signin' | 'signup' | 'phone' | 'forgot' | 'recovery';

const COUNTRIES = [
    'Egypt', 'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Jordan', 'Lebanon', 'Morocco',
    'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Ireland',
    'India', 'Pakistan', 'Bangladesh', 'Turkey', 'Nigeria', 'South Africa', 'Kenya', 'Japan', 'South Korea', 'Singapore',
    'Malaysia', 'Indonesia', 'Philippines', 'Brazil', 'Mexico', 'Argentina', 'Other',
];

const PW_RULES: [RegExp, string][] = [
    [/.{8,}/, 'at least 8 characters'],
    [/[A-Z]/, 'an uppercase letter'],
    [/[a-z]/, 'a lowercase letter'],
    [/[0-9]/, 'a number'],
    [/[^A-Za-z0-9]/, 'a symbol'],
];

function passwordProblem(pw: string): string | null {
    const missing = PW_RULES.filter(([re]) => !re.test(pw)).map(([, label]) => label);
    return missing.length ? `Password needs ${missing.join(', ')}.` : null;
}

/** Normalises to E.164 (+countrycode…). Returns null when it can't be a real number. */
function toE164(raw: string): string | null {
    let s = raw.replace(/[^\d+]/g, '');
    if (s.startsWith('00')) s = '+' + s.slice(2);
    if (!s.startsWith('+')) return null;
    const digits = s.slice(1);
    return /^\d{8,15}$/.test(digits) ? '+' + digits : null;
}

function PasswordField({ id, value, onChange, autoComplete, meter }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; meter?: boolean }) {
    const [show, setShow] = useState(false);
    const score = PW_RULES.filter(([re]) => re.test(value)).length;
    return (
        <div className="form-group">
            <label className="form-label" htmlFor={id}>{tx('Password')}</label>
            <div className="pw-field">
                <input id={id} className="form-input" type={show ? 'text' : 'password'} value={value} required
                    autoComplete={autoComplete} onChange={e => onChange(e.target.value)} />
                <button type="button" className="pw-toggle" onClick={() => setShow(s => !s)} aria-label={show ? tx('Hide password') : tx('Show password')}>
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
            </div>
            {meter && (
                <>
                    <div className="pw-meter" aria-hidden="true">{PW_RULES.map((_, i) => <span key={i} className={i < score ? 'on' : ''} />)}</div>
                    <div className="pw-hint">{value ? (passwordProblem(value) ?? tx('Strong password.')) : tx('Use 8+ characters with upper and lower case, a number and a symbol.')}</div>
                </>
            )}
        </div>
    );
}

const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20H24v8h11.1C33.6 33.3 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z" /><path fill="#FF3D00" d="M6.3 14.7 13 19.6C14.9 14.6 19 11 24 11c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.8 13.6-4.7l-6.3-5.2c-2 1.4-4.5 2.2-7.3 2.2-5.2 0-9.5-3.2-11.1-7.6l-6.6 5.1C9.8 40 16.4 44 24 44z" /><path fill="#1976D2" d="M43.6 20H24v8h11.1c-.8 2.3-2.3 4.3-4.3 5.7l6.3 5.2c3.7-3.4 5.9-8.5 5.9-14.9 0-1.3-.1-2.7-.1-4z" /></svg>
);
const AppleIcon = () => (
    <svg width="16" height="18" viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-116.1-55.8-168-110.8S78 802.2 69 742.4c-9.7-64.7-5.5-182.7 66.9-298.1 38.6-60.8 99.2-120.2 167.3-120.2 82.1 0 136.9 43 197.7 43 59.5 0 102.2-43 197.7-43 51 0 99.9 30.6 133.4 53.7zM554.1 159.4c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" /></svg>
);
const MicrosoftIcon = () => (
    <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="#f25022" /><rect x="12" y="1" width="10" height="10" fill="#7fba00" /><rect x="1" y="12" width="10" height="10" fill="#00a4ef" /><rect x="12" y="12" width="10" height="10" fill="#ffb900" /></svg>
);

const swap = {
    initial: { opacity: 0, x: 14 },
    animate: { opacity: 1, x: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const } },
    exit: { opacity: 0, x: -10, transition: { duration: 0.12 } },
};

export default function AuthPage({ onAuth }: AuthPageProps) {
    const { login } = useStore();
    const [mode, setMode] = useState<Mode>(() =>
        window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery') ? 'recovery' : 'signin');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [country, setCountry] = useState('');
    const [code, setCode] = useState('');
    const [codeSent, setCodeSent] = useState(false);
    const [resendIn, setResendIn] = useState(0);

    const [loading, setLoading] = useState<string | null>(null);
    // Errors that come back from Google/Microsoft/Apple in the URL after a redirect
    const [error, setError] = useState(() => {
        const q = new URLSearchParams(window.location.search + '&' + window.location.hash.replace(/^#/, ''));
        const desc = q.get('error_description');
        return desc ? friendlyAuthError(decodeURIComponent(desc), 'Sign-in did not complete. Try again.') : '';
    });
    const [notice, setNotice] = useState('');

    const [avail, setAvail] = useState<AuthAvailability | null>(null);
    useEffect(() => { getAuthAvailability().then(setAvail); }, []);

    const switchMode = (m: Mode) => { setMode(m); setError(''); setNotice(''); };

    // Password-recovery link from email
    useEffect(() => {
        const { unsubscribe } = onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') setMode('recovery'); });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (resendIn <= 0) return;
        const t = setTimeout(() => setResendIn(r => r - 1), 1000);
        return () => clearTimeout(t);
    }, [resendIn]);

    const busy = loading !== null;

    function doLogin(userId: string, userName: string, userEmail: string, provider?: string, userPhone?: string) {
        login({
            id: userId,
            name: userName,
            email: userEmail,
            phone: userPhone || phone || undefined,
            referralCode: `FV-${userId.slice(0, 6).toUpperCase()}`,
            defaultCurrency: 'USD',
            language: 'en',
            theme: useStore.getState().theme || 'light',
            biometricEnabled: false,
            hideAmounts: false,
            connectedClouds: provider ? [provider] : [],
            backupInterval: 'weekly',
            createdAt: new Date().toISOString(),
        });
        onAuth();
    }

    async function oauth(provider: 'google' | 'apple' | 'azure') {
        setLoading(provider); setError('');
        const result = await signInWithOAuth(provider);
        if (!result.success) {
            setError(friendlyAuthError(result.error, 'Sign-in didn\'t complete. Try again.'));
            setLoading(null);
            return;
        }
        if (result.user) doLogin(result.user.id, result.user.name, result.user.email, provider);
        // On the web the page now redirects to the provider; keep the spinner until it does.
        setTimeout(() => setLoading(null), 8000);
    }

    async function onSignIn(e: React.FormEvent) {
        e.preventDefault();
        setLoading('email'); setError('');
        const result = await signInWithEmail(email.trim(), password);
        setLoading(null);
        if (!result.success) {
            setError(/invalid login/i.test(result.error || '') ? 'That email and password don\'t match an account.' : /confirm/i.test(result.error || '') ? 'Confirm your email first — the link is in your inbox.' : /banned/i.test(result.error || '') ? 'This account is suspended. Contact the Zaylo team.' : friendlyAuthError(result.error, 'Sign-in failed.'));
            return;
        }
        if (result.user) doLogin(result.user.id, result.user.name, result.user.email);
    }

    async function onSignUp(e: React.FormEvent) {
        e.preventDefault();
        const problem = passwordProblem(password);
        if (problem) { setError(problem); return; }
        let e164: string | undefined;
        if (phone.trim()) {
            const p = toE164(phone);
            if (!p) { setError(tx('Enter the phone number with its country code, for example +20 100 123 4567.')); return; }
            e164 = p;
        }
        setLoading('email'); setError('');
        const result = await signUpWithEmail(email.trim(), password, name.trim(), e164, country || undefined);
        setLoading(null);
        if (!result.success) { setError(/registered|exists/i.test(result.error || '') ? 'An account with this email already exists. Sign in instead.' : friendlyAuthError(result.error, 'Couldn\'t create the account.')); return; }
        if (result.needsConfirmation) {
            setMode('signin');
            setNotice(`Account created. Open the link we sent to ${email.trim()} to confirm it, then sign in.`);
            return;
        }
        if (result.user) doLogin(result.user.id, result.user.name, result.user.email, undefined, e164);
    }

    async function sendCode() {
        const e164 = toE164(phone);
        if (!e164) { setError(tx('Enter the phone number with its country code, for example +20 100 123 4567.')); return; }
        setPhone(e164);
        setLoading('phone'); setError(''); setNotice('');
        const result = await sendPhoneOtp(e164);
        setLoading(null);
        if (!result.success) { setError(friendlyAuthError(result.error, 'Couldn\'t send the code. Check the number and try again.')); return; }
        setCodeSent(true);
        setResendIn(60);
        setNotice(`We sent a 6-digit code to ${e164}.`);
    }

    async function onPhone(e: React.FormEvent) {
        e.preventDefault();
        if (!codeSent) return sendCode();
        if (!/^\d{6}$/.test(code)) { setError(tx('Enter the 6-digit code from the text message.')); return; }
        setLoading('phone'); setError('');
        const result = await verifyPhoneOtp(phone, code);
        setLoading(null);
        if (!result.success) { setError(friendlyAuthError(result.error, 'That code is wrong or has expired. Request a new one.')); return; }
        if (result.user) doLogin(result.user.id, result.user.name, result.user.email, 'phone', phone);
    }

    async function onForgot(e: React.FormEvent) {
        e.preventDefault();
        setLoading('email'); setError('');
        const result = await resetPassword(email.trim());
        setLoading(null);
        if (!result.success) { setError(result.error || 'Couldn\'t send the reset email.'); return; }
        setNotice('If that email has an account, a reset link is on its way.');
    }

    async function onRecovery(e: React.FormEvent) {
        e.preventDefault();
        const problem = passwordProblem(password);
        if (problem) { setError(problem); return; }
        setLoading('email'); setError('');
        const result = await updatePassword(password);
        setLoading(null);
        if (!result.success) { setError(result.error || 'Couldn\'t update the password.'); return; }
        setNotice('Password updated. Signing you in…');
        window.history.replaceState({}, '', '/');
        setTimeout(() => { setMode('signin'); onAuth(); }, 1200);
    }

    const titles: Record<Mode, [string, string]> = useMemo(() => ({
        signin: ['Welcome back', 'Sign in to see this month\'s spending.'],
        signup: ['Create your account', 'Free to use. Takes under a minute.'],
        phone: ['Continue with your phone', 'New here? This creates your account. We\'ll text you a 6-digit code.'],
        forgot: ['Reset your password', 'We\'ll email you a link to set a new one.'],
        recovery: ['Set a new password', 'Choose a password you haven\'t used here before.'],
    }), []);

    const providers = ([
        ['google', 'Google', <GoogleIcon key="g" />],
        ['apple', 'Apple', <AppleIcon key="a" />],
        ['azure', 'Microsoft', <MicrosoftIcon key="m" />],
    ] as const).filter(([k]) => !avail || avail[k]);
    const spinner = <span className="animate-spin" style={{ width: 16, height: 16, border: '2px solid var(--line-strong)', borderTopColor: 'var(--ink)', borderRadius: '50%' }} />;

    const social = providers.length === 0 ? null : (
        <>
            <div className="auth-social" style={{ gridTemplateColumns: `repeat(${providers.length}, 1fr)` }}>
                {providers.map(([k, label, icon]) => (
                    <button key={k} type="button" onClick={() => oauth(k)} disabled={busy} aria-label={`Continue with ${label}`}>
                        {loading === k ? spinner : icon} {label}
                    </button>
                ))}
            </div>
            <div className="auth-or">{tx('or with email')}</div>
        </>
    );

    const serverDown = avail && !avail.reachable && (
        <div className="auth-msg error" role="alert">{tx('Zaylo can\'t reach its server right now, so signing in and creating accounts won\'t work. Please try again shortly.')}</div>
    );

    const submit = (label: string, busyLabel: string) => (
        <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>
            {busy && loading !== 'google' && loading !== 'apple' && loading !== 'azure' ? busyLabel : label}
        </button>
    );

    return (
        <div className="auth">
            <section className="auth-hero">
                <ZPattern opacity={0.09} />
                <ZayloWave className="auth-wave" />
                <div className="auth-brand"><ZayloLogo size={34} onDark /></div>
                <div>
                    <motion.h1 className="auth-headline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
                        {tx('Your money. Your move.')}
                    </motion.h1>
                    <motion.p className="auth-lede" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
                        {tx('Track spending, bills and savings in any currency. Share a workspace with the people you plan with, and see where every pound, dollar and riyal went.')}
                    </motion.p>
                </div>
                <div className="auth-points">
                    <span>{tx('50+ currencies')}</span><span>{tx('Shared family workspaces')}</span><span>{tx('Add by voice or bank SMS')}</span><span>{tx('Arabic and English')}</span>
                </div>
            </section>

            <section className="auth-panel">
                <div className="auth-form-wrap">
                    {hasPendingJoin() && <div className="auth-msg ok" role="status" style={{ marginBottom: 18 }}>{tx('You\'ve been invited to a shared workspace. Sign in or create an account to join it.')}</div>}
                    {(mode === 'signin' || mode === 'signup') && (
                        <div className="segmented" role="tablist" style={{ marginBottom: 26 }}>
                            {(['signin', 'signup'] as const).map(m => (
                                <button key={m} type="button" role="tab" aria-pressed={mode === m} aria-selected={mode === m} onClick={() => switchMode(m)}>
                                    {mode === m && <motion.span layoutId="auth-seg" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                                    <span>{m === 'signin' ? tx('Sign in') : tx('Create account')}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {(mode === tx('phone') || mode === 'forgot') && (
                        <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 18, marginLeft: -10 }} onClick={() => { switchMode('signin'); setCodeSent(false); setCode(''); }}>
                            <ArrowLeft size={16} />{' '}{tx('Back to sign in')}
                        </button>
                    )}

                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div key={mode} {...swap}>
                            <h2 className="auth-title">{titles[mode][0]}</h2>
                            <p className="auth-sub">{titles[mode][1]}</p>

                            <AnimatePresence>
                                {error && <motion.div className="auth-msg error" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{error}</motion.div>}
                                {notice && <motion.div className="auth-msg ok" role="status" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{notice}</motion.div>}
                            </AnimatePresence>

                            {mode === 'signin' && (
                                <>
                                    {serverDown}
                                    {social}
                                    <form onSubmit={onSignIn} noValidate={false}>
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="si-email">{tx('Email')}</label>
                                            <input id="si-email" className="form-input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
                                        </div>
                                        <PasswordField id="si-pw" value={password} onChange={setPassword} autoComplete="current-password" />
                                        <div className="auth-row">
                                            {(!avail || avail.phone) ? <button type="button" className="auth-link" onClick={() => switchMode('phone')}><Smartphone size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />{tx('Use phone instead')}</button> : <span />}
                                            <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>{tx('Forgot password?')}</button>
                                        </div>
                                        {submit('Sign in', 'Signing in…')}
                                    </form>
                                </>
                            )}

                            {mode === 'signup' && (
                                <>
                                    {serverDown}
                                    {social}
                                    <form onSubmit={onSignUp}>
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="su-name">{tx('Full name')}</label>
                                            <input id="su-name" className="form-input" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="su-email">{tx('Email')}</label>
                                            <input id="su-email" className="form-input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
                                        </div>
                                        <div className="flex gap-3">
                                            <div className="form-group flex-1">
                                                <label className="form-label" htmlFor="su-phone">{tx('Phone (optional)')}</label>
                                                <input id="su-phone" className="form-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+20…" value={phone} onChange={e => setPhone(e.target.value)} />
                                            </div>
                                            <div className="form-group flex-1">
                                                <label className="form-label" htmlFor="su-country">{tx('Country')}</label>
                                                <select id="su-country" className="form-select" value={country} onChange={e => setCountry(e.target.value)}>
                                                    <option value="">{tx('Choose…')}</option>
                                                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        <PasswordField id="su-pw" value={password} onChange={setPassword} autoComplete="new-password" meter />
                                        {submit('Create account', 'Creating account…')}
                                    </form>
                                    {(!avail || avail.phone) && (
                                        <button type="button" className="btn btn-secondary w-full mt-4" onClick={() => switchMode('phone')}>
                                            <Smartphone size={16} />{' '}{tx('Sign up with a phone number instead')}
                                        </button>
                                    )}
                                </>
                            )}

                            {mode === tx('phone') && (
                                <form onSubmit={onPhone}>
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="ph">{tx('Phone number with country code')}</label>
                                        <input id="ph" className="form-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+20 100 123 4567" required
                                            disabled={codeSent} value={phone} onChange={e => setPhone(e.target.value)} />
                                    </div>
                                    <AnimatePresence>
                                        {codeSent && (
                                            <motion.div className="form-group" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                                                <label className="form-label" htmlFor="otp">{tx('6-digit code')}</label>
                                                <input id="otp" className="form-input form-input-lg" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
                                                    style={{ letterSpacing: '0.4em', textAlign: 'center' }}
                                                    value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                                                <div className="auth-row" style={{ margin: '8px 0 0' }}>
                                                    <button type="button" className="auth-link" onClick={() => { setCodeSent(false); setCode(''); setNotice(''); }}>{tx('Change number')}</button>
                                                    <button type="button" className="auth-link" disabled={resendIn > 0 || busy} style={{ opacity: resendIn > 0 ? 0.5 : 1 }} onClick={sendCode}>
                                                        {resendIn > 0 ? `Resend in ${resendIn}s` : tx('Resend code')}
                                                    </button>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                    <div style={{ marginTop: 8 }}>{submit(codeSent ? tx('Verify and sign in') : tx('Text me a code'), codeSent ? tx('Verifying…') : tx('Sending…'))}</div>
                                </form>
                            )}

                            {mode === 'forgot' && (
                                <form onSubmit={onForgot}>
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="fp-email">{tx('Email')}</label>
                                        <input id="fp-email" className="form-input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
                                    </div>
                                    {submit('Send reset link', 'Sending…')}
                                </form>
                            )}

                            {mode === 'recovery' && (
                                <form onSubmit={onRecovery}>
                                    <PasswordField id="rc-pw" value={password} onChange={setPassword} autoComplete="new-password" meter />
                                    {submit('Save new password', 'Saving…')}
                                </form>
                            )}
                        </motion.div>
                    </AnimatePresence>

                    <p className="auth-foot">{tx('By continuing you agree to the Terms and Privacy Policy.')}</p>
                </div>
            </section>
        </div>
    );
}
