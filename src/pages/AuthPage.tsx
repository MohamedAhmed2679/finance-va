import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { signInWithOAuth, signInWithEmail, signUpWithEmail, sendPhoneOtp, verifyPhoneOtp, resetPassword, updatePassword, onAuthStateChange } from '../services/authProvider';
import { Eye, EyeOff } from 'lucide-react';

interface AuthPageProps { onAuth: () => void; }

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

function PasswordInput({ label, value, onChange, required }: {
    label: string; value: string; onChange: (v: string) => void; required?: boolean;
}) {
    const [show, setShow] = useState(false);
    return (
        <div className={`floating-input-group ${value ? 'has-value' : ''}`}>
            <input type={show ? 'text' : 'password'} className="floating-input" value={value}
                onChange={e => onChange(e.target.value)} required={required} title={label} placeholder=" " />
            <label className="floating-label">{label}</label>
            <div className="floating-bar" />
            <button type="button" className="password-toggle-btn" onClick={() => setShow(!show)}
                title={show ? 'Hide password' : 'Show password'} tabIndex={-1}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
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

// Security Validation
function validatePassword(password: string): string | null {
    if (password.length < 8) return 'Password must be at least 8 characters long.';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
    if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]+/.test(password)) return 'Password must contain at least one special character.';
    return null; // Valid
}

