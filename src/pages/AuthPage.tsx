import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { signInWithOAuth, signInWithEmail, signUpWithEmail, sendPhoneOtp, verifyPhoneOtp } from '../services/authProvider';


interface AuthPageProps { onAuth: () => void; }

function getOAuthErrorFromUrl(): string {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);
    const errorCode = queryParams.get('error_code') || hashParams.get('error_code');
    const errorDescription = queryParams.get('error_description') || hashParams.get('error_description');
    const oauthError = queryParams.get('error') || hashParams.get('error');
    const decodedDescription = errorDescription ? decodeURIComponent(errorDescription.replace(/\+/g, ' ')) : '';

    return decodedDescription || errorCode || oauthError || '';
}

function FloatingInput({ label, type = 'text', value, onChange, required, disabled, maxLength, autoFocus }: {
    label: string; type?: string; value: string; onChange: (v: string) => void;
    required?: boolean; disabled?: boolean; maxLength?: number; autoFocus?: boolean;
}) {
    return (
        <div className={`floating-input-group ${value ? 'has-value' : ''}`}>
            <input type={type} className="floating-input" value={value}
                onChange={e => onChange(e.target.value)} required={required} title={label}
                disabled={disabled} maxLength={maxLength} autoFocus={autoFocus} placeholder=" " />
            <label className="floating-label">{label}</label>
            <div className="floating-bar" />
        </div>
    );
}
const COUNTRIES = [
    'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France', 'India',
    'Saudi Arabia', 'UAE', 'Egypt', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Jordan', 'Lebanon',
    'Japan', 'South Korea', 'Brazil', 'Mexico', 'Italy', 'Spain', 'Netherlands', 'Sweden',
    'Norway', 'Denmark', 'Finland', 'Switzerland', 'Turkey', 'South Africa', 'Nigeria',
    'Singapore', 'Malaysia', 'Indonesia', 'Philippines', 'Thailand', 'Vietnam', 'Pakistan',
    'Bangladesh', 'New Zealand', 'Ireland', 'Portugal', 'Poland', 'Czech Republic', 'Romania',
    'Greece', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Other',
];

