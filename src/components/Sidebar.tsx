import { useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { LayoutDashboard, Receipt, Target, ArrowLeftRight, Settings, ChevronDown, LogOut, Moon, Sun, CalendarDays, TrendingUp, FolderOpen, Plus } from 'lucide-react';

interface SidebarProps { active: string; onNavigate: (page: string) => void; }

export default function Sidebar({ active, onNavigate }: SidebarProps) {
    const { user, workspaces, activeWorkspaceId, setActiveWorkspace, logout, theme, setTheme } = useStore();
    const lang = user?.language ?? 'en';
    const [wsOpen, setWsOpen] = useState(false);
    const wsRef = useRef<HTMLDivElement>(null);
    const activeWs = workspaces.find(w => w.id === activeWorkspaceId) ?? workspaces[0];

    const navItems = [
        { key: 'overview', label: t(lang, 'overview'), icon: LayoutDashboard },
        { key: 'earnings', label: t(lang, 'earnings'), icon: TrendingUp },
        { key: 'expenses', label: t(lang, 'expenses'), icon: Receipt },
        { key: 'bills', label: t(lang, 'bills_commitments'), icon: CalendarDays },
        { key: 'savings', label: t(lang, 'savings'), icon: Target },
        { key: 'converter', label: t(lang, 'converter'), icon: ArrowLeftRight },
        { key: 'settings', label: t(lang, 'settings'), icon: Settings },
    ];

    return (
        <aside className="sidebar">
            <div className="sidebar-logo">
                <div className="logo-icon">FV</div>
                <span className="logo-text">Finance<span> VA</span></span>
            </div>

            {/* Workspace switcher */}
            <div style={{ padding: '16px 12px 0', position: 'relative' }} ref={wsRef}>
                <div className="workspace-chip" onClick={() => setWsOpen(!wsOpen)} style={{ width: '100%' }}>
                    <div style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: activeWs?.color || 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                        {activeWs?.name?.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ flex: 1, fontSize: 13 }}>{activeWs?.name}</span>
                    <ChevronDown size={14} style={{ color: 'var(--text-muted)', transition: 'transform 200ms', transform: wsOpen ? 'rotate(180deg)' : 'none' }} />
                </div>
                {wsOpen && (
                    <div className="dropdown-menu" style={{ left: 12, right: 12, top: 'calc(100% + 4px)', minWidth: 'unset' }}>
                        {workspaces.map(ws => (
                            <div key={ws.id} className={`dropdown-item ${ws.id === activeWorkspaceId ? 'active' : ''}`}
                                onClick={() => { setActiveWorkspace(ws.id); setWsOpen(false); }}>
                                <div style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: ws.color || 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>
                                    {ws.name?.charAt(0).toUpperCase()}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600 }}>{ws.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ws.type === 'personal' ? t(lang, 'personal') : t(lang, 'shared')}</div>
                                </div>
                            </div>
                        ))}
                        <div className="dropdown-divider" />
                        <div className="dropdown-item" onClick={() => { onNavigate('workspaces'); setWsOpen(false); }}>
                            <Plus size={18} />
                            <span>{t(lang, 'new_workspace')}</span>
                        </div>
                    </div>
                )}
            </div>

            <nav className="nav-section" style={{ marginTop: 8 }}>
                {navItems.map(item => (
                    <div key={item.key} className={`nav-item ${active === item.key ? 'active' : ''}`}
                        onClick={() => onNavigate(item.key)}>
                        <item.icon size={20} />
                        <span>{item.label}</span>
                    </div>
                ))}
                <div className={`nav-item ${active === 'workspaces' ? 'active' : ''}`} onClick={() => onNavigate('workspaces')}>
                    <FolderOpen size={20} />
                    <span>{t(lang, 'workspaces')}</span>
                </div>
            </nav>

            {/* Theme toggle */}
            <div style={{ padding: '0 12px 8px', display: 'flex', gap: 4 }}>
                <div className="nav-item" style={{ flex: 1 }} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                    {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    <span>{theme === 'dark' ? t(lang, 'light_mode') : t(lang, 'dark_mode')}</span>
                </div>
            </div>

            {/* User profile */}
            <div className="sidebar-user" onClick={() => onNavigate('settings')}>
                <div className="user-avatar">
                    {user?.avatar ? <img src={user.avatar} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} alt="" /> : (user?.name?.[0] ?? 'A')}
                </div>
                <div className="user-info">
                    <div className="user-name">{user?.name ?? 'Guest'}</div>
                    <div className="user-email">{user?.email ?? ''}</div>
                </div>
                <LogOut size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); logout(); }} />
            </div>
        </aside>
    );
}
