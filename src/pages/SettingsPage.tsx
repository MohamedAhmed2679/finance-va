import SavedSignInSettings from '../components/SavedSignInSettings';
import AutoTrackSettings from '../components/AutoTrackSettings';
import DeleteAccountDialog from '../components/DeleteAccountDialog';
import PushSettings from '../components/PushSettings';
import ZayloIdCard from '../components/ZayloIdCard';
import { useState } from 'react';
import { useStore } from '../store/useStore';
import { hashPin } from '../utils/pin';
import BiometricToggle from '../components/BiometricToggle';
import toast from 'react-hot-toast';
import { t, tx } from '../i18n/translations';
import { CURRENCIES, SUPPORTED_LANGUAGES } from '../constants';
import { Copy, Check, Shield, Bell, Download, LogOut, User, Globe, Lock, ChevronRight, Cloud, Monitor, Tags, Plus, Trash2, Briefcase, Wand2, FileDown, MessageSquareText } from 'lucide-react';
import ReportSheet from '../components/ReportSheet';
import CloudBackupSettings from '../components/CloudBackupSettings';
import Dialog from '../components/Dialog';
import { supabase } from '../lib/supabase';

export default function SettingsPage() {
    const { user, workspaces, activeWorkspaceId, updateWorkspace, updateUser, setTheme, theme, language, setLanguage, currency, setCurrency, logout, deleteAllData, categories, paymentMethods, addCategory, deleteCategory, addPaymentMethod, deletePaymentMethod } = useStore();
    const lang = user?.language ?? 'en';

    const [pinDraft, setPinDraft] = useState('');
    const [langDraft, setLangDraft] = useState(language);
    const [curDraft, setCurDraft] = useState(currency);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [displayName, setDisplayName] = useState(user?.name ?? '');
    const [activeSection, setActiveSection] = useState<string | null>(() => new URLSearchParams(window.location.search).get('section') || 'profile');

    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);

    const [showEmailModal, setShowEmailModal] = useState(false);
    const [emailInput, setEmailInput] = useState('');
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showDeleteAccount, setShowDeleteAccount] = useState(false);
    const [showReport, setShowReport] = useState(false);

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


    const [emailSending, setEmailSending] = useState(false);
    /** Real email change: Supabase emails a confirmation link; the address changes only after it's confirmed. */
    async function sendEmailChange() {
        const next = emailInput.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { toast.error(tx('Enter a valid email address.'), { id: 'email-change' }); return; }
        if (next.toLowerCase() === (user?.email || '').toLowerCase()) { toast.error(tx('That\'s already your email address.'), { id: 'email-change' }); return; }
        if (!supabase) { toast.error(tx('You\'re offline. Try again when you\'re connected.'), { id: 'email-change' }); return; }
        setEmailSending(true);
        const { error } = await supabase.auth.updateUser({ email: next }, { emailRedirectTo: `${window.location.origin}/settings` });
        setEmailSending(false);
        if (error) { toast.error(error.message, { id: 'email-change' }); return; }
        toast.success(tx('Check your inbox: we sent a confirmation link. Your email changes once you confirm it.'), { id: 'email-change', duration: 9000 });
        setShowEmailModal(false);
    }

    const menuSections = [
        { id: 'profile', label: t(lang, 'profile'), icon: User },
        { id: 'workspace', label: tx('Workspace'), icon: Briefcase },
        { id: 'language', label: t(lang, 'language_region'), icon: Globe },
        { id: 'security', label: t(lang, 'security_privacy'), icon: Lock },
        { id: 'categories', label: t(lang, 'categories_methods'), icon: Tags },
        { id: 'integrations', label: tx('AI Integrations'), icon: Wand2 },
        { id: 'referral', label: tx('Zaylo ID'), icon: Copy },
        { id: 'export', label: t(lang, 'export_data'), icon: Download },
        { id: 'cloud', label: t(lang, 'cloud_backup'), icon: Cloud },
        { id: 'autotrack', label: tx('AutoTrack'), icon: MessageSquareText },
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

            <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24, alignItems: 'start' }}>
                {/* Sidebar menu */}
                <div className="card" style={{ padding: 8 }}>
                    {menuSections.map(s => (
                        <button type="button" key={s.id} className={`nav-item ${activeSection === s.id ? 'active' : ''}`} aria-current={activeSection === s.id ? 'page' : undefined}
                            style={{ borderRadius: 8, marginBottom: 2, fontFamily: 'inherit', textAlign: 'start' }} onClick={() => setActiveSection(s.id)}>
                            <s.icon size={16} aria-hidden />
                            <span>{s.label}</span>
                            <ChevronRight size={12} aria-hidden style={{ marginInlineStart: 'auto', color: 'var(--text-muted)' }} />
                        </button>
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
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{tx('Profile')}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, padding: '16px', background: 'var(--bg-input)', borderRadius: 12 }}>
                                <div className="user-avatar" style={{ width: 56, height: 56, fontSize: 22 }}>{user?.name?.[0] ?? 'A'}</div>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 16 }}>{user?.name}</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{user?.email}</div>
                                </div>
                            </div>
                            <div style={{ marginBottom: 20 }}><ZayloIdCard /></div>
                            <div className="form-group">
                                <label className="form-label">{tx('Display Name')}</label>
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
                                <label className="form-label">{tx('Theme')}</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <div className={`category-chip ${theme === 'dark' ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setTheme('dark')}>{tx('🌙 Dark')}</div>
                                    <div className={`category-chip ${theme === 'light' ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setTheme('light')}>{tx('☀️ Light')}</div>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">{tx('Hide Amounts')}</label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                                    <div onClick={() => updateUser({ hideAmounts: !user?.hideAmounts })} style={{ width: 44, height: 24, borderRadius: 99, background: user?.hideAmounts ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background 200ms', flexShrink: 0 }}>
                                        <div style={{ position: 'absolute', left: user?.hideAmounts ? 'calc(100% - 22px)' : 2, top: 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 200ms', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                                    </div>
                                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{tx('Privacy mode – hide all amounts')}</span>
                                </label>
                            </div>
                            <button className="btn btn-primary" onClick={() => updateUser({ name: displayName })}>{tx('Save Profile')}</button>
                        </div>
                    )}

                    {activeSection === 'integrations' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{tx('AI Integrations')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{tx('Configure your personal API keys for AI functionalities.')}</div>

                            <div className="form-group">
                                <label className="form-label">{tx('Gemini API Key')}</label>
                                <input 
                                    type="password" 
                                    className="form-input" 
                                    value={user?.geminiKey || ''} 
                                    onChange={e => updateUser({ geminiKey: e.target.value })} 
                                    placeholder="AIzaSy..." 
                                />
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                                    {tx('Your personal Gemini API Key from Google AI Studio. Stored securely on your device. Used for AI Health Summary and Expense Parsing.')}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSection === 'workspace' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{tx('Workspace Settings')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{tx('Configure settings specific to the active workspace.')}</div>

                            <div className="form-group">
                                <label className="form-label">{tx('Billing Cycle Start Day')}</label>
                                <select
                                    className="form-input form-select"
                                    value={activeWorkspace?.cycleStartDay || 1}
                                    onChange={e => updateWorkspace(activeWorkspaceId, { cycleStartDay: parseInt(e.target.value) })}
                                >
                                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                        <option key={day} value={day}>
                                            {day}{day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th'}{' '}{tx('of the month')}
                                        </option>
                                    ))}
                                </select>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                                    {tx('This dictates when your financial month begins and ends. Leftover earnings will roll over to savings on this day.')}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSection === 'language' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t(lang, 'language_region')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{tx('Choose your language and currency. Click Save to apply changes.')}</div>

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
                                    <Check size={14} />{' '}{tx('Language and currency updated!')}
                                </div>
                            )}
                            <button className="btn btn-primary btn-lg w-full" onClick={handleSaveLangCurrency}>{t(lang, 'save')}</button>
                        </div>
                    )}

                    {activeSection === 'security' && (
                        <div className="card animate-fadeIn">
                            <div className="font-bold mb-5" style={{ fontSize: 16 }}>{tx('Security & Privacy')}</div>
                            <div className="flex-col gap-4">
                                <BiometricToggle compact />
                                <SavedSignInSettings />
                                {[
                                    { label: t(lang, 'store_ocr'), desc: tx('Keep extracted receipt text for debugging'), key: 'storeOcr' },
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
                                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>{tx('Auto-Lock Setup')}</div>
                                    
                                    <div className="form-group">
                                        <label className="form-label">{tx('App PIN (4 digits)')}</label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <input
                                                type="password"
                                                inputMode="numeric"
                                                autoComplete="new-password"
                                                maxLength={4}
                                                className="form-input"
                                                placeholder={user?.pin ? tx('PIN is set — enter a new one to change it') : tx('Enter 4-digit PIN')}
                                                value={pinDraft}
                                                onChange={e => setPinDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                                            />
                                            <button type="button" className="btn btn-secondary" disabled={pinDraft.length !== 4}
                                                onClick={async () => { updateUser({ pin: await hashPin(pinDraft, user?.id || 'fv') }); setPinDraft(''); toast.success(tx('PIN saved')); }}>
                                                {tx('Save PIN')}
                                            </button>
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{tx('A backup for biometric unlock, or use it on its own. Stored as a one-way hash.')}</div>
                                    </div>

                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">{tx('Auto-Lock Timeout (minutes)')}</label>
                                        <select 
                                            className="form-input form-select" 
                                            value={user?.lockTimeout || 5} 
                                            onChange={e => updateUser({ lockTimeout: parseInt(e.target.value) })}
                                        >
                                            <option value={1}>{tx('1 Minute')}</option>
                                            <option value={5}>{tx('5 Minutes')}</option>
                                            <option value={15}>{tx('15 Minutes')}</option>
                                            <option value={30}>{tx('30 Minutes')}</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: 20, padding: '16px', background: 'var(--danger-soft)', borderRadius: 12, border: '1px solid var(--cinnabar-soft)' }}>
                                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--danger)', marginBottom: 4 }}>{t(lang, 'danger_zone')}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{tx('Removes the copy of your data kept on this device. Your account and everything saved in the cloud stay as they are.')}</div>
                                <button className="btn btn-danger btn-sm" onClick={() => setShowDeleteModal(true)}>{tx('Remove data from this device')}</button>
                                <div style={{ height: 1, background: 'var(--cinnabar-soft)', margin: '16px 0' }} />
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{tx('Permanently delete your Zaylo account and the data that belongs only to you.')}</div>
                                <button className="btn btn-danger btn-sm" onClick={() => setShowDeleteAccount(true)}>{tx('Delete account')}</button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'categories' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{tx('Categories')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{tx('Customize your expense categories.')}</div>

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
                                <input className="form-input" style={{ width: 60 }} value={newCatEmoji} onChange={e => setNewCatEmoji(e.target.value)} placeholder={tx('Emoji')} maxLength={2} />
                                <input className="form-input" style={{ flex: 1 }} value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder={tx('New category name')} />
                                <input type="color" className="form-input" style={{ width: 44, padding: 4 }} value={newCatColor} onChange={e => setNewCatColor(e.target.value)} />
                                <button className="btn btn-primary" onClick={() => { if (newCatName) { addCategory({ key: newCatName.toLowerCase().replace(/\s+/g, '_'), label: newCatName, emoji: newCatEmoji, color: newCatColor }); setNewCatName(''); } }}>
                                    <Plus size={16} />{' '}{tx('Add')}
                                </button>
                            </div>

                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, marginTop: 16 }}>{tx('Payment Methods')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{tx('Manage your payment sources.')}</div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
                                {paymentMethods.map(pm => (
                                    <div key={pm.key} className="category-chip" style={{ background: 'var(--bg-input)' }}>
                                        {pm.emoji} {pm.label}
                                        {pm.key !== 'other' && <Trash2 size={12} style={{ color: 'var(--danger)', marginLeft: 8, cursor: 'pointer' }} onClick={() => deletePaymentMethod(pm.key)} />}
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input className="form-input" style={{ width: 60 }} value={newPmEmoji} onChange={e => setNewPmEmoji(e.target.value)} placeholder={tx('Emoji')} maxLength={2} />
                                <input className="form-input" style={{ flex: 1 }} value={newPmName} onChange={e => setNewPmName(e.target.value)} placeholder={tx('New payment method name')} />
                                <button className="btn btn-primary" onClick={() => { if (newPmName) { addPaymentMethod({ key: newPmName.toLowerCase().replace(/\s+/g, '_'), label: newPmName, emoji: newPmEmoji }); setNewPmName(''); } }}>
                                    <Plus size={16} />{' '}{tx('Add')}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'referral' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{tx('Zaylo ID')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>{tx('Your unique ID. Anyone who manages a workspace can add you with it, and you can add others with theirs.')}</div>
                            <ZayloIdCard />
                        </div>
                    )}

                    {activeSection === 'export' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{tx('Reports')}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{tx('Download your expenses, bills and commitments, and income as an Excel workbook or a PDF report.')}</div>
                            <button className="btn btn-primary" onClick={() => setShowReport(true)} style={{ gap: 10, padding: '14px 18px' }}>
                                <FileDown size={18} />{tx('Create a report')}
                            </button>
                        </div>
                    )}

                    {activeSection === 'notifications' && (
                        <div className="card animate-fadeIn">
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>{tx('Notifications')}</div>
                            <PushSettings />
                            <div style={{ fontWeight: 600, fontSize: 14, margin: '20px 0 10px' }}>{tx('Also remind me about')}</div>
                            {([
                                { label: tx('Daily Reminder'), desc: tx('At 8 pm, if you haven\'t logged anything that day'), key: 'notifyDaily' },
                                { label: tx('Monthly Summary'), desc: tx('On the 1st: what you spent last month in each workspace'), key: 'notifyMonthly' },
                                { label: tx('Budget Alerts'), desc: user?.monthlyBudget ? tx('When your personal spending reaches 80% and 100% of your monthly budget') : tx('Set a monthly budget on the Expenses page first'), key: 'notifyBudget' },
                            ] as const).map(n => {
                                const on = Boolean(user?.[n.key]);
                                return (
                                    <div key={n.key} className="notify-row">
                                        <Bell size={18} style={{ color: 'var(--primary-light)', flexShrink: 0 }} aria-hidden />
                                        <div style={{ flex: 1 }}><div id={`lbl-${n.key}`} style={{ fontWeight: 600, fontSize: 14 }}>{n.label}</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{n.desc}</div></div>
                                        <button type="button" role="switch" aria-checked={on} aria-labelledby={`lbl-${n.key}`} className="switch" data-on={on}
                                            onClick={() => { updateUser({ [n.key]: !on }); toast.success(!on ? tx('Reminder on') : tx('Reminder off'), { id: `notify-${n.key}` }); }}>
                                            <span />
                                        </button>
                                    </div>
                                );
                            })}
                            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{tx('Reminders arrive on every device where notifications are on, and always show in Activity.')}</p>
                        </div>
                    )}

                    {activeSection === 'cloud' && <CloudBackupSettings />}
                    {activeSection === 'autotrack' && <AutoTrackSettings onOpenAutoTrack={() => { window.history.pushState(null, '', '/autotrack'); window.dispatchEvent(new PopStateEvent('popstate')); }} />}

                    {activeSection === 'desktop' && (
                        <div className="card animate-fadeIn">
                            <div className="card-title" style={{ marginBottom: 4 }}>{tx('Zaylo on your devices')}</div>
                            <div style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 20 }}>{tx('Test builds of the apps. They open this same account, so everything stays in sync.')}</div>
                            <div className="card-grid card-grid-2">
                                {[
                                    { name: 'Android', file: 'Zaylo-android.apk', note: 'Android 7 or later. Allow installs from your browser when asked.' },
                                    { name: 'iPhone', file: 'Zaylo-ios-unsigned.ipa', note: 'Install with Sideloadly or AltStore using your Apple ID.' },
                                    { name: 'macOS', file: 'Zaylo-mac.dmg', note: 'Right-click the app and choose Open the first time.' },
                                    { name: 'Windows', file: 'Zaylo-windows-setup.exe', note: 'Windows 10 or later. Choose More info → Run anyway if prompted.' },
                                ].map(p => (
                                    <div key={p.name} style={{ background: 'var(--surface-2)', borderRadius: 14, padding: 18, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                                        <div style={{ fontSize: 13, color: 'var(--ink-3)', flex: 1 }}>{p.note}</div>
                                        <a className="btn btn-secondary btn-sm" style={{ marginTop: 8, textDecoration: 'none' }}
                                            href={`https://github.com/MohamedAhmed2679/finance-va/releases/download/test-build/${p.file}`}>
                                            <Download size={15} />{' '}{tx('Download for')}{' '}{p.name}
                                        </a>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {showReport && <ReportSheet onClose={() => setShowReport(false)} />}
            {showDeleteAccount && <DeleteAccountDialog onClose={() => setShowDeleteAccount(false)} />}

            {/* Change email */}
            {showEmailModal && (
                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !emailSending) setShowEmailModal(false); }}>
                    <Dialog className="modal" labelledBy="dlg-email" onClose={() => { if (!emailSending) setShowEmailModal(false); }} style={{ maxWidth: 420, padding: 24 }}>
                        <h2 id="dlg-email" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{tx('Change Email')}</h2>
                        <form onSubmit={e => { e.preventDefault(); sendEmailChange(); }}>
                            <div className="form-group">
                                <label className="form-label" htmlFor="new-email">{tx('New Email Address')}</label>
                                <input id="new-email" type="email" autoComplete="email" className="form-input" value={emailInput} onChange={e => setEmailInput(e.target.value)} data-autofocus />
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>{tx('We\'ll email a confirmation link. Your sign-in email changes only after you open it.')}</div>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowEmailModal(false)} disabled={emailSending}>{tx('Cancel')}</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={emailSending || !emailInput.trim()}>{emailSending ? tx('Sending…') : tx('Send confirmation')}</button>
                            </div>
                        </form>
                    </Dialog>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowDeleteModal(false); }}>
                    <Dialog className="modal" labelledBy="dlg-device-data" onClose={() => setShowDeleteModal(false)} style={{ maxWidth: 420, padding: 24 }}>
                        <h2 id="dlg-device-data" style={{ fontSize: 18, fontWeight: 700, color: 'var(--danger)', marginBottom: 8 }}>{tx('Remove data from this device?')}</h2>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{tx('Zaylo signs you out and clears what it stored here. Nothing is deleted from your account; sign in again to get it back.')}</p>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowDeleteModal(false)}>{tx('Cancel')}</button>
                            <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => { setShowDeleteModal(false); deleteAllData(); logout(); }}>{tx('Remove and sign out')}</button>
                        </div>
                    </Dialog>
                </div>
            )}
        </div>
    );
}
