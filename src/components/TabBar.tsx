import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MoreHorizontal } from 'lucide-react';
import { useStore } from '../store/useStore';
import { tx } from '../i18n/translations';
import { GROUPS, TAB_GROUPS, groupOf, groupTarget, navLabel } from './nav';
import { AccountMenu } from './Sidebar';

interface TabBarProps { active: string; onNavigate: (page: string) => void; /** false on pages without the add button: the bar then has four even slots */ addSlot?: boolean }

/** Phone navigation: Home, Transactions, a centre slot for the add button, Planning and "More". */
export default function TabBar({ active, onNavigate, addSlot = true }: TabBarProps) {
    const { user } = useStore();
    const lang = user?.language ?? 'en';
    const [moreOpen, setMoreOpen] = useState(false);
    const tabs = GROUPS.filter(g => TAB_GROUPS.includes(g.key));
    const extra = GROUPS.filter(g => !TAB_GROUPS.includes(g.key));
    const activeGroup = groupOf(active)?.key;
    const moreActive = !activeGroup || !TAB_GROUPS.includes(activeGroup);

    const go = (key: string) => { setMoreOpen(false); onNavigate(key); };

    const renderTab = (g: typeof GROUPS[number]) => {
        const isActive = activeGroup === g.key;
        return (
            <button key={g.key} className={`tab ${isActive ? 'active' : ''}`} onClick={() => go(isActive ? g.items[0].key : groupTarget(g))} aria-current={isActive ? 'page' : undefined}>
                {isActive && <motion.span layoutId="tab-dot" className="tab-dot" transition={{ duration: 0.18 }} />}
                <g.icon size={21} strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{tx(g.label)}</span>
            </button>
        );
    };

    return (
        <>
            <nav className={`tabbar ${addSlot ? '' : 'no-add'}`} aria-label={tx('Main navigation')}>
                {renderTab(tabs[0])}
                {renderTab(tabs[1])}
                {addSlot && <span aria-hidden="true" />}
                {renderTab(tabs[2])}
                <button className={`tab ${moreActive ? 'active' : ''}`} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
                    {moreActive && <motion.span layoutId="tab-dot" className="tab-dot" transition={{ duration: 0.18 }} />}
                    <MoreHorizontal size={21} />
                    <span>{tx('More')}</span>
                </button>
            </nav>

            <AnimatePresence>
                {moreOpen && (
                    <>
                        <motion.div className="sheet-overlay" style={{ animation: 'none' }} onClick={() => setMoreOpen(false)}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                        <motion.div className="sheet more-sheet" role="dialog" aria-label={tx('More')}
                            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
                            onDragEnd={(_, info) => { if (info.offset.y > 90 || info.velocity.y > 500) setMoreOpen(false); }}>
                            <div className="sheet-handle" />
                            <div className="sheet-account">
                                <span className="user-avatar" aria-hidden>{(user?.name || user?.email || '?').charAt(0).toUpperCase()}</span>
                                <span className="sheet-account-text">
                                    <span className="sheet-account-name">{user?.name || tx('Your account')}</span>
                                    <span className="sheet-account-email">{user?.email || user?.phone || ''}</span>
                                </span>
                            </div>
                            {extra.map(g => (
                                <section key={g.key} className="more-group" aria-label={tx(g.label)}>
                                    <h3>{tx(g.label)}</h3>
                                    {g.items.map(item => (
                                        <button key={item.key} className={`more-row ${active === item.key ? 'active' : ''}`} aria-current={active === item.key ? 'page' : undefined} onClick={() => go(item.key)}>
                                            <item.icon size={20} aria-hidden /><span>{navLabel(lang, item)}</span>
                                        </button>
                                    ))}
                                </section>
                            ))}
                            <section className="more-group" aria-label={tx('Account')}>
                                <h3>{tx('Account')}</h3>
                                <AccountMenu onNavigate={go} placement="inline" />
                            </section>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
