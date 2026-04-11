import { useState } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { CURRENCIES, SUPPORTED_LANGUAGES } from '../constants';
import { Copy, Check, Shield, Bell, Download, LogOut, User, Globe, Lock, ChevronRight, Cloud, Monitor, Tags, Plus, Trash2, Briefcase, Wand2 } from 'lucide-react';
import { exportToPDF } from '../utils/pdfExport';

export default function SettingsPage() {
    const { user, workspaces, activeWorkspaceId, updateWorkspace, updateUser, setTheme, theme, language, setLanguage, currency, setCurrency, logout, deleteAllData, expenses, categories, paymentMethods, addCategory, deleteCategory, addPaymentMethod, deletePaymentMethod } = useStore();
    const lang = user?.language ?? 'en';

    const [langDraft, setLangDraft] = useState(language);
    const [curDraft, setCurDraft] = useState(currency);
    const [copied, setCopied] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [displayName, setDisplayName] = useState(user?.name ?? '');
    const [activeSection, setActiveSection] = useState<string | null>('profile');

    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);

    const [showEmailModal, setShowEmailModal] = useState(false);
    const [oauthProvider, setOauthProvider] = useState<'google' | 'apple' | 'microsoft' | null>(null);
    const [oauthMode, setOauthMode] = useState<'email' | 'cloud' | null>(null);
    const [oauthConnecting, setOauthConnecting] = useState(false);
    const [emailInput, setEmailInput] = useState('');
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    // Categories state
    const [newCatName, setNewCatName] = useState('');
    const [newCatEmoji, setNewCatEmoji] = useState('📦');
    const [newCatColor, setNewCatColor] = useState('#3b82f6');

    // Payment method state
    const [newPmName, setNewPmName] = useState('');
    const [newPmEmoji, setNewPmEmoji] = useState('💳');

    function handleSaveLangCurrency() {
        setLanguage(langDraft);
        setCurrency(curDraft);
        if (user) updateUser({ language: langDraft, defaultCurrency: curDraft });
        
        // Also update the active workspace currency so the dashboard reflects it
        if (activeWorkspaceId) {
            updateWorkspace(activeWorkspaceId, { currency: curDraft });
        }

        setSaveSuccess(true);
        // Apply RTL if Arabic
        document.documentElement.dir = langDraft === 'ar' ? 'rtl' : 'ltr';
        setTimeout(() => setSaveSuccess(false), 3000);
    }

    const handleCopyReferral = () => {
        navigator.clipboard.writeText(user?.referralCode ?? '');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleOauthConnect = (provider: 'google' | 'apple' | 'microsoft', mode: 'email' | 'cloud') => {
        setOauthProvider(provider);
        setOauthMode(mode);
    };

    const processOauth = () => {
        setOauthConnecting(true);
        setTimeout(() => {
            setOauthConnecting(false);
            if (oauthMode === 'cloud') {
                updateUser({ connectedClouds: [...(user?.connectedClouds || []), oauthProvider!] });
            } else if (oauthMode === 'email') {
                updateUser({ email: emailInput });
                setShowEmailModal(false);
            }
            setOauthProvider(null);
            setOauthMode(null);
        }, 1500);
    };

    function handleExportCSV() {
        const rows = [['Date', 'Merchant', 'Description', 'Category', 'Amount', 'Currency', 'Payment Method']];
        expenses.filter(e => !e.deleted).forEach(e => { rows.push([e.purchaseAt.slice(0, 10), e.merchant, e.description, e.category, String(e.amount), e.currency, e.paymentMethod]); });
        const csv = rows.map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'financeva_export.csv'; a.click();
    }

    function handleExportPDF() {
        exportToPDF(expenses.filter(e => !e.deleted), categories, user);
    }

    const menuSections = [
        { id: 'profile', label: t(lang, 'profile'), icon: User },
        { id: 'workspace', label: 'Workspace', icon: Briefcase },
        { id: 'language', label: t(lang, 'language_region'), icon: Globe },
        { id: 'security', label: t(lang, 'security_privacy'), icon: Lock },
        { id: 'categories', label: t(lang, 'categories_methods'), icon: Tags },
        { id: 'integrations', label: 'AI Integrations', icon: Wand2 },
        { id: 'referral', label: t(lang, 'referral_id'), icon: Copy },
        { id: 'export', label: t(lang, 'export_data'), icon: Download },
        { id: 'cloud', label: t(lang, 'cloud_backup'), icon: Cloud },
        { id: 'desktop', label: t(lang, 'desktop_app'), icon: Monitor },
        { id: 'notifications', label: t(lang, 'notifications'), icon: Bell },
    ];

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'settings')}</h1>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{user?.email}</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24, alignItems: 'start' }}>
                {/* Sidebar menu */}
                <div className="card" style={{ padding: 8 }}>
                    {menuSections.map(s => (
                        <div key={s.id} className={`nav-item ${activeSection === s.id ? 'active' : ''}`} style={{ borderRadius: 8, marginBottom: 2 }} onClick={() => setActiveSection(s.id)}>
                            <s.icon size={16} />
                            <span>{s.label}</span>
                            <ChevronRight size={12} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
                        </div>
                    ))}
                    <div className="dropdown-divider" />
                    <div className="nav-item" style={{ color: 'var(--danger)' }} onClick={logout}>
                        <LogOut size={16} /><span>{t(lang, 'sign_out')}</span>
                    </div>
                </div>

                {/* Content */}
                <div>
                    {activeSection === 'profile' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Profile</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, padding: '16px', background: 'var(--bg-input)', borderRadius: 12 }}>
                                <div className="user-avatar" style={{ width: 56, height: 56, fontSize: 22 }}>{user?.name?.[0] ?? 'A'}</div>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 16 }}>{user?.name}</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{user?.email}</div>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Display Name</label>
                                <input className="form-input" value={displayName} onChange={e => setDisplayName(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">{t(lang, 'email')}</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <input className="form-input" value={user?.email ?? ''} disabled style={{ opacity: 0.6, flex: 1 }} />
                                    <button className="btn btn-secondary" onClick={() => { setEmailInput(user?.email || ''); setShowEmailModal(true); }}>{t(lang, 'change_email')}</button>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Theme</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <div className={`category-chip ${theme === 'dark' ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setTheme('dark')}>🌙 Dark</div>
                                    <div className={`category-chip ${theme === 'light' ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setTheme('light')}>☀️ Light</div>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Hide Amounts</label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                                    <div onClick={() => updateUser({ hideAmounts: !user?.hideAmounts })} style={{ width: 44, height: 24, borderRadius: 99, background: user?.hideAmounts ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background 200ms', flexShrink: 0 }}>
                                        <div style={{ position: 'absolute', left: user?.hideAmounts ? 'calc(100% - 22px)' : 2, top: 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 200ms', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                                    </div>
                                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Privacy mode – hide all amounts</span>
                                </label>
                            </div>
                            <button className="btn btn-primary" onClick={() => updateUser({ name: displayName })}>Save Profile</button>
                        </div>
                    )}

                    {activeSection === 'integrations' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>AI Integrations</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Configure your personal API keys for AI functionalities.</div>

                            <div className="form-group">
                                <label className="form-label">Gemini API Key</label>
                                <input 
                                    type="password" 
                                    className="form-input" 
                                    value={user?.geminiKey || ''} 
                                    onChange={e => updateUser({ geminiKey: e.target.value })} 
                                    placeholder="AIzaSy..." 
                                />
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                                    Your personal Gemini API Key from Google AI Studio. Stored securely on your device. Used for AI Health Summary and Expense Parsing.
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSection === 'workspace' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Workspace Settings</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Configure settings specific to the active workspace.</div>

                            <div className="form-group">
                                <label className="form-label">Billing Cycle Start Day</label>
                                <select
                                    className="form-input form-select"
                                    value={activeWorkspace?.cycleStartDay || 1}
                                    onChange={e => updateWorkspace(activeWorkspaceId, { cycleStartDay: parseInt(e.target.value) })}
                                >
                                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                        <option key={day} value={day}>
                                            {day}{day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th'} of the month
                                        </option>
                                    ))}
                                </select>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                                    This dictates when your financial month begins and ends. Leftover earnings will roll over to savings on this day.
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSection === 'language' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t(lang, 'language_region')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Choose your language and currency. Click Save to apply changes.</div>

                            <div className="form-group">
                                <label className="form-label">{t(lang, 'language')}</label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    {SUPPORTED_LANGUAGES.map(l => (
                                        <div key={l.code} className={`category-chip ${langDraft === l.code ? 'selected' : ''}`} style={{ justifyContent: 'flex-start', gap: 10 }} onClick={() => setLangDraft(l.code)}>
                                            <span style={{ width: 24, textAlign: 'center', fontSize: 16 }}>
                                                {l.code === 'en' ? '🇬🇧' : l.code === 'de' ? '🇩🇪' : l.code === 'es' ? '🇪🇸' : l.code === 'fr' ? '🇫🇷' : l.code === 'ja' ? '🇯🇵' : l.code === 'ar' ? '🇸🇦' : l.code === 'zh' ? '🇨🇳' : l.code === 'hi' ? '🇮🇳' : l.code === 'pt' ? '🇧🇷' : l.code === 'ru' ? '🇷🇺' : l.code === 'ko' ? '🇰🇷' : l.code === 'it' ? '🇮🇹' : l.code === 'tr' ? '🇹🇷' : l.code === 'nl' ? '🇳🇱' : '🌐'}
                                            </span>
                                            <div>
                                                <div style={{ fontSize: 12, fontWeight: 700 }}>{l.nativeName}</div>
                                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{l.name}</div>
                                            </div>
                                            {l.dir === 'rtl' && <span style={{ fontSize: 10, color: 'var(--warning)', marginLeft: 'auto' }}>RTL</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="form-group" style={{ marginTop: 8 }}>
                                <label className="form-label">{t(lang, 'currency')}</label>
                                <select className="form-input form-select" value={curDraft} onChange={e => setCurDraft(e.target.value)}>
                                    {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code} – {c.name}</option>)}
                                </select>
                            </div>

                            {saveSuccess && (
                                <div className="animate-fadeIn flex-row items-center gap-2 mb-3" style={{ background: 'var(--accent-soft)', border: '1px solid rgba(6,214,160,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--accent)' }}>
                                    <Check size={14} /> Language and currency updated!
                                </div>
                            )}
                            <button className="btn btn-primary btn-lg w-full" onClick={handleSaveLangCurrency}>{t(lang, 'save')}</button>
                        </div>
                    )}

                    {activeSection === 'security' && (
                        <div className="card animate-fadeIn">
                            <div className="font-bold mb-5" style={{ fontSize: 16 }}>Security & Privacy</div>
                            <div className="flex-col gap-4">
                                {[
                                    { label: t(lang, 'biometric_lock'), desc: 'Use Face ID or fingerprint to unlock the app', key: 'biometricEnabled' },
                                    { label: t(lang, 'store_ocr'), desc: 'Keep extracted receipt text for debugging', key: 'storeOcr' },
                                ].map(item => (
                                    <div key={item.key} className="flex-row items-center gap-4 rounded-xl" style={{ padding: '14px 16px', background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                                        <Shield size={20} style={{ color: 'var(--primary-light)', flexShrink: 0 }} />
                                        <div className="flex-1">
                                            <div className="font-bold" style={{ fontSize: 14 }}>{item.label}</div>
                                            <div className="text-muted text-xs mt-1">{item.desc}</div>
                                        </div>
                                        <div onClick={() => { updateUser({ [item.key]: !(user as unknown as Record<string, boolean>)?.[item.key] }); }}
                                            className="relative cursor-pointer"
                                            style={{ width: 44, height: 24, borderRadius: 99, background: (user as unknown as Record<string, boolean>)?.[item.key] ? 'var(--primary)' : 'var(--border)', flexShrink: 0, transition: 'background 200ms' }}>
                                            <div className="absolute bg-white rounded-full" style={{ left: (user as unknown as Record<string, boolean>)?.[item.key] ? 'calc(100% - 22px)' : 2, top: 2, width: 20, height: 20, transition: 'left 200ms' }} />
                                        </div>
                                    </div>
                                ))}

                                <div style={{ marginTop: 8, padding: '14px 16px', background: 'var(--bg-input)', borderRadius: 12, border: '1px solid var(--border)' }}>
                                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Auto-Lock Setup</div>
                                    
                                    <div className="form-group">
                                        <label className="form-label">App PIN (4 digits)</label>
                                        <input 
                                            type="password" 
                                            maxLength={4}
                                            className="form-input" 
                                            placeholder="Enter 4-digit PIN"
                                            value={user?.pin || ''} 
                                            onChange={e => updateUser({ pin: e.target.value.replace(/[^0-9]/g, '').slice(0,4) })} 
                                        />
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Required for auto-lock and biometric fallback.</div>
                                    </div>

                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Auto-Lock Timeout (minutes)</label>
                                        <select 
                                            className="form-input form-select" 
                                            value={user?.lockTimeout || 5} 
                                            onChange={e => updateUser({ lockTimeout: parseInt(e.target.value) })}
                                        >
                                            <option value={1}>1 Minute</option>
                                            <option value={5}>5 Minutes</option>
                                            <option value={15}>15 Minutes</option>
                                            <option value={30}>30 Minutes</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: 20, padding: '16px', background: 'var(--danger-soft)', borderRadius: 12, border: '1px solid rgba(239,68,68,0.2)' }}>
                                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--danger)', marginBottom: 4 }}>{t(lang, 'danger_zone')}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{t(lang, 'irreversible')}</div>
                                <button className="btn btn-danger btn-sm" onClick={() => setShowDeleteModal(true)}>{t(lang, 'delete_all_data')}</button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'categories' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Categories</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Customize your expense categories.</div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
                                {categories.map(cat => (
                                    <div key={cat.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-input)', borderRadius: 10, border: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 24, height: 24, borderRadius: 6, background: `${cat.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{cat.emoji}</div>
                                            <div style={{ fontSize: 13, fontWeight: 600 }}>{cat.label}</div>
                                        </div>
                                        {cat.key !== 'other' && <Trash2 size={14} style={{ color: 'var(--danger)', cursor: 'pointer', opacity: 0.6 }} onClick={() => deleteCategory(cat.key)} />}
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: 8, marginBottom: 32, alignItems: 'center' }}>
                                <input className="form-input" style={{ width: 60 }} value={newCatEmoji} onChange={e => setNewCatEmoji(e.target.value)} placeholder="Emoji" maxLength={2} />
                                <input className="form-input" style={{ flex: 1 }} value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="New category name" />
                                <input type="color" className="form-input" style={{ width: 44, padding: 4 }} value={newCatColor} onChange={e => setNewCatColor(e.target.value)} />
                                <button className="btn btn-primary" onClick={() => { if (newCatName) { addCategory({ key: newCatName.toLowerCase().replace(/\s+/g, '_'), label: newCatName, emoji: newCatEmoji, color: newCatColor }); setNewCatName(''); } }}>
                                    <Plus size={16} /> Add
                                </button>
                            </div>

                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, marginTop: 16 }}>Payment Methods</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Manage your payment sources.</div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
                                {paymentMethods.map(pm => (
                                    <div key={pm.key} className="category-chip" style={{ background: 'var(--bg-input)' }}>
                                        {pm.emoji} {pm.label}
                                        {pm.key !== 'other' && <Trash2 size={12} style={{ color: 'var(--danger)', marginLeft: 8, cursor: 'pointer' }} onClick={() => deletePaymentMethod(pm.key)} />}
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input className="form-input" style={{ width: 60 }} value={newPmEmoji} onChange={e => setNewPmEmoji(e.target.value)} placeholder="Emoji" maxLength={2} />
                                <input className="form-input" style={{ flex: 1 }} value={newPmName} onChange={e => setNewPmName(e.target.value)} placeholder="New payment method name" />
                                <button className="btn btn-primary" onClick={() => { if (newPmName) { addPaymentMethod({ key: newPmName.toLowerCase().replace(/\s+/g, '_'), label: newPmName, emoji: newPmEmoji }); setNewPmName(''); } }}>
                                    <Plus size={16} /> Add
                                </button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'referral' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t(lang, 'referral_id')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>Share your unique code to invite friends to Finance VA</div>
                            <div style={{ textAlign: 'center', padding: '32px 24px', background: 'linear-gradient(135deg,rgba(124,58,237,0.12),rgba(6,214,160,0.06))', borderRadius: 16, border: '1px solid rgba(124,58,237,0.2)', marginBottom: 24 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>Your Referral Code</div>
                                <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 4, color: 'var(--primary-light)', marginBottom: 16 }}>{user?.referralCode}</div>
                                <button className="btn btn-primary" onClick={handleCopyReferral}>
                                    {copied ? <><Check size={16} /> Copied!</> : <><Copy size={16} /> {t(lang, 'copy')}</>}
                                </button>
                            </div>
                            <div style={{ background: 'var(--bg-input)', borderRadius: 12, padding: '16px', border: '1px solid var(--border)' }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: .8 }}>User ID</div>
                                <div style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{user?.id}</div>
                            </div>
                        </div>
                    )}

                    {activeSection === 'export' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Export Your Data</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>Download all your financial data in various formats</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <button className="btn btn-secondary" onClick={handleExportCSV} style={{ justifyContent: 'flex-start', gap: 12, padding: '16px' }}>
                                    <Download size={20} /><div style={{ textAlign: 'left' }}><div style={{ fontWeight: 700 }}>{t(lang, 'export_csv')}</div><div style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>Spreadsheet-compatible format</div></div>
                                </button>
                                <button className="btn btn-ghost" onClick={handleExportPDF} style={{ justifyContent: 'flex-start', gap: 12, padding: '16px', border: '1px solid var(--border)' }}>
                                    <Download size={20} /><div style={{ textAlign: 'left' }}><div style={{ fontWeight: 700 }}>{t(lang, 'export_pdf')}</div><div style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>Premium formatted report</div></div>
                                </button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'notifications' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Notifications</div>
                            {[{ label: 'Daily Reminder', desc: 'Get reminded to log your expenses each day', key: 'notifyDaily' }, { label: 'Monthly Summary', desc: 'Receive a monthly spending report', key: 'notifyMonthly' }, { label: 'Budget Alerts', desc: 'Get notified when you approach budget limits', key: 'notifyBudget' }].map(n => (
                                <div key={n.label} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', background: 'var(--bg-input)', borderRadius: 10, marginBottom: 8, border: '1px solid var(--border)' }}>
                                    <Bell size={18} style={{ color: 'var(--primary-light)' }} />
                                    <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{n.label}</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{n.desc}</div></div>
                                    <div onClick={() => updateUser({ [n.key]: !(user as any)?.[n.key] })} style={{ width: 44, height: 24, borderRadius: 99, background: (user as any)?.[n.key] ? 'var(--primary)' : 'var(--border)', position: 'relative', cursor: 'pointer', transition: 'background 200ms' }}>
                                        <div style={{ position: 'absolute', left: (user as any)?.[n.key] ? 'calc(100% - 22px)' : 2, top: 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 200ms' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeSection === 'cloud' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Cloud Backup & Sync</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>Automatically back up your Finance VA data to your personal cloud.</div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', background: 'var(--bg-input)', borderRadius: 12, border: '1px solid var(--border)' }}>
                                    <svg viewBox="0 0 24 24" width="24" height="24"><path fill="#FFC107" d="M12.7,11.5l3.8,6.8H8.9L12.7,11.5z"></path><path fill="#03A9F4" d="M20.2,18H12.7l-3.8-6.5l3.8-6.5l7.5,13z"></path><path fill="#4CAF50" d="M16.4,5L12.7,11.5L5.1,11.5l3.8-6.5L16.4,5z"></path></svg>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>Google Drive</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Status: {user?.connectedClouds?.includes('google') ? 'Connected' : 'Not Connected'}</div>
                                    </div>
                                    <button className="btn btn-secondary btn-sm" onClick={() => handleOauthConnect('google', 'cloud')} disabled={user?.connectedClouds?.includes('google')}>
                                        {user?.connectedClouds?.includes('google') ? 'Connected' : 'Connect'}
                                    </button>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', background: 'var(--bg-input)', borderRadius: 12, border: '1px solid var(--border)' }}>
                                    <svg viewBox="0 0 24 24" width="24" height="24" fill="#0078D4"><path d="M19.5,8c-0.1,0-0.3,0-0.4,0c-0.4-3.3-3.2-5.9-6.6-5.9c-2.3,0-4.3,1.2-5.4,3c-0.3-0.1-0.7-0.1-1.1-0.1c-2.5,0-4.5,2-4.5,4.5 C1.5,12,3.5,14,6,14h13.5c2.5,0,4.5-2,4.5-4.5S22,8,19.5,8z" /></svg>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>Microsoft OneDrive</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Status: {user?.connectedClouds?.includes('microsoft') ? 'Connected' : 'Not Connected'}</div>
                                    </div>
                                    <button className="btn btn-secondary btn-sm" onClick={() => handleOauthConnect('microsoft', 'cloud')} disabled={user?.connectedClouds?.includes('microsoft')}>
                                        {user?.connectedClouds?.includes('microsoft') ? 'Connected' : 'Connect'}
                                    </button>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', background: 'var(--bg-input)', borderRadius: 12, border: '1px solid var(--border)' }}>
                                    <Cloud size={24} style={{ color: '#0070c9' }} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>Apple iCloud</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Status: {user?.connectedClouds?.includes('apple') ? 'Connected' : 'Not Connected'}</div>
                                    </div>
                                    <button className="btn btn-secondary btn-sm" onClick={() => handleOauthConnect('apple', 'cloud')} disabled={user?.connectedClouds?.includes('apple')}>
                                        {user?.connectedClouds?.includes('apple') ? 'Connected' : 'Connect'}
                                    </button>
                                </div>
                            </div>

                            {user?.connectedClouds?.length ? (
                                <div style={{ marginTop: 24 }}>
                                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Backup Frequency</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                                        {['daily', 'weekly', 'monthly', 'manual'].map(interval => (
                                            <div key={interval} onClick={() => updateUser({ backupInterval: interval as any })} style={{ padding: '10px', textAlign: 'center', background: user?.backupInterval === interval ? 'var(--primary-light)' : 'var(--bg-input)', color: user?.backupInterval === interval ? '#fff' : 'inherit', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)' }}>
                                                {interval.charAt(0).toUpperCase() + interval.slice(1)}
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Backups are uploaded automatically on background thread.</div>
                                </div>
                            ) : null}
                        </div>
                    )}

                    {activeSection === 'desktop' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Finance VA for Desktop</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>Download the native desktop application for a faster, distraction-free experience.</div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                <div style={{ background: 'var(--bg-input)', borderRadius: 16, padding: 24, textAlign: 'center', border: '1px solid var(--border)' }}>
                                    <div style={{ width: 48, height: 48, background: '#0078D4', borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                                        <span style={{ color: '#white', fontWeight: 900, fontSize: 24 }}>W</span>
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Windows</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Requires Windows 10 or later</div>
                                    <span className="btn btn-primary w-full" style={{ display: 'flex', justifyContent: 'center', opacity: 0.6, cursor: 'not-allowed' }}>
                                        ⏳ Coming Soon
                                    </span>
                                </div>

                                <div style={{ background: 'var(--bg-input)', borderRadius: 16, padding: 24, textAlign: 'center', border: '1px solid var(--border)' }}>
                                    <div style={{ width: 48, height: 48, background: '#000000', borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                                        <svg width="24" height="24" viewBox="0 0 17 20" fill="white"><path d="M14.7 13.7c-.1.3-1 3.5-3.3 6.3H11.3c-1.2 1.5-2.5 1.7-3.6 1.7s-2.1-.5-3.2-.5c-1.3 0-2.3.5-3.3.5-1 0-2.1-.2-3.1-1.3C-1.8 17.5-.5 11.5 1.5 8.7c1-1.4 2.3-2.3 3.8-2.3 1.2 0 2.2.8 3.3.8 1.1 0 2.5-1.1 4-1.1 1.6 0 2.9.8 3.7 2C13.2 9.7 14.8 11.3 14.7 13.7z M11.8 4.2c.6-.7 1-1.8.9-2.8-1 .1-2.1.6-2.8 1.3-.6.6-1 1.7-.8 2.7C10.2 5.5 11.1 4.9 11.8 4.2z"></path></svg>
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>macOS</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Requires macOS 11 or later</div>
                                    <span className="btn btn-primary w-full" style={{ display: 'flex', justifyContent: 'center', opacity: 0.6, cursor: 'not-allowed' }}>
                                        ⏳ Coming Soon
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Email Modal */}
            {showEmailModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
                    <div className="card animate-scale-up" style={{ width: 400, maxWidth: '100%', padding: 24 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Change Email</h2>
                        <div className="form-group">
                            <label className="form-label">New Email Address</label>
                            <input type="email" className="form-input" value={emailInput} onChange={e => setEmailInput(e.target.value)} autoFocus />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>To apply these changes, you must re-authenticate with a provider.</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <button className="btn btn-secondary w-full" onClick={() => handleOauthConnect('google', 'email')} disabled={!emailInput}>
                                <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.1C33.6 33.3 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z" /><path fill="#FF3D00" d="M6.3 14.7 13 19.6C14.9 14.6 19 11 24 11c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.5 29.4 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.8 13.6-4.7l-6.3-5.2c-2 1.4-4.5 2.2-7.3 2.2-5.2 0-9.5-3.2-11.1-7.6l-6.6 5.1C9.8 40 16.4 44 24 44z" /><path fill="#1976D2" d="M43.6 20H24v8h11.1c-.8 2.3-2.3 4.3-4.3 5.7l6.3 5.2c3.7-3.4 5.9-8.5 5.9-14.9 0-1.3-.1-2.7-.1-4z" /></svg> Verify with Google
                            </button>
                            <button className="btn btn-secondary w-full" onClick={() => handleOauthConnect('microsoft', 'email')} disabled={!emailInput}>
                                <svg width="16" height="16" viewBox="0 0 23 23"><rect x="1" y="1" width="10" height="10" fill="#f25022" /><rect x="12" y="1" width="10" height="10" fill="#7fba00" /><rect x="1" y="12" width="10" height="10" fill="#00a4ef" /><rect x="12" y="12" width="10" height="10" fill="#ffb900" /></svg> Verify with Microsoft
                            </button>
                            <button className="btn btn-secondary w-full" onClick={() => handleOauthConnect('apple', 'email')} disabled={!emailInput}>
                                <Cloud size={16} /> Verify with Apple
                            </button>
                        </div>
                        <button className="btn btn-ghost w-full" style={{ marginTop: 12 }} onClick={() => setShowEmailModal(false)}>Cancel</button>
                    </div>
                </div>
            )}

            {/* Simulated OAuth Modal */}
            {oauthProvider && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
                    <div className="card animate-scale-up" style={{ width: 400, maxWidth: '100%', padding: 32, textAlign: 'center' }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>
                            {oauthProvider === 'google' ? 'G' : oauthProvider === 'apple' ? '' : 'M'}
                        </div>
                        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Sign in with {oauthProvider.charAt(0).toUpperCase() + oauthProvider.slice(1)}</h2>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>Finance VA wants to access your {oauthProvider} account to verify your identity and manage backups.</p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <button className="btn btn-primary w-full" onClick={processOauth} disabled={oauthConnecting}>
                                {oauthConnecting ? 'Validating...' : 'Allow Access'}
                            </button>
                            <button className="btn btn-ghost w-full" onClick={() => { setOauthProvider(null); setOauthMode(null); }} disabled={oauthConnecting}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
                    <div className="card animate-scale-up" style={{ width: 400, maxWidth: '100%', padding: 24 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--danger)', marginBottom: 8 }}>Are you sure you want to delete?</h2>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>This action can't be undone. All your expenses, goals, and settings will be permanently removed.</p>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowDeleteModal(false)}>Cancel</button>
                            <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => { deleteAllData(); setShowDeleteModal(false); }}>Yes, Delete All Data</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