export default function AuthPage({ onAuth }: AuthPageProps) {
    const { login } = useStore();
    const oauthErrorMessage = getOAuthErrorFromUrl();
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [country, setCountry] = useState('');
    const [code, setCode] = useState('');
    const [codeSent, setCodeSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showPhone, setShowPhone] = useState(false);
    const [error, setError] = useState(oauthErrorMessage);
    const lang = 'en';

    useEffect(() => {
        if (!oauthErrorMessage) return;

        const cleanedUrl = `${window.location.origin}${window.location.pathname}`;
        window.history.replaceState({}, document.title, cleanedUrl);
    }, [oauthErrorMessage]);

    // ─── OAuth Handlers (Google / Apple / Microsoft) ─────────────
    async function handleGoogleLogin() {
        setLoading(true); setError('');
        const result = await signInWithOAuth('google');
        if (!result.success) { setError(result.error || 'Google sign-in failed'); setLoading(false); return; }
        if (result.user) doLogin(result.user.name, result.user.email, 'google');
        setLoading(false);
    }
    async function handleAppleLogin() {
        setLoading(true); setError('');
        const result = await signInWithOAuth('apple');
        if (!result.success) { setError(result.error || 'Apple sign-in failed'); setLoading(false); return; }
        if (result.user) doLogin(result.user.name, result.user.email, 'apple');
        setLoading(false);
    }
    async function handleMicrosoftLogin() {
        setLoading(true); setError('');
        const result = await signInWithOAuth('azure');
        if (!result.success) { setError(result.error || 'Microsoft sign-in failed'); setLoading(false); return; }
        if (result.user) doLogin(result.user.name, result.user.email, 'microsoft');
        setLoading(false);
    }

    // ─── Email/Password Sign-In ──────────────────────────────────
    async function handleSignInSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true); setError('');
        const result = await signInWithEmail(email, password);
        if (!result.success) { setError(result.error || 'Sign-in failed'); setLoading(false); return; }
        if (result.user) doLogin(result.user.name, result.user.email);
        setLoading(false);
    }

    // ─── Email/Password Sign-Up ──────────────────────────────────
    async function handleSignUpSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true); setError('');
        const result = await signUpWithEmail(email, password, name, phone, country);
        if (!result.success) { setError(result.error || 'Sign-up failed'); setLoading(false); return; }
        if (result.user) doLogin(result.user.name, result.user.email);
        setLoading(false);
    }

    // ─── Phone OTP ───────────────────────────────────────────────
    async function handlePhoneSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        if (!codeSent) {
            setLoading(true);
            const result = await sendPhoneOtp(phone);
            if (!result.success) { setError(result.error || 'Failed to send code'); setLoading(false); return; }
            setCodeSent(true);
            setLoading(false);
            return;
        }
        setLoading(true);
        const result = await verifyPhoneOtp(phone, code);
        if (!result.success) { setError(result.error || 'Invalid code'); setLoading(false); return; }
        if (result.user) doLogin(result.user.name, result.user.email, 'phone');
        setLoading(false);
    }

    // ─── Final Login → Zustand Store ─────────────────────────────
    function doLogin(userName: string, userEmail: string, provider?: string) {
        login({
            id: `user_${Date.now()}`,
            name: userName,
            email: userEmail,
            phone: phone || undefined,
            referralCode: `FV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
            defaultCurrency: 'USD',
            language: 'en',
            theme: 'dark',
            biometricEnabled: false,
            hideAmounts: false,
            connectedClouds: provider ? [provider] : [],
            backupInterval: 'weekly',
            createdAt: new Date().toISOString()
        });
        onAuth();
    }


    // FloatingInput is declared outside the component at module scope

    // Social icons row (reusable)
    const socialIcons = (
        <div className="auth-social-row">
            <button className="auth-social-icon" onClick={handleGoogleLogin} disabled={loading} title="Google">
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.1C33.6 33.3 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z" /><path fill="#FF3D00" d="M6.3 14.7 13 19.6C14.9 14.6 19 11 24 11c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.8 13.6-4.7l-6.3-5.2c-2 1.4-4.5 2.2-7.3 2.2-5.2 0-9.5-3.2-11.1-7.6l-6.6 5.1C9.8 40 16.4 44 24 44z" /><path fill="#1976D2" d="M43.6 20H24v8h11.1c-.8 2.3-2.3 4.3-4.3 5.7l6.3 5.2c3.7-3.4 5.9-8.5 5.9-14.9 0-1.3-.1-2.7-.1-4z" /></svg>
            </button>
            <button className="auth-social-icon" onClick={handleAppleLogin} disabled={loading} title="Apple">
                <svg width="18" height="18" viewBox="0 0 814 1000" fill="currentColor"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-116.1-55.8-168-110.8S78 802.2 69 742.4c-9.7-64.7-5.5-182.7 66.9-298.1 38.6-60.8 99.2-120.2 167.3-120.2 82.1 0 136.9 43 197.7 43 59.5 0 102.2-43 197.7-43 51 0 99.9 30.6 133.4 53.7z" /></svg>
            </button>
            <button className="auth-social-icon" onClick={handleMicrosoftLogin} disabled={loading} title="Microsoft">
                <svg width="18" height="18" viewBox="0 0 23 23"><rect x="1" y="1" width="10" height="10" fill="#f25022" /><rect x="12" y="1" width="10" height="10" fill="#7fba00" /><rect x="1" y="12" width="10" height="10" fill="#00a4ef" /><rect x="12" y="12" width="10" height="10" fill="#ffb900" /></svg>
            </button>
        </div>
    );

    // Phone sign-in overlay
    if (showPhone) {
        return (
            <div className="auth-screen">
                <div className="auth-glow" />
                <div className="auth-card animate-slideUp">
                    <div className="auth-logo-icon" style={{ margin: '0 auto 12px' }}>FV</div>
                    <div className="auth-logo-title">Phone Sign In</div>
                    {error && <div className="auth-error-msg">{error}</div>}
                    <form onSubmit={handlePhoneSubmit}>
                        <FloatingInput label={t(lang, 'phone') || 'Phone Number'} type="tel" value={phone} onChange={setPhone} required disabled={codeSent} />
                        {codeSent && (
                            <div className="animate-fadeIn">
                                <FloatingInput label={t(lang, 'verify_code') || 'Verification Code'} value={code} onChange={setCode} required maxLength={6} autoFocus />
                                <div className="auth-code-sent">✓ Code sent to {phone}</div>
                            </div>
                        )}
                        <button type="submit" className="btn btn-primary w-full btn-lg" disabled={loading}>
                            {loading ? '...' : codeSent ? 'Verify' : 'Send Code'}
                        </button>
                        <button type="button" className="btn btn-ghost w-full mt-2"
                            onClick={() => { setShowPhone(false); setCodeSent(false); }}>← Back</button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-screen">
            <div className="auth-glow" />

            <div className="auth-container">
                {/* Left side: form area (only one form at a time) */}
                <div className="auth-form-panel auth-sign-in" key={isSignUp ? 'signup' : 'signin'}>
                    <div className="auth-form-inner animate-fadeIn">
                        {!isSignUp ? (
                            <>
                                <h2 className="auth-form-title">Sign in</h2>
                                {error && <div className="auth-error-msg">{error}</div>}
                                {socialIcons}
                                <div className="auth-divider"><span>or use your account</span></div>
                                <form onSubmit={handleSignInSubmit}>
                                    <FloatingInput label="Email" type="email" value={email} onChange={setEmail} required />
                                    <FloatingInput label="Password" type="password" value={password} onChange={setPassword} required />
                                    <a href="#" className="auth-forgot-link">Forgot Your Password?</a>
                                    <button type="submit" className="btn auth-btn-submit" disabled={loading}>
                                        {loading ? 'Signing in...' : 'SIGN IN'}
                                    </button>
                                </form>
                                <button className="btn btn-ghost auth-phone-btn" onClick={() => setShowPhone(true)}>📱 Sign in with Phone</button>
                            </>
                        ) : (
                            <>
                                <h2 className="auth-form-title">Create Account</h2>
                                {error && <div className="auth-error-msg">{error}</div>}
                                {socialIcons}
                                <div className="auth-divider"><span>or register with your details</span></div>
                                <form onSubmit={handleSignUpSubmit}>
                                    <FloatingInput label="Full Name" value={name} onChange={setName} required />
                                    <FloatingInput label="Email" type="email" value={email} onChange={setEmail} required />
                                    <FloatingInput label="Phone Number" type="tel" value={phone} onChange={setPhone} required />
                                    <div className={`floating-input-group ${country ? 'has-value' : ''}`}>
                                        <select className="floating-input floating-select" title="Country" value={country}
                                            onChange={e => setCountry(e.target.value)} required>
                                            <option value="" disabled hidden> </option>
                                            {COUNTRIES.map(c => (<option key={c} value={c}>{c}</option>))}
                                        </select>
                                        <label className="floating-label">Country</label>
                                        <div className="floating-bar" />
                                    </div>
                                    <FloatingInput label="Password" type="password" value={password} onChange={setPassword} required />
                                    <button type="submit" className="btn auth-btn-submit" disabled={loading}>
                                        {loading ? 'Creating...' : 'SIGN UP'}
                                    </button>
                                </form>
                            </>
                        )}
                    </div>
                </div>

                {/* Right side: overlay with toggle */}
                <div className="auth-overlay-container-static">
                    <div className="auth-overlay-static">
                        {!isSignUp ? (
                            <div className="auth-overlay-content animate-fadeIn">
                                <h2 className="auth-overlay-title">Hello, Friend!</h2>
                                <p className="auth-overlay-desc">Enter Your Personal Details and start your journey with us</p>
                                <button className="btn auth-overlay-btn" onClick={() => setIsSignUp(true)}>SIGN UP</button>
                            </div>
                        ) : (
                            <div className="auth-overlay-content animate-fadeIn">
                                <h2 className="auth-overlay-title">Welcome Back</h2>
                                <p className="auth-overlay-desc">To keep connected with us please login with your personal info</p>
                                <button className="btn auth-overlay-btn" onClick={() => setIsSignUp(false)}>SIGN IN</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <p className="auth-terms">
                By continuing, you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a>
            </p>
        </div>
    );
}
