import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, LogOut, Moon, Sun, Plus, Check, ShieldCheck } from 'lucide-react';
import { useStore } from '../store/useStore';
import { t, tx } from '../i18n/translations';
import { ZayloLogo } from './brand/Brand';
import { navFor, ADMIN_CONSOLE_URL } from './nav';

interface SidebarProps { active: string; onNavigate: (page: string) => void; }

export function WorkspaceSwitcher({ onNavigate }: { onNavigate: (page: string) => void }) {
    const { user, workspaces, activeWorkspaceId, setActiveWorkspace, syncStatus } = useStore();
    const lang = user?.language ?? 'en';
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const activeWs = workspaces.find(w => w.id === activeWorkspaceId) ?? workspaces[0];

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
    }, [open]);

    const syncLabel = syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'error' ? 'Sync failed' : syncStatus === 'offline' ? 'Offline' : 'Synced';

    return (
        <div className="relative" ref={ref}>
            <button className="workspace-chip" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
                <span className="ws-dot" style={{ background: activeWs?.color || 'var(--note)' }}>{activeWs?.name?.charAt(0).toUpperCase() || 'P'}</span>
                <span className="flex-1" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{activeWs?.name || t(lang, 'personal')}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                        <span className="sync-dot" data-state={syncStatus} />{syncLabel}
                    </span>
                </span>
                <ChevronDown size={16} style={{ color: 'var(--ink-3)', transition: 'transform 200ms', transform: open ? 'rotate(180deg)' : 'none' }} />
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div className="dropdown-menu" role="menu" style={{ left: 0, right: 0, minWidth: 0 }}
                        initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: 0.16 }}>
                        {workspaces.map(ws => (
                            <button key={ws.id} role="menuitem" className={`dropdown-item w-full ${ws.id === activeWorkspaceId ? 'active' : ''}`}
                                style={{ border: 'none', background: 'none' }}
                                onClick={() => { setActiveWorkspace(ws.id); setOpen(false); }}>
                                <span className="ws-dot" style={{ background: ws.color || 'var(--note)', width: 24, height: 24 }}>{ws.name?.charAt(0).toUpperCase()}</span>
                                <span className="flex-1" style={{ textAlign: 'start' }}>
                                    <span style={{ display: 'block', fontWeight: 600, color: 'var(--ink)' }}>{ws.name}</span>
                                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{ws.type === 'personal' ? t(lang, 'personal') : t(lang, 'shared')}</span>
                                </span>
                                {ws.id === activeWorkspaceId && <Check size={16} style={{ color: 'var(--note)' }} />}
                            </button>
                        ))}
                        <div className="dropdown-divider" />
                        <button role="menuitem" className="dropdown-item w-full" style={{ border: 'none', background: 'none' }}
                            onClick={() => { try { sessionStorage.setItem('zaylo_new_ws', '1'); } catch { /* ignore */ } window.dispatchEvent(new Event('zaylo:new-workspace')); onNavigate('workspaces'); setOpen(false); }}>
                            <Plus size={16} /> {t(lang, 'new_workspace')}
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function Sidebar({ active, onNavigate }: SidebarProps) {
    const { user, logout, theme, setTheme } = useStore();
    const lang = user?.language ?? 'en';
    const nav = navFor(user?.isAdmin);

    return (
        <aside className="sidebar" aria-label={tx('Main navigation')}>
            <div className="sidebar-logo">
                <ZayloLogo size={28} onDark />
            </div>

            <WorkspaceSwitcher onNavigate={onNavigate} />

            <nav className="nav-section">
                {nav.map((item, i) => {
                    const isActive = active === item.key;
                    const gap = i > 0 && nav[i - 1].group !== item.group;
                    return (
                        <button key={item.key} className={`nav-item ${isActive ? 'active' : ''}`}
                            style={gap ? { marginTop: 14 } : undefined}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => onNavigate(item.key)}>
                            {isActive && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                            <item.icon size={19} strokeWidth={isActive ? 2.2 : 1.8} />
                            <span>{item.label && t(lang, item.labelKey) === item.labelKey ? tx(item.label) : t(lang, item.labelKey)}</span>
                        </button>
                    );
                })}
            </nav>

            <div className="sidebar-footer">
                {user?.isAdmin && (
                    <a className="nav-item" href={ADMIN_CONSOLE_URL} target="_blank" rel="noreferrer">
                        <ShieldCheck size={18} /><span>{tx('Admin console')}</span>
                    </a>
                )}
                <button className="nav-item" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                    {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    <span>{theme === 'dark' ? t(lang, 'light_mode') : t(lang, 'dark_mode')}</span>
                </button>
                <div className="sidebar-user" role="button" tabIndex={0} onClick={() => onNavigate('settings')} onKeyDown={e => { if (e.key === 'Enter') onNavigate('settings'); }}>
                    <div className="user-avatar">
                        {user?.avatar ? <img src={user.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : (user?.name?.[0]?.toUpperCase() ?? 'U')}
                    </div>
                    <div className="user-info">
                        <div className="user-name">{user?.name ?? tx('Guest')}</div>
                        <div className="user-email">{user?.email || user?.phone || ''}</div>
                    </div>
                    <button className="icon-btn" title={t(lang, 'sign_out')} aria-label={t(lang, 'sign_out')} onClick={(e) => { e.stopPropagation(); logout(); }}>
                        <LogOut size={17} />
                    </button>
                </div>
            </div>
        </aside>
    );
}
