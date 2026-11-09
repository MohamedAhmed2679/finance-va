import { useDialog } from '../hooks/useDialog';
import { tx } from '../i18n/translations';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Link2, Share2, UserPlus, X, Check } from 'lucide-react';
import { useStore, type Workspace, type WorkspaceRole } from '../store/useStore';
import { createInviteLink, listInvites, revokeInvite, inviteUrl, type InviteRow } from '../services/supabaseSync';

const ROLES: { value: WorkspaceRole; label: string; hint: string }[] = [
    { value: 'member', label: 'Member', hint: 'Adds and edits entries' },
    { value: 'viewer', label: 'Viewer', hint: 'Can only look' },
    { value: 'admin', label: 'Admin', hint: 'Also manages people' },
];

function kindOf(v: string) {
    const t = v.trim();
    if (!t) return '';
    if (t.includes('@')) return 'Email';
    if (/^(zy)?[-\s]?[a-z0-9]{6}$/i.test(t.replace(/\s/g, ''))) return 'Zaylo ID';
    if (/^\+?[\d\s()-]{7,}$/.test(t)) return 'Phone';
    return '';
}

async function copy(text: string, what = 'Link') {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); }
    catch { toast.error(tx('Couldn\'t copy. Press and hold to copy it instead.')); }
}

