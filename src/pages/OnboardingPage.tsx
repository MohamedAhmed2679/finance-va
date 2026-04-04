import { useState } from 'react';
import { useStore } from '../store/useStore';
import { CURRENCIES, SUPPORTED_LANGUAGES } from '../constants';
import { ChevronRight, Check } from 'lucide-react';

export default function OnboardingPage() {
    const { user, updateUser, completeOnboarding } = useStore();
    const [step, setStep] = useState(1);

    // Draft states
    const [name, setName] = useState(user?.name ?? '');
    const [currency, setCurrency] = useState(user?.defaultCurrency ?? 'USD');
    const [language, setLanguage] = useState(user?.language ?? 'en');
    const [biometric, setBiometric] = useState(false);

    function handleNext() {
        if (step === 1 && !name) return;
        if (step < 3) {
            setStep(step + 1);
        } else {
            // Finish
            updateUser({ name, defaultCurrency: currency, language, biometricEnabled: biometric });
            completeOnboarding();
        }
    }

    return (
        <div className="auth-screen">
            <div className="auth-glow" />

            <div className="auth-card animate-slideUp" style={{ maxWidth: 440, width: '100%' }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 32 }}>
                    {[1, 2, 3].map(i => (
                        <div key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: i <= step ? 'var(--primary)' : 'var(--border)', transition: 'background 300ms' }} />
                    ))}
                </div>

                {step === 1 && (
                    <div className="animate-fadeIn">
                        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Welcome to Finance VA</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>Let's set up your profile to personalize your experience.</div>
                        <div className="form-group">
                            <label className="form-label">What should we call you?</label>
                            <input
                                className="form-input form-input-lg"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Your preferred name"
                                autoFocus
                            />
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="animate-fadeIn">
                        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Preferences</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>Set your default currency and language.</div>

                        <div className="form-group">
                            <label className="form-label">Primary Currency</label>
                            <select className="form-input form-select form-input-lg" value={currency} onChange={e => setCurrency(e.target.value)}>
                                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code} – {c.name}</option>)}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Language</label>
                            <select className="form-input form-select form-input-lg" value={language} onChange={e => setLanguage(e.target.value)}>
                                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.nativeName} ({l.name})</option>)}
                            </select>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="animate-fadeIn">
                        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Security</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>Protect your financial data with biometric authentication.</div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', background: 'var(--bg-input)', borderRadius: 12, border: '1px solid var(--border)' }}>
                            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: 15 }}>Enable Face/Touch ID</div>
                                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Quick and secure access.</div>
                            </div>
                            <div onClick={() => setBiometric(!biometric)} style={{ width: 50, height: 28, borderRadius: 99, background: biometric ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background 200ms', cursor: 'pointer', flexShrink: 0 }}>
                                <div style={{ position: 'absolute', left: biometric ? 'calc(100% - 24px)' : 2, top: 2, width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left 200ms', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
                            </div>
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
                    {step > 1 && (
                        <button className="btn btn-secondary btn-lg" style={{ width: '100px' }} onClick={() => setStep(step - 1)}>Back</button>
                    )}
                    <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={handleNext} disabled={step === 1 && !name}>
                        {step === 3 ? <><Check size={18} /> Get Started</> : <>Next <ChevronRight size={18} /></>}
                    </button>
                </div>
            </div>
        </div>
    );
}
