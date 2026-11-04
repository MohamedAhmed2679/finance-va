import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MoreHorizontal, Moon, Sun, LogOut } from 'lucide-react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { NAV, TAB_KEYS } from './nav';
import { WorkspaceSwitcher } from './Sidebar';

interface TabBarProps { active: string; onNavigate: (page: string) => void; }

/** Mobile navigation: 3 tabs, a centre slot for the add button, and "More". */
export default function TabBar({ active, onNavigate }: TabBarProps) {
    const { user, theme, setTheme, logout } = useStore();
    const lang = user?.language ?? 'en';
    const [moreOpen, setMoreOpen] = useState(false);
    const tabs = NAV.filter(n => TAB_KEYS.includes(n.key));
    const extra = NAV.filter(n => !TAB_KEYS.includes(n.key));
    const moreActive = !TAB_KEYS.includes(active);

    const go = (key: string) => { setMoreOpen(false); onNavigate(key); };
    const shortLabel = (key: string, label: string) => key === 'bills' ? 'Bills' : label;

    const renderTab = (item: typeof NAV[number]) => {
        const isActive = active === item.key;
        return (
            <button key={item.key} className={`tab ${isActive ? 'active' : ''}`} onClick={() => go(item.key)} aria-current={isActive ? 'page' : undefined}>
                {isActive && <motion.span layoutId="tab-dot" className="tab-dot" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
                <item.icon size={21} strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{shortLabel(item.key, t(lang, item.labelKey))}</span>
            </button>
        );
    };

    return (
        <>
            <nav className="tabbar" aria-label="Main navigation">
                {renderTab(tabs[0])}
                {renderTab(tabs[1])}
                <span aria-hidden="true" />
                {renderTab(tabs[2])}
                <button className={`tab ${moreActive ? 'active' : ''}`} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
                    {moreActive && <motion.span layoutId="tab-dot" className="tab-dot" />}
                    <MoreHorizontal size={21} />
                    <span>More</span>
                </button>
            </nav>

            <AnimatePresence>
                {moreOpen && (
                    <>
                        <motion.div className="sheet-overlay" style={{ animation: 'none' }} onClick={() => setMoreOpen(false)}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                        <motion.div className="sheet" role="dialog" aria-label="More"
                            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
                            onDragEnd={(_, info) => { if (info.offset.y > 90 || info.velocity.y > 500) setMoreOpen(false); }}>
                            <div className="sheet-handle" />
                            <div style={{ marginBottom: 14 }}><WorkspaceSwitcher onNavigate={go} /></div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                                {extra.map((item, i) => (
                                    <motion.button key={item.key} onClick={() => go(item.key)}
                                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}
                                        style={{
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 6px',
                                            borderRadius: 14, border: '1px solid var(--line)',
                                            background: active === item.key ? 'var(--note-soft)' : 'var(--surface-2)',
                                            color: active === item.key ? 'var(--note)' : 'var(--ink)', fontSize: 12.5, fontWeight: 600, textAlign: 'center'
                                        }}>
                                        <item.icon size={22} />
                                        {t(lang, item.labelKey)}
                                    </motion.button>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                                <button className="btn btn-secondary flex-1" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                                    {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                                    {theme === 'dark' ? t(lang, 'light_mode') : t(lang, 'dark_mode')}
                                </button>
                                <button className="btn btn-secondary flex-1" style={{ color: 'var(--cinnabar)' }} onClick={() => { setMoreOpen(false); logout(); }}>
                                    <LogOut size={16} /> {t(lang, 'sign_out')}
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
