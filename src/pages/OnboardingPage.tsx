import { tx } from '../i18n/translations';
import { useState } from 'react';
import { useStore } from '../store/useStore';
import { CURRENCIES, SUPPORTED_LANGUAGES } from '../constants';
import { ChevronRight, Check } from 'lucide-react';
import BiometricToggle from '../components/BiometricToggle';

export default function OnboardingPage() {
    const { user, updateUser, completeOnboarding, setLanguage: setAppLanguage, setCurrency: setAppCurrency, workspaces, activeWorkspaceId, updateWorkspace, expenses, incomes } = useStore();
    const [step, setStep] = useState(1);

    // Draft states
    const [name, setName] = useState(user?.name ?? '');
    const [currency, setCurrency] = useState(user?.defaultCurrency ?? 'USD');
    const [language, setLanguage] = useState(user?.language ?? 'en');
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const [smsEnabled, setSmsEnabled] = useState(true);

    function handleNext() {
        if (step === 1 && !name) return;
        if (step < 3) {
            setStep(step + 1);
        } else {
            // Finish
            // Apply the choices everywhere at once: the account, this device, and the workspace made for them.
            setAppLanguage(language);
            setAppCurrency(currency);
            updateUser({ name, defaultCurrency: currency, language, voiceEnabled, smsEnabled });
            const ws = workspaces.find(w => w.id === activeWorkspaceId) ?? workspaces[0];
            const ownsIt = ws && user && (ws.ownerId === user.dbId || ws.ownerId === user.id);
            const empty = ws && !expenses.some(e => e.workspaceId === ws.id) && !incomes.some(i => i.workspaceId === ws.id);
            if (ws && ownsIt && empty && ws.currency !== currency) updateWorkspace(ws.id, { currency });
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
                        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{tx('Welcome to Zaylo')}</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>{tx('Let\'s set up your profile to personalize your experience.')}</div>
                        <div className="form-group">
                            <label className="form-label">{tx('What should we call you?')}</label>
                            <input
                                className="form-input form-input-lg"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder={tx('Your preferred name')}
                                autoFocus
                            />
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="animate-fadeIn">
                        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{tx('Preferences')}</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>{tx('Set your default currency and language.')}</div>

                        <div className="form-group">
                            <label className="form-label">{tx('Primary Currency')}</label>
                            <select className="form-input form-select form-input-lg" value={currency} onChange={e => setCurrency(e.target.value)}>
                                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code} – {c.name}</option>)}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label">{tx('Language')}</label>
                            <select className="form-input form-select form-input-lg" value={language} onChange={e => { setLanguage(e.target.value); setAppLanguage(e.target.value); const u = useStore.getState().user; if (u) useStore.setState({ user: { ...u, language: e.target.value } }); }}>
                                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.nativeName} ({l.name})</option>)}
                            </select>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="animate-fadeIn">
                        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{tx('Security')}</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>{tx('Lock the app with your face or fingerprint, and choose how you add expenses.')}</div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <BiometricToggle />

                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', background: 'var(--bg-input)', borderRadius: 12, border: '1px solid var(--border)' }}>
                                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--info-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--info)' }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: 15 }}>{tx('Voice Entry')}</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tx('Speak expenses in multiple languages.')}</div>
                                </div>
                                <div onClick={() => setVoiceEnabled(!voiceEnabled)} style={{ width: 50, height: 28, borderRadius: 99, background: voiceEnabled ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background 200ms', cursor: 'pointer', flexShrink: 0 }}>
                                    <div style={{ position: 'absolute', left: voiceEnabled ? 'calc(100% - 24px)' : 2, top: 2, width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left 200ms', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', background: 'var(--bg-input)', borderRadius: 12, border: '1px solid var(--border)' }}>
                                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--income-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--income)' }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: 15 }}>{tx('SMS Scanning')}</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tx('Extract data from bank messages.')}</div>
                                </div>
                                <div onClick={() => setSmsEnabled(!smsEnabled)} style={{ width: 50, height: 28, borderRadius: 99, background: smsEnabled ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background 200ms', cursor: 'pointer', flexShrink: 0 }}>
                                    <div style={{ position: 'absolute', left: smsEnabled ? 'calc(100% - 24px)' : 2, top: 2, width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left 200ms', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
                    {step > 1 && (
                        <button className="btn btn-secondary btn-lg" style={{ width: '100px' }} onClick={() => setStep(step - 1)}>{tx('Back')}</button>
                    )}
                    <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={handleNext} disabled={step === 1 && !name}>
                        {step === 3 ? <><Check size={18} />{' '}{tx('Get Started')}</> : <>{tx('Next')}{' '}<ChevronRight size={18} /></>}
                    </button>
                </div>
            </div>
        </div>
    );
}