export default function AuthPage({ onAuth }: AuthPageProps) {
    const { login } = useStore();
    const [isSignUp, setIsSignUp] = useState(false);
    
    // View States
    const [showPhone, setShowPhone] = useState(false);
    const [showForgot, setShowForgot] = useState(false);
    const [isRecoveryMode, setIsRecoveryMode] = useState(false);

    // Form Fields
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [country, setCountry] = useState('');
    const [code, setCode] = useState('');
    const [codeSent, setCodeSent] = useState(false);
    
    // Status
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const lang = 'en';

    // Intercept Password Recovery Link
    useEffect(() => {
        const hash = window.location.hash;
        const search = window.location.search;
        if (hash.includes('type=recovery') || search.includes('type=recovery')) {
            setTimeout(() => setIsRecoveryMode(true), 0);
        }

        // Also listen to Supabase events just in case
        const { unsubscribe } = onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                setIsRecoveryMode(true);
            }
        });

        return () => unsubscribe();
    }, []);

    // ─── OAuth Handlers ─────────────
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

    // ─── Email/Password Handlers ──────────────────────────────────
    async function handleSignInSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true); setError('');
        const result = await signInWithEmail(email, password);
        if (!result.success) { setError(result.error || 'Invalid login credentials'); setLoading(false); return; }
        if (result.user) doLogin(result.user.name, result.user.email);
        setLoading(false);
    }

    async function handleSignUpSubmit(e: React.FormEvent) {
        e.preventDefault();
        
        if (!country) {
            setError('Please select your country.');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        // Security checks
        const passError = validatePassword(password);
        if (passError) {
            setError(passError);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        setLoading(true); setError('');
        const result = await signUpWithEmail(email, password, name, phone, country);
        if (!result.success) {
            setError(result.error || 'Sign-up failed. Please check your details.');
            setLoading(false);
            return;
        }
        if (result.user) {
            setSuccessMsg('Account created successfully! Signing you in...');
            doLogin(result.user.name, result.user.email);
        }
        setLoading(false);
    }

    // ─── Phone OTP ───────────────────────────────────────────────
    async function handlePhoneSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(''); setSuccessMsg('');
        if (!codeSent) {
            setLoading(true);
            const result = await sendPhoneOtp(phone);
            if (!result.success) { setError(result.error || 'Failed to send code. Please ensure the number is correct.'); setLoading(false); return; }
            setCodeSent(true);
            setSuccessMsg(`Code sent to ${phone}`);
            setLoading(false);
            return;
        }
        setLoading(true);
        const result = await verifyPhoneOtp(phone, code);
        if (!result.success) { setError(result.error || 'Invalid code'); setLoading(false); return; }
        if (result.user) doLogin(result.user.name, result.user.email, 'phone');
        setLoading(false);
    }

    // ─── Password Reset Flow ─────────────────────────────────────
    async function handleForgotSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true); setError(''); setSuccessMsg('');
        const result = await resetPassword(email);
        if (!result.success) {
            setError(result.error || 'Failed to send reset email.');
            setLoading(false);
            return;
        }
        setSuccessMsg('If an account exists, a password reset link has been sent to your email.');
        setLoading(false);
    }

    async function handleUpdatePasswordSubmit(e: React.FormEvent) {
        e.preventDefault();
        const passError = validatePassword(password);
        if (passError) {
            setError(passError);
            return;
        }

        setLoading(true); setError(''); setSuccessMsg('');
        const result = await updatePassword(password);
        if (!result.success) {
            setError(result.error || 'Failed to update password.');
            setLoading(false);
            return;
        }
        setSuccessMsg('Password updated successfully. Signing you in...');
        setTimeout(() => {
            // After updating, we can proceed or mark recovery mode as done
            setIsRecoveryMode(false);
            onAuth(); // If they updated their password, Supabase created a session
        }, 1500);
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

    // Social icons row
    const socialIcons = (
        <div className="auth-social-grid">
            <button className="social-login-btn google" onClick={handleGoogleLogin} disabled={loading} title="Continue with Google">
                <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.1C33.6 33.3 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z" /><path fill="#FF3D00" d="M6.3 14.7 13 19.6C14.9 14.6 19 11 24 11c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.8 13.6-4.7l-6.3-5.2c-2 1.4-4.5 2.2-7.3 2.2-5.2 0-9.5-3.2-11.1-7.6l-6.6 5.1C9.8 40 16.4 44 24 44z" /><path fill="#1976D2" d="M43.6 20H24v8h11.1c-.8 2.3-2.3 4.3-4.3 5.7l6.3 5.2c3.7-3.4 5.9-8.5 5.9-14.9 0-1.3-.1-2.7-.1-4z" /></svg>
                <span>Google</span>
            </button>
            <button className="social-login-btn apple" onClick={handleAppleLogin} disabled={loading} title="Continue with Apple">
                <svg width="20" height="20" viewBox="0 0 814 1000" fill="currentColor"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-116.1-55.8-168-110.8S78 802.2 69 742.4c-9.7-64.7-5.5-182.7 66.9-298.1 38.6-60.8 99.2-120.2 167.3-120.2 82.1 0 136.9 43 197.7 43 59.5 0 102.2-43 197.7-43 51 0 99.9 30.6 133.4 53.7z" /></svg>
                <span>Apple</span>
            </button>
            <button className="social-login-btn microsoft" onClick={handleMicrosoftLogin} disabled={loading} title="Continue with Microsoft">
                <svg width="20" height="20" viewBox="0 0 23 23"><rect x="1" y="1" width="10" height="10" fill="#f25022" /><rect x="12" y="1" width="10" height="10" fill="#7fba00" /><rect x="1" y="12" width="10" height="10" fill="#00a4ef" /><rect x="12" y="12" width="10" height="10" fill="#ffb900" /></svg>
                <span>Microsoft</span>
            </button>
        </div>
    );

    // Render Password Recovery Mode (from email link)
    if (isRecoveryMode) {
        return (
            <div className="auth-screen">
                <div className="auth-glow" />
                <div className="auth-card animate-slideUp">
                    <div className="auth-logo-icon">FV</div>
                    <div className="auth-logo-title">Set New Password</div>
                    {error && <div className="auth-error-msg">{error}</div>}
                    {successMsg && <div className="auth-success-msg">{successMsg}</div>}
                    <form onSubmit={handleUpdatePasswordSubmit}>
                        <PasswordInput label="New Password" value={password} onChange={setPassword} required />
                        <button type="submit" className="btn btn-primary w-full btn-lg" disabled={loading}>
                            {loading ? 'Updating...' : 'Update Password'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // Render Forgot Password Screen
    if (showForgot) {
        return (
            <div className="auth-screen">
                <div className="auth-glow" />
                <div className="auth-card animate-slideUp">
                    <div className="auth-logo-icon">FV</div>
                    <div className="auth-logo-title">Reset Password</div>
                    <p className="auth-form-description">
                        Enter your email address and we'll send you a link to reset your password.
                    </p>
                    {error && <div className="auth-error-msg">{error}</div>}
                    {successMsg && <div className="auth-success-msg">{successMsg}</div>}
                    <form onSubmit={handleForgotSubmit}>
                        <FloatingInput label="Email Address" type="email" value={email} onChange={setEmail} required />
                        <button type="submit" className="btn btn-primary w-full btn-lg" disabled={loading}>
                            {loading ? 'Sending...' : 'Send Reset Link'}
                        </button>
                        <button type="button" className="btn btn-ghost w-full auth-back-btn"
                            onClick={() => { setShowForgot(false); setError(''); setSuccessMsg(''); }}>← Back to Sign In</button>
                    </form>
                </div>
            </div>
        );
    }

    // Render Phone sign-in overlay
    if (showPhone) {
        return (
            <div className="auth-screen">
                <div className="auth-glow" />
                <div className="auth-card animate-slideUp">
                    <div className="auth-logo-icon">FV</div>
                    <div className="auth-logo-title">Phone Sign In</div>
                    {error && <div className="auth-error-msg">{error}</div>}
                    {successMsg && <div className="auth-success-msg">{successMsg}</div>}
                    <form onSubmit={handlePhoneSubmit}>
                        <FloatingInput label={t(lang, 'phone') || 'Phone Number (e.g. +1234567)'} type="tel" value={phone} onChange={setPhone} required disabled={codeSent} />
                        {codeSent && (
                            <div className="animate-fadeIn">
                                <FloatingInput label={t(lang, 'verify_code') || 'Verification Code'} value={code} onChange={setCode} required maxLength={6} autoFocus />
                            </div>
                        )}
                        <button type="submit" className="btn btn-primary w-full btn-lg" disabled={loading}>
                            {loading ? '...' : codeSent ? 'Verify Code' : 'Send SMS Code'}
                        </button>
                        <button type="button" className="btn btn-ghost w-full auth-back-btn"
                            onClick={() => { setShowPhone(false); setCodeSent(false); setError(''); setSuccessMsg(''); }}>← Back</button>
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
                                {successMsg && <div className="auth-success-msg">{successMsg}</div>}
                                {socialIcons}
                                <div className="auth-divider"><span>or continue with email</span></div>
                                <form onSubmit={handleSignInSubmit}>
                                    <FloatingInput label="Email" type="email" value={email} onChange={setEmail} required />
                                    <PasswordInput label="Password" value={password} onChange={setPassword} required />
                                    <button type="button" className="auth-forgot-link" 
                                        onClick={() => { setShowForgot(true); setError(''); setSuccessMsg(''); }}>
                                        Forgot Your Password?
                                    </button>
                                    <button type="submit" className="btn auth-btn-submit" disabled={loading}>
                                        {loading ? 'Signing in...' : 'SIGN IN'}
                                    </button>
                                </form>
                                <button className="btn btn-ghost auth-phone-btn" onClick={() => { setShowPhone(true); setError(''); setSuccessMsg(''); }}>📱 Sign in with Phone</button>
                            </>
                        ) : (
                            <>
                                <h2 className="auth-form-title">Create Account</h2>
                                {error && <div className="auth-error-msg">{error}</div>}
                                {successMsg && <div className="auth-success-msg">{successMsg}</div>}
                                {socialIcons}
                                <div className="auth-divider"><span>or continue with email</span></div>
                                <form onSubmit={handleSignUpSubmit}>
                                    <FloatingInput label="Full Name" value={name} onChange={setName} required />
                                    <FloatingInput label="Email" type="email" value={email} onChange={setEmail} required />
                                    <FloatingInput label="Phone Number (Include Country Code)" type="tel" value={phone} onChange={setPhone} required />
                                    <div className={`floating-input-group ${country ? 'has-value' : ''}`}>
                                        <select className="floating-input floating-select" title="Country" value={country}
                                            onChange={e => setCountry(e.target.value)}>
                                            <option value="" disabled hidden> </option>
                                            {COUNTRIES.map(c => (<option key={c} value={c}>{c}</option>))}
                                        </select>
                                        <label className="floating-label">Country</label>
                                        <div className="floating-bar" />
                                    </div>
                                    <PasswordInput label="Password" value={password} onChange={setPassword} required />
                                    <p className="auth-password-hint">
                                        Must be 8+ chars and contain upper, lower, number, and special character.
                                    </p>
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
                                <button className="btn auth-overlay-btn" onClick={() => { setIsSignUp(true); setError(''); setSuccessMsg(''); }}>SIGN UP</button>
                            </div>
                        ) : (
                            <div className="auth-overlay-content animate-fadeIn">
                                <h2 className="auth-overlay-title">Welcome Back</h2>
                                <p className="auth-overlay-desc">To keep connected with us please login with your personal info</p>
                                <button className="btn auth-overlay-btn" onClick={() => { setIsSignUp(false); setError(''); setSuccessMsg(''); }}>SIGN IN</button>
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
