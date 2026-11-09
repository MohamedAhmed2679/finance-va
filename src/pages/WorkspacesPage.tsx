import { useDialog } from '../hooks/useDialog';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useStore, type Workspace, type WorkspaceRole } from '../store/useStore';
import { t, tx } from '../i18n/translations';
import { WORKSPACE_ICONS, WORKSPACE_COLORS, CURRENCIES } from '../constants';
import { Plus, Check, UserPlus, Trash2, Archive, ArchiveRestore, X, Crown } from 'lucide-react';
import InviteSheet from '../components/InviteSheet';

export default function WorkspacesPage() {
    const { user, workspaces, activeWorkspaceId, addWorkspace, setActiveWorkspace, deleteWorkspace, updateWorkspace, removeMember, updateMemberRole, refreshMembers } = useStore();
    useEffect(() => { workspaces.forEach(w => { refreshMembers(w.id).catch(() => {}); }); }, [workspaces.length]); // eslint-disable-line react-hooks/exhaustive-deps
    const lang = user?.language ?? 'en';
    const [showCreate, setShowCreate] = useState(false);
    const createRef = useDialog<HTMLDivElement>(() => setShowCreate(false), showCreate);
    const [inviteFor, setInviteFor] = useState<string | null>(null);
    const [wsName, setWsName] = useState('');
    const [wsType, setWsType] = useState<'personal' | 'shared'>('shared');
    const [wsIcon, setWsIcon] = useState('🏠');
    const [wsColor, setWsColor] = useState(WORKSPACE_COLORS[0]);
    const [wsCurrency, setWsCurrency] = useState(user?.defaultCurrency ?? 'USD');

    // "New workspace" from the switcher (phone sheet or sidebar) opens the form directly
    useEffect(() => {
        const open = () => { setShowCreate(true); try { sessionStorage.removeItem('zaylo_new_ws'); } catch { /* ignore */ } };
        try { if (sessionStorage.getItem('zaylo_new_ws')) open(); } catch { /* ignore */ }
        window.addEventListener('zaylo:new-workspace', open);
        return () => window.removeEventListener('zaylo:new-workspace', open);
    }, []);

    const me = user?.dbId;
    const myRole = (ws: Workspace) => (ws.ownerId === me ? 'owner' : ws.members.find(m => m.uid === me)?.role);
    const canManage = (ws: Workspace) => Boolean(user?.isAdmin) || ['owner', 'admin'].includes(myRole(ws) || '');
    const isOwner = (ws: Workspace) => myRole(ws) === 'owner' || Boolean(user?.isAdmin);

    function create(e: React.FormEvent) {
        e.preventDefault();
        if (!wsName.trim()) return;
        const id = addWorkspace({ name: wsName.trim(), type: wsType, ownerId: me ?? '', currency: wsCurrency, icon: wsIcon, color: wsColor, members: [], createdAt: new Date().toISOString() });
        setActiveWorkspace(id);
        toast.success(`${wsName.trim()} created`);
        setWsName(''); setShowCreate(false);
        if (wsType === 'shared') setTimeout(() => setInviteFor(id), 400);
    }

    async function changeRole(wsId: string, uid: string, role: WorkspaceRole) {
        try { await updateMemberRole(wsId, uid, role); toast.success(tx('Role updated')); }
        catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't change the role."); }
    }
    async function kick(wsId: string, uid: string, name: string) {
        if (!confirm(`Remove ${name}? They lose access to this workspace and its chat.`)) return;
        try { await removeMember(wsId, uid); toast.success(`${name} was removed`); }
        catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't remove them."); }
    }
    function remove(ws: Workspace) {
        if (!confirm(`Delete "${ws.name}" and all its expenses, income, bills and chat? This can't be undone.`)) return;
        deleteWorkspace(ws.id);
        toast.success(`${ws.name} deleted`);
    }

    const inviteWs = workspaces.find(w => w.id === inviteFor);

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'workspaces')}</h1>
                    <p className="page-subtitle">{tx('Keep money separate — personal, family, a trip — and share any of them.')}</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={16} />{' '}{tx('New workspace')}</button>
            </div>

            <div className="ws-list">
                {workspaces.map(ws => {
                    const active = ws.id === activeWorkspaceId;
                    const manage = canManage(ws);
                    return (
                        <article key={ws.id} className={`card ws-card ${active ? 'is-active' : ''}`} style={{ ['--ws' as string]: ws.color }}>
                            <header className="ws-card-head">
                                <span className="ws-card-icon" aria-hidden>{ws.icon}</span>
                                <div className="ws-card-title">
                                    <h2>{ws.name}{ws.isArchived && <span className="badge badge-warning">{tx('Archived')}</span>}</h2>
                                    <p>{ws.type === 'shared' ? tx('Shared') : tx('Personal')} · {ws.currency} · {ws.members.length} {ws.members.length === 1 ? tx('member') : tx('members')}</p>
                                </div>
                                {active ? <span className="badge badge-primary"><Check size={12} />{' '}{tx('Current')}</span>
                                    : !ws.isArchived && <button className="btn btn-secondary btn-sm" onClick={() => { setActiveWorkspace(ws.id); toast.success(`Switched to ${ws.name}`); }}>{tx('Switch')}</button>}
                            </header>

                            <ul className="ws-members" aria-label={`Members of ${ws.name}`}>
                                {ws.members.map(m => {
                                    const editable = manage && m.uid !== me && m.role !== 'owner';
                                    return (
                                        <li key={m.uid}>
                                            <span className="user-avatar" aria-hidden>{(m.name || '?')[0].toUpperCase()}</span>
                                            <span className="ws-member-name" translate="no">{m.name}{m.uid === me ? ' (you)' : ''}{m.status === 'invited' && <span className="badge badge-warning" style={{ marginInlineStart: 6 }}>{tx('Invited')}</span>}</span>
                                            {editable ? (
                                                <select className="form-select ws-role" aria-label={`Role for ${m.name}`} value={m.role} onChange={e => changeRole(ws.id, m.uid, e.target.value as WorkspaceRole)}>
                                                    <option value="admin">{tx('Admin')}</option><option value="member">{tx('Member')}</option><option value="viewer">{tx('Viewer')}</option>
                                                </select>
                                            ) : <span className="ws-role-label">{m.role === tx('owner') && <Crown size={12} />} {m.role}</span>}
                                            {editable ? <button className="icon-btn" aria-label={m.status === 'invited' ? `Cancel the invitation for ${m.name}` : `Remove ${m.name}`} title={m.status === 'invited' ? tx('Cancel invitation') : tx('Remove')} onClick={() => kick(ws.id, m.uid, m.name)}><X size={15} /></button> : <span className="ws-member-pad" />}
                                        </li>
                                    );
                                })}
                            </ul>

                            {manage && (
                                <footer className="ws-card-actions">
                                    {!ws.isArchived && <button className="btn btn-primary btn-sm" onClick={() => setInviteFor(ws.id)}><UserPlus size={15} />{' '}{tx('Add people')}</button>}
                                    <span className="flex-1" />
                                    <button className="icon-btn" onClick={() => updateWorkspace(ws.id, { isArchived: !ws.isArchived })} aria-label={ws.isArchived ? `Unarchive ${ws.name}` : `Archive ${ws.name}`} title={ws.isArchived ? tx('Unarchive') : tx('Archive')}>
                                        {ws.isArchived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
                                    </button>
                                    {isOwner(ws) && workspaces.length > 1 && (
                                        <button className="icon-btn danger" onClick={() => remove(ws)} aria-label={`Delete ${ws.name}`} title={tx('Delete workspace')}><Trash2 size={17} /></button>
                                    )}
                                </footer>
                            )}
                        </article>
                    );
                })}
            </div>

            {showCreate && (
                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}>
                    <div className="modal animate-slideUp" role="dialog" aria-modal="true" aria-labelledby="new-ws-title" ref={createRef}>
                        <div className="sheet-grip" aria-hidden />
                        <div className="modal-header">
                            <h2 className="modal-title" id="new-ws-title">{tx('New workspace')}</h2>
                            <button className="modal-close" onClick={() => setShowCreate(false)} aria-label={tx('Close')}><X size={20} /></button>
                        </div>
                        <form onSubmit={create}>
                            <div className="form-group">
                                <label className="form-label" htmlFor="ws-name">{tx('Name')}</label>
                                <input id="ws-name" className="form-input" value={wsName} onChange={e => setWsName(e.target.value)} placeholder={tx('e.g. Family, Summer trip')} required autoFocus maxLength={40} />
                            </div>
                            <fieldset className="form-group">
                                <legend className="form-label">{tx('Who uses it')}</legend>
                                <div className="seg">
                                    <button type="button" role="tab" aria-selected={wsType === 'personal'} className={wsType === 'personal' ? 'active' : ''} onClick={() => setWsType('personal')}>{tx('👤 Just me')}</button>
                                    <button type="button" role="tab" aria-selected={wsType === 'shared'} className={wsType === 'shared' ? 'active' : ''} onClick={() => setWsType('shared')}>{tx('👥 Shared')}</button>
                                </div>
                            </fieldset>
                            <fieldset className="form-group">
                                <legend className="form-label">{tx('Icon')}</legend>
                                <div className="icon-pick">
                                    {WORKSPACE_ICONS.map(i => <button type="button" key={i} aria-pressed={wsIcon === i} className={wsIcon === i ? 'on' : ''} onClick={() => setWsIcon(i)}>{i}</button>)}
                                </div>
                            </fieldset>
                            <fieldset className="form-group">
                                <legend className="form-label">{tx('Colour')}</legend>
                                <div className="color-pick">
                                    {WORKSPACE_COLORS.map(c => <button type="button" key={c} aria-label={`Colour ${c}`} aria-pressed={wsColor === c} className={wsColor === c ? 'on' : ''} style={{ background: c, ['--c' as string]: c }} onClick={() => setWsColor(c)} />)}
                                </div>
                            </fieldset>
                            <div className="form-group">
                                <label className="form-label" htmlFor="ws-cur">{tx('Main currency')}</label>
                                <select id="ws-cur" className="form-input form-select" value={wsCurrency} onChange={e => setWsCurrency(e.target.value)}>
                                    {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code} — {c.name}</option>)}
                                </select>
                                <p className="text-xs text-muted mt-2">{tx('Entries in other currencies are converted to this one.')}</p>
                            </div>
                            <button type="submit" className="btn btn-primary w-full btn-lg" disabled={!wsName.trim()}>{tx('Create workspace')}</button>
                        </form>
                    </div>
                </div>
            )}

            {inviteWs && <InviteSheet ws={inviteWs} onClose={() => setInviteFor(null)} />}
        </div>
    );
}