async function share(url: string, wsName: string) {
    const text = `Join "${wsName}" on Zaylo to track shared spending together.`;
    if (navigator.share) { try { await navigator.share({ title: tx('Join me on Zaylo'), text, url }); return; } catch { /* cancelled */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener');
}

/** Add people to a workspace: directly by email / phone / Zaylo ID, or with a shareable link. */
export default function InviteSheet({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
    const inviteMember = useStore(s => s.inviteMember);
    const [tab, setTab] = useState<'person' | 'link'>('person');
    const [who, setWho] = useState('');
    const [role, setRole] = useState<WorkspaceRole>('member');
    const [days, setDays] = useState(14);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
    const [links, setLinks] = useState<InviteRow[]>([]);
    const [fresh, setFresh] = useState('');

    useEffect(() => { if (tab === 'link') listInvites(ws.id).then(setLinks); }, [tab, ws.id]);

    async function addPerson(e: React.FormEvent) {
        e.preventDefault();
        const id = who.trim();
        if (!id) return;
        setBusy(true); setNote(null);
        try {
            const r = await inviteMember(ws.id, id, '', role);
            if (r === 'invited' || r === 'added') { toast.success(tx('Invitation sent')); setWho(''); setNote({ tone: 'ok', text: `Invitation sent to ${id}. They'll join ${ws.name} as ${role} once they accept.` }); }
            else if (r === 'already_invited') { setWho(''); setNote({ tone: 'ok', text: `${id} already has an invitation to ${ws.name}. They still need to accept it.` }); }
            else if (r === 'pending') { setNote({ tone: 'ok', text: `${id} doesn't have Zaylo yet. When they sign up with that email they'll see your invitation to accept. Send them a link so they know.` }); setWho(''); }
            else if (r === 'already_member') setNote({ tone: 'warn', text: `${id} is already in ${ws.name}.` });
            else if (r === 'self') setNote({ tone: 'warn', text: tx('That\'s your own account.') });
            else setNote({ tone: 'warn', text: `No Zaylo account matches ${id}. Check the spelling, use their email, or send an invite link.` });
        } catch (err) {
            setNote({ tone: 'warn', text: err instanceof Error ? err.message : "Couldn't add them. Try again." });
        } finally { setBusy(false); }
    }

    async function makeLink() {
        setBusy(true);
        try {
            const token = await createInviteLink(ws.id, role, days);
            const url = inviteUrl(token);
            setFresh(url);
            setLinks(await listInvites(ws.id));
            copy(url);
        } catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't create a link."); }
        finally { setBusy(false); }
    }

    async function turnOff(l: InviteRow) {
        try { await revokeInvite(l.id); setLinks(x => x.filter(i => i.id !== l.id)); if (fresh.endsWith(l.token)) setFresh(''); toast.success(tx('Link turned off')); }
        catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't turn it off."); }
    }

    const kind = kindOf(who);

    const dlgRef = useDialog<HTMLDivElement>(onClose);
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal invite-sheet animate-slideUp" ref={dlgRef} role="dialog" aria-modal="true" aria-labelledby="invite-title">
                <div className="sheet-grip" aria-hidden />
                <div className="modal-header">
                    <div>
                        <h2 className="modal-title" id="invite-title">{tx('Add people')}</h2>
                        <p className="text-sm text-muted">to {ws.icon} {ws.name}</p>
                    </div>
                    <button className="modal-close" onClick={onClose} aria-label={tx('Close')}><X size={20} /></button>
                </div>

                <div className="seg" role="tablist" aria-label={tx('How to add')}>
                    <button role="tab" aria-selected={tab === 'person'} className={tab === 'person' ? 'active' : ''} onClick={() => setTab('person')}><UserPlus size={15} />{' '}{tx('Add someone')}</button>
                    <button role="tab" aria-selected={tab === 'link'} className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')}><Link2 size={15} />{' '}{tx('Invite link')}</button>
                </div>

                <fieldset className="role-pick">
                    <legend className="form-label">{tx('Their role')}</legend>
                    {ROLES.map(r => (
                        <label key={r.value} className={`role-opt ${role === r.value ? 'on' : ''}`}>
                            <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} />
                            <strong>{r.label}</strong><span>{r.hint}</span>
                        </label>
                    ))}
                </fieldset>

                {tab === 'person' ? (
                    <form onSubmit={addPerson}>
                        <label className="form-label" htmlFor="invite-who">{tx('Email, phone or Zaylo ID')}</label>
                        <div className="who-field">
                            <input id="invite-who" className="form-input" value={who} onChange={e => { setWho(e.target.value); setNote(null); }}
                                placeholder={tx('name@email.com · +20 100… · ZY-7K4P2M')} autoComplete="off" autoCapitalize="none" inputMode="email" autoFocus />
                            {kind && <span className="who-kind">{kind}</span>}
                        </div>
                        <p className="text-xs text-muted mt-2">{tx('Their Zaylo ID is in Settings → Profile on their phone.')}</p>
                        {note && <div className={`invite-note ${note.tone}`} role="status">{note.tone === 'ok' && <Check size={15} />}{note.text}</div>}
                        <button className="btn btn-primary w-full btn-lg mt-4" disabled={busy || !who.trim()}>{busy ? tx('Adding…') : tx('Add to workspace')}</button>
                    </form>
                ) : (
                    <div>
                        <label className="form-label" htmlFor="invite-days">{tx('Link works for')}</label>
                        <select id="invite-days" className="form-input form-select" value={days} onChange={e => setDays(+e.target.value)}>
                            <option value={1}>{tx('1 day')}</option><option value={7}>{tx('7 days')}</option><option value={14}>{tx('14 days')}</option><option value={30}>{tx('30 days')}</option>
                        </select>
                        <p className="text-xs text-muted mt-2">{tx('Anyone with the link can join as a')}{' '}{role}{' '}{tx('after signing in. Turn it off any time.')}</p>
                        <button className="btn btn-primary w-full btn-lg mt-4" onClick={makeLink} disabled={busy}><Link2 size={16} /> {busy ? tx('Creating…') : tx('Create and copy link')}</button>

                        {fresh && (
                            <div className="link-box">
                                <code>{fresh}</code>
                                <div className="link-actions">
                                    <button className="btn btn-secondary" onClick={() => copy(fresh)}><Copy size={15} />{' '}{tx('Copy')}</button>
                                    <button className="btn btn-secondary" onClick={() => share(fresh, ws.name)}><Share2 size={15} />{' '}{tx('Share')}</button>
                                </div>
                            </div>
                        )}

                        {links.length > 0 && (
                            <div className="mt-4">
                                <div className="form-label">{tx('Active links')}</div>
                                <div className="link-list">
                                    {links.map(l => (
                                        <div key={l.id} className="link-row">
                                            <div style={{ minWidth: 0 }}>
                                                <div className="link-row-title">{l.email ? `For ${l.email}` : `${l.role[0].toUpperCase()}${l.role.slice(1)} link`}</div>
                                                <div className="text-xs text-muted">{tx('Used')}{' '}{l.uses}{l.max_uses ? `/${l.max_uses}` : ''}{' '}{tx('· ends')}{' '}{new Date(l.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                                            </div>
                                            <button className="icon-btn" onClick={() => copy(inviteUrl(l.token))} aria-label={tx('Copy link')} title={tx('Copy link')}><Copy size={15} /></button>
                                            <button className="btn btn-ghost btn-sm" onClick={() => turnOff(l)}>{tx('Turn off')}</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
