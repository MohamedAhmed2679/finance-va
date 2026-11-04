import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useStore, type WorkspaceRole } from '../store/useStore';
import { t } from '../i18n/translations';
import { WORKSPACE_ICONS, WORKSPACE_COLORS } from '../constants';
import { Plus, Check, Users, Shield, Crown, Eye, UserPlus, Trash2, Archive, X } from 'lucide-react';

export default function WorkspacesPage() {
    const { user, workspaces, activeWorkspaceId, addWorkspace, inviteMember, setActiveWorkspace, deleteWorkspace, updateWorkspace, removeMember, updateMemberRole, refreshMembers } = useStore();
    useEffect(() => { workspaces.forEach(w => { refreshMembers(w.id).catch(() => {}); }); }, [workspaces.length]); // eslint-disable-line react-hooks/exhaustive-deps
    const lang = user?.language ?? 'en';
    const [showCreate, setShowCreate] = useState(false);
    const [showInvite, setShowInvite] = useState<string | null>(null);
    const [wsName, setWsName] = useState('');
    const [wsType, setWsType] = useState<'personal' | 'shared'>('shared');
    const [wsIcon, setWsIcon] = useState('🏢');
    const [wsColor, setWsColor] = useState('var(--note)');
    const [wsCurrency, setWsCurrency] = useState(user?.defaultCurrency ?? 'USD');
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteName, setInviteName] = useState('');
    const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
    const [inviteMethod, setInviteMethod] = useState<'email' | 'phone' | 'id'>('email');
    const [creating, setCreating] = useState(false);
    const [inviting, setInviting] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');

    const isOwner = (ws: typeof workspaces[0]) => user?.dbId && (ws.ownerId === user.dbId || ws.ownerId === user.id || ws.ownerId === user.email);
    const isOwnerOrAdmin = (ws: typeof workspaces[0]) => Boolean(user?.isAdmin) || isOwner(ws) || ws.members.find(m => m.uid === user?.dbId || m.uid === user?.id || (m.email === user?.email && m.email))?.role === 'admin';

    function handleCreateWorkspace(e: React.FormEvent) {
        e.preventDefault();
        if (!wsName) return;
        setCreating(true);
        setTimeout(() => {
            addWorkspace({ name: wsName, type: wsType, ownerId: user?.id ?? '', currency: wsCurrency, icon: wsIcon, color: wsColor, members: [{ uid: user?.id ?? '', name: user?.name ?? 'Me', email: user?.email ?? '', role: 'owner', status: 'active', joinedAt: new Date().toISOString() }], createdAt: new Date().toISOString() });
            setWsName(''); setShowCreate(false); setCreating(false);
            setSuccessMsg('Workspace created successfully!');
            setTimeout(() => setSuccessMsg(''), 3000);
        }, 800);
    }

    async function handleInvite(e: React.FormEvent) {
        e.preventDefault();
        if (!showInvite || !inviteEmail.trim()) return;
        setInviting(true);
        try {
            const result = await inviteMember(showInvite, inviteEmail.trim(), inviteName, inviteRole);
            if (result === 'not_found') {
                toast.error(`No Finance VA account uses ${inviteEmail.trim()}. Ask them to sign up first, then add them.`);
            } else {
                toast.success(`${inviteEmail.trim()} was added and notified.`);
                setInviteEmail(''); setInviteName(''); setShowInvite(null);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't add that person.");
        } finally {
            setInviting(false);
        }
    }

    async function changeRole(wsId: string, uid: string, role: WorkspaceRole) {
        try { await updateMemberRole(wsId, uid, role); toast.success('Role updated'); }
        catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't change the role."); }
    }

    async function kick(wsId: string, uid: string, name: string) {
        if (!confirm(`Remove ${name} from this workspace? They lose access to its expenses and chat.`)) return;
        try { await removeMember(wsId, uid); toast.success(`${name} was removed`); }
        catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't remove them."); }
    }


    const roleIcon = { owner: <Crown size={12} />, admin: <Shield size={12} />, member: <Users size={12} />, viewer: <Eye size={12} /> };
    const roleColor = { owner: 'var(--primary-light)', admin: 'var(--warning)', member: 'var(--accent)', viewer: 'var(--text-muted)' };

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'workspaces')}</h1>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={16} />{t(lang, 'create_workspace')}</button>
            </div>

            {successMsg && (
                <div className="animate-slideUp" style={{ background: 'var(--accent-soft)', border: '1px solid rgba(6,214,160,0.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 24, fontSize: 14, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Check size={16} />{successMsg}
                </div>
            )}

            {/* Create workspace modal */}
            {showCreate && (
                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCreate(false) }}>
                    <div className="modal animate-slideUp">
                        <div className="modal-header">
                            <h2 className="modal-title">{t(lang, 'create_workspace')}</h2>
                            <button className="modal-close" onClick={() => setShowCreate(false)}>✕</button>
                        </div>
                        <form onSubmit={handleCreateWorkspace}>
                            <div className="form-group">
                                <label className="form-label">Workspace Name *</label>
                                <input className="form-input" value={wsName} onChange={e => setWsName(e.target.value)} placeholder="e.g. Family Budget" required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Type</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    {(['personal', 'shared'] as const).map(t2 => (
                                        <div key={t2} className={`category-chip ${wsType === t2 ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setWsType(t2)}>
                                            {t2 === 'personal' ? '👤' : '👥'} {t2 === 'personal' ? t(lang, 'personal') : t(lang, 'shared')}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Icon</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {WORKSPACE_ICONS.map(i => (
                                        <div key={i} onClick={() => setWsIcon(i)} style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${wsIcon === i ? 'var(--primary)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer', background: wsIcon === i ? 'var(--primary-soft)' : 'var(--bg-card)', transition: 'all 200ms' }}>{i}</div>
                                    ))}
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Color</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    {WORKSPACE_COLORS.map(c => (
                                        <div key={c} onClick={() => setWsColor(c)} style={{ width: 32, height: 32, borderRadius: '50%', background: c, border: `3px solid ${wsColor === c ? '#fff' : 'transparent'}`, cursor: 'pointer', transition: 'all 200ms', boxShadow: wsColor === c ? `0 0 0 2px ${c}` : 'none' }} />
                                    ))}
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Default Currency</label>
                                <select className="form-input form-select" value={wsCurrency} onChange={e => setWsCurrency(e.target.value)}>
                                    {['USD', 'EUR', 'GBP', 'JPY', 'EGP', 'AED', 'SAR', 'INR'].map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <button type="submit" className="btn btn-primary w-full btn-lg" disabled={creating}>{creating ? 'Creating…' : t(lang, 'create_workspace')}</button>
                        </form>
                    </div>
                </div>
            )}

            {/* Invite modal */}
            {showInvite && (
                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowInvite(null) }}>
                    <div className="modal animate-slideUp">
                        <div className="modal-header">
                            <h2 className="modal-title">{t(lang, 'invite_member')}</h2>
                            <button className="modal-close" onClick={() => setShowInvite(null)}>✕</button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                            {(['email', 'phone'] as const).map(m => (
                                <div key={m} className={`category-chip ${inviteMethod === m ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setInviteMethod(m)}>
                                    {m === 'email' ? 'Email' : 'Phone'}
                                </div>
                            ))}
                        </div>
                        <form onSubmit={handleInvite}>
                            <div className="form-group">
                                <label className="form-label">{inviteMethod === 'email' ? 'Their Finance VA email' : 'Their phone number with country code'}</label>
                                <input className="form-input" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder={inviteMethod === 'email' ? 'name@example.com' : '+20 100 123 4567'} type={inviteMethod === 'email' ? 'email' : 'tel'} required />
                                <div className="text-xs text-muted mt-1">They need a Finance VA account. They'll get a notification and see this workspace and its chat.</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Role</label>
                                <select className="form-input form-select" value={inviteRole} onChange={e => setInviteRole(e.target.value as WorkspaceRole)}>
                                    <option value="member">Member — can add and edit expenses</option>
                                    <option value="admin">Admin — can also manage members</option>
                                    <option value="viewer">Viewer — read only</option>
                                </select>
                            </div>
                            <button type="submit" className="btn btn-primary w-full" disabled={inviting}>{inviting ? 'Adding…' : 'Add to workspace'}</button>
                        </form>
                    </div>
                </div>
            )}

            {/* Workspace cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {workspaces.map(ws => (
                    <div key={ws.id} className="card animate-fadeIn" style={{ borderColor: ws.id === activeWorkspaceId ? ws.color : 'var(--border)', background: ws.id === activeWorkspaceId ? `${ws.color}08` : 'var(--bg-card)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                            <div style={{ width: 52, height: 52, borderRadius: 16, background: `${ws.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0, border: `1px solid ${ws.color}30` }}>{ws.icon}</div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: 16 }}>{ws.name} {ws.isArchived && <span className="badge badge-warning" style={{ fontSize: 10 }}>Archived</span>}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ws.type} · {ws.members.length} member{ws.members.length !== 1 ? 's' : ''} · {ws.currency}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {ws.id !== activeWorkspaceId && !ws.isArchived && <button className="btn btn-secondary btn-sm" onClick={() => setActiveWorkspace(ws.id)}>Switch</button>}
                                {ws.id === activeWorkspaceId && <span className="badge badge-primary">Active</span>}
                                {isOwnerOrAdmin(ws) && (
                                    <>
                                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => updateWorkspace(ws.id, { isArchived: !ws.isArchived })} title={ws.isArchived ? "Unarchive" : "Archive"}>
                                            <Archive size={14} style={{ color: ws.isArchived ? 'var(--accent)' : 'var(--text-muted)' }} />
                                        </button>
                                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { if (confirm('Delete this workspace forever?')) deleteWorkspace(ws.id); }} title="Delete">
                                            <Trash2 size={14} style={{ color: 'var(--danger)' }} />
                                        </button>
                                    </>
                                )}
                                {!ws.isArchived && isOwnerOrAdmin(ws) && <button className="btn btn-ghost btn-sm" onClick={() => setShowInvite(ws.id)}><UserPlus size={14} /> Add member</button>}
                            </div>
                        </div>

                        {/* Members */}
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {ws.members.map(m => (
                                    <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-input)', borderRadius: 99, border: '1px solid var(--border)', fontSize: 12 }}>
                                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: `${ws.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{m.name[0]}</div>
                                        <span style={{ fontWeight: 600 }}>{m.name.split(' ')[0]}</span>

                                        {isOwnerOrAdmin(ws) && m.uid !== user?.dbId && m.role !== 'owner' ? (
                                            <select aria-label={`Role for ${m.name}`} className="form-input" style={{ padding: '0 6px', minHeight: 22, height: 22, fontSize: 12, background: 'transparent', border: 'none', color: roleColor[m.role], cursor: 'pointer', appearance: 'none', width: 'auto' }} value={m.role} onChange={(e) => changeRole(ws.id, m.uid, e.target.value as WorkspaceRole)}>
                                                <option value="admin">Admin</option>
                                                <option value="member">Member</option>
                                                <option value="viewer">Viewer</option>
                                            </select>
                                        ) : (
                                            <span style={{ color: roleColor[m.role], display: 'flex', alignItems: 'center', gap: 3 }}>{roleIcon[m.role]} {m.role}</span>
                                        )}
                                        {m.status === 'invited' && <span className="badge badge-warning" style={{ fontSize: 9, padding: '1px 6px' }}>invited</span>}

                                        {isOwnerOrAdmin(ws) && m.uid !== user?.dbId && m.role !== 'owner' && (
                                            <button className="icon-btn" style={{ width: 20, height: 20 }} aria-label={`Remove ${m.name}`} onClick={() => kick(ws.id, m.uid, m.name)}><X size={12} style={{ color: 'var(--danger)' }} /></button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                ))}
            </div>
        </div>
    );
}
