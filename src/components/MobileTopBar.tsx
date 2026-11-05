import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Check, ChevronDown, Plus, Settings2, UserPlus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { ZayloMark } from './brand/Brand';
import InviteSheet from './InviteSheet';

/** Phone header: brand mark, the current workspace (tap to switch or create), and notifications. */
export default function MobileTopBar({ onNavigate }: { onNavigate: (page: string) => void }) {
    const { user, workspaces, activeWorkspaceId, setActiveWorkspace, notifications, syncStatus } = useStore();
    const [open, setOpen] = useState(false);
    const [inviteFor, setInviteFor] = useState<string | null>(null);
    const ws = workspaces.find(w => w.id === activeWorkspaceId) ?? workspaces[0];
    const unread = notifications.filter(n => !n.actioned).length;
    const canManage = (w: typeof ws) => Boolean(w) && (Boolean(user?.isAdmin) || w!.ownerId === user?.dbId || w!.members.some(m => m.uid === user?.dbId && (m.role === 'owner' || m.role === 'admin')));
    const go = (page: string) => { setOpen(false); onNavigate(page); };

    return (
        <>
            <header className="mtop" aria-label="Workspace and notifications">
                <ZayloMark size={26} />
                <button className="mtop-ws" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Workspace: ${ws?.name}. Switch or create`}>
                    <span className="ws-dot" style={{ background: ws?.color || 'var(--note)' }}>{ws?.name?.charAt(0).toUpperCase() || 'P'}</span>
                    <span className="mtop-ws-name">{ws?.name || 'Personal'}</span>
                    <span className="sync-dot" data-state={syncStatus} aria-hidden />
                    <ChevronDown size={15} aria-hidden />
                </button>
                <button className="mtop-bell" onClick={() => onNavigate('activity')} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
                    <Bell size={20} />
                    {unread > 0 && <span className="mtop-badge">{unread > 9 ? '9+' : unread}</span>}
                </button>
            </header>

            <AnimatePresence>
                {open && (
                    <>
                        <motion.div className="sheet-overlay" style={{ animation: 'none' }} onClick={() => setOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                        <motion.div className="sheet" role="dialog" aria-label="Workspaces"
                            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
                            onDragEnd={(_, info) => { if (info.offset.y > 90 || info.velocity.y > 500) setOpen(false); }}>
                            <div className="sheet-handle" />
                            <div className="ws-sheet-head">
                                <h2>Workspaces</h2>
                                <button className="btn btn-ghost btn-sm" onClick={() => go('workspaces')}><Settings2 size={15} /> Manage</button>
                            </div>
                            <div className="ws-sheet-list" role="listbox" aria-label="Switch workspace">
                                {workspaces.map(w => (
                                    <div key={w.id} className={`ws-sheet-row ${w.id === activeWorkspaceId ? 'on' : ''}`}>
                                        <button role="option" aria-selected={w.id === activeWorkspaceId} className="ws-sheet-pick" onClick={() => { setActiveWorkspace(w.id); setOpen(false); }}>
                                            <span className="ws-dot" style={{ background: w.color || 'var(--note)' }}>{w.name?.charAt(0).toUpperCase()}</span>
                                            <span className="ws-sheet-text">
                                                <strong>{w.name}</strong>
                                                <span>{w.members.length} {w.members.length === 1 ? 'member' : 'members'} · {w.currency}</span>
                                            </span>
                                            {w.id === activeWorkspaceId && <Check size={18} className="ws-check" />}
                                        </button>
                                        {canManage(w) && <button className="icon-btn" onClick={() => { setOpen(false); setInviteFor(w.id); }} aria-label={`Add people to ${w.name}`} title="Add people"><UserPlus size={17} /></button>}
                                    </div>
                                ))}
                            </div>
                            <button className="btn btn-primary w-full btn-lg mt-4" onClick={() => { try { sessionStorage.setItem('zaylo_new_ws', '1'); } catch { /* ignore */ } window.dispatchEvent(new Event('zaylo:new-workspace')); go('workspaces'); }}><Plus size={18} /> New workspace</button>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
            {inviteFor && workspaces.find(w => w.id === inviteFor) && <InviteSheet ws={workspaces.find(w => w.id === inviteFor)!} onClose={() => setInviteFor(null)} />}
        </>
    );
}
