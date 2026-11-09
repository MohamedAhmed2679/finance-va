import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Users } from 'lucide-react';
import { useStore } from '../store/useStore';
import { tx } from '../i18n/translations';

const ROLE: Record<string, string> = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };

/**
 * Invitations to someone else's workspace wait here until the guest answers.
 * Nothing from that workspace is visible to them until they accept.
 */
export default function InvitationsBar() {
    const invitations = useStore(s => s.invitations);
    const answer = useStore(s => s.answerInvitation);
    const [busy, setBusy] = useState<string | null>(null);
    const signedIn = useStore(s => s.isAuthenticated);
    // Check when the app opens and whenever it comes back to the foreground
    useEffect(() => {
        if (!signedIn) return;
        const check = () => { if (document.visibilityState === 'visible') useStore.getState().loadInvitations().catch(() => {}); };
        check();
        document.addEventListener('visibilitychange', check);
        return () => document.removeEventListener('visibilitychange', check);
    }, [signedIn]);
    if (!invitations.length) return null;

    async function respond(id: string, name: string, accept: boolean) {
        setBusy(id + accept);
        try {
            const r = await answer(id, accept);
            if (r === 'accepted' || r === 'already_member') toast.success(`${tx('You joined')} ${name}`);
            else if (r === 'declined') toast(`${tx('Invitation declined')}: ${name}`);
            else toast.error(tx('That invitation is no longer available.'));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : tx("Couldn't answer the invitation. Try again."));
        } finally { setBusy(null); }
    }

    return (
        <section className="invitations-bar" aria-label={tx('Workspace invitations')}>
            {invitations.map(i => (
                <div key={i.workspace_id} className="invitation-card" role="group" aria-label={`${tx('Invitation to')} ${i.workspace}`}>
                    <div className="invitation-icon" style={{ background: i.color || 'var(--primary)' }} aria-hidden>
                        {i.icon && !/^[a-z]/i.test(i.icon) ? i.icon : <Users size={18} />}
                    </div>
                    <div className="invitation-text">
                        <strong>{i.inviter || tx('Someone')} {tx('invited you to')} {i.workspace}</strong>
                        <span>{tx('You would join as')} {tx(ROLE[i.role] || i.role)} · {i.members} {i.members === 1 ? tx('member') : tx('members')}</span>
                    </div>
                    <div className="invitation-actions">
                        <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => respond(i.workspace_id, i.workspace, false)}>
                            {busy === i.workspace_id + 'false' ? tx('Declining…') : tx('Decline')}
                        </button>
                        <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => respond(i.workspace_id, i.workspace, true)}>
                            {busy === i.workspace_id + 'true' ? tx('Joining…') : tx('Accept')}
                        </button>
                    </div>
                </div>
            ))}
        </section>
    );
}
