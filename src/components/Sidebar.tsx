import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, ChevronDown, ChevronsUpDown, LogOut, Moon, Sun, Plus, Check, Settings, ShieldCheck } from 'lucide-react';
import { useStore } from '../store/useStore';
import { t, tx } from '../i18n/translations';
import { ZayloLogo } from './brand/Brand';
import { GROUPS, ADMIN_CONSOLE_URL, groupOf, groupTarget, navLabel } from './nav';

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

/** Settings, appearance, the admin console (administrators only) and sign out. */
export function AccountMenu({ onNavigate, placement = 'up' }: { onNavigate: (page: string) => void; placement?: 'up' | 'inline' }) {
    const { user, logout, theme, setTheme } = useStore();
    const lang = user?.language ?? 'en';
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
    }, [open]);

    const items = (
        <>
            <button role="menuitem" className="dropdown-item w-full" onClick={() => { setOpen(false); onNavigate('settings'); }}><Settings size={16} /> {t(lang, 'settings')}</button>
            <button role="menuitem" className="dropdown-item w-full" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} {tx('Appearance')}
                <span className="menu-value">{theme === 'dark' ? tx('Dark') : tx('Light')}</span>
            </button>
            {user?.isAdmin && (
                <a role="menuitem" className="dropdown-item w-full" href={ADMIN_CONSOLE_URL} target="_blank" rel="noreferrer"><ShieldCheck size={16} /> {tx('Admin console')}</a>
            )}
            <div className="dropdown-divider" />
            <button role="menuitem" className="dropdown-item w-full" onClick={() => { setOpen(false); logout(); }}><LogOut size={16} /> {t(lang, 'sign_out')}</button>
        </>
    );
    if (placement === 'inline') return <div className="account-inline" role="menu" aria-label={tx('Account')}>{items}</div>;

    return (
        <div className="relative" ref={ref}>
            <button ref={trigger} className="sidebar-user" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`${tx('Account')}: ${user?.name ?? ''}`}>
                <span className="user-avatar" aria-hidden>
                    {user?.avatar ? <img src={user.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : (user?.name?.[0]?.toUpperCase() ?? 'U')}
                </span>
                <span className="user-info">
                    <span className="user-name">{user?.name ?? tx('Guest')}</span>
                    <span className="user-email" title={user?.email || user?.phone || ''}>{user?.email || user?.phone || ''}</span>
                </span>
                <ChevronsUpDown size={16} aria-hidden style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div className="dropdown-menu account-menu" role="menu" aria-label={tx('Account')}
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.15 }}>
                        {items}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function Sidebar({ active, onNavigate }: SidebarProps) {
    const { user, notifications } = useStore();
    const lang = user?.language ?? 'en';
    const activeGroup = groupOf(active)?.key;
    const unread = notifications.filter(n => !n.actioned).length;

    return (
        <aside className="sidebar" aria-label={tx('Main navigation')}>
            <div className="sidebar-logo">
                <ZayloLogo size={28} onDark />
                <button className={`side-bell ${active === 'activity' ? 'active' : ''}`} onClick={() => onNavigate('activity')}
                    aria-current={active === 'activity' ? 'page' : undefined}
                    aria-label={unread ? `${tx('Notifications')}, ${unread} ${tx('unread')}` : tx('Notifications')} title={tx('Notifications')}>
                    <Bell size={18} />
                    {unread > 0 && <span className="side-bell-badge" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
                </button>
            </div>

            <WorkspaceSwitcher onNavigate={onNavigate} />

            <nav className="nav-section">
                {GROUPS.map(g => {
                    const open = activeGroup === g.key;
                    const single = g.items.length === 1;
                    return (
                        <div key={g.key} className="nav-group">
                            <button className={`nav-item ${open ? 'active' : ''}`}
                                aria-current={open && single ? 'page' : undefined}
                                aria-expanded={single ? undefined : open}
                                onClick={() => onNavigate(open && !single ? g.items[0].key : groupTarget(g))}>
                                {open && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ duration: 0.18 }} />}
                                <g.icon size={19} strokeWidth={open ? 2.2 : 1.8} />
                                <span>{tx(g.label)}</span>
                            </button>
                            {open && !single && (
                                <div className="nav-sub">
                                    {g.items.map(item => (
                                        <button key={item.key} className={`nav-sub-item ${active === item.key ? 'active' : ''}`}
                                            aria-current={active === item.key ? 'page' : undefined} onClick={() => onNavigate(item.key)}>
                                            {navLabel(lang, item)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            <div className="sidebar-footer">
                <AccountMenu onNavigate={onNavigate} />
            </div>
        </aside>
    );
}
