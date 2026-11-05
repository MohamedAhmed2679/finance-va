import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Users, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { acceptInvite, previewInvite, type InvitePreview } from '../services/supabaseSync';

const KEY = 'zaylo_join_token';

/** Called once at startup: a /join/<token> visit is remembered across sign-in (and OAuth redirects). */
export function captureJoinLink() {
    try {
        const m = window.location.pathname.match(/^\/join\/([A-Za-z0-9]{8,64})\/?$/);
        if (m) {
            localStorage.setItem(KEY, m[1]);
            window.history.replaceState({}, '', '/overview');
        }
    } catch { /* storage blocked: the link just won't survive sign-in */ }
}
export const hasPendingJoin = () => { try { return Boolean(localStorage.getItem(KEY)); } catch { return false; } };

const MESSAGES: Record<string, string> = {
    not_found: "This invite link doesn't exist. Ask for a new one.",
    revoked: 'This invite link was turned off. Ask for a new one.',
    expired: 'This invite link has expired. Ask for a new one.',
    used: 'This invite was already used.',
};

/** "Join workspace?" dialog for a remembered invite link. Mounted inside the signed-in app. */
export default function JoinInvite() {
    const { user, hydrateStore, setActiveWorkspace } = useStore();
    const [token, setToken] = useState<string | null>(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
    const [info, setInfo] = useState<InvitePreview | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!token || !user?.dbId) return;
        previewInvite(token).then(setInfo).catch(e => setError(e instanceof Error ? e.message : "Couldn't open this invite."));
    }, [token, user?.dbId]);

    const close = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setToken(null); };

    async function join() {
        if (!token) return;
        setBusy(true);
        try {
            const r = await acceptInvite(token);
            await hydrateStore();
            setActiveWorkspace(r.workspace_id);
            toast.success(r.status === 'already_member' ? `You're already in ${r.workspace}. Switched to it.` : `You joined ${r.workspace}.`);
            close();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't join. Try again.");
        } finally { setBusy(false); }
    }

    if (!token) return null;
    const bad = info && info.status !== 'valid';

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
            <div className="modal join-card animate-slideUp" role="dialog" aria-modal="true" aria-labelledby="join-title">
                <button className="modal-close join-close" onClick={close} aria-label="Close"><X size={20} /></button>
                {!info && !error && <div className="skeleton" style={{ height: 140 }} />}
                {info && !bad && (
                    <>
                        <div className="join-icon" style={{ background: `${info.color || '#2563FF'}22`, color: info.color || '#2563FF' }}>{info.icon || <Users size={26} />}</div>
                        <h2 className="modal-title" id="join-title">Join {info.workspace}?</h2>
                        <p className="text-muted">{info.inviter ? `${info.inviter} invited you` : 'You were invited'} as a {info.role}. {info.members} {info.members === 1 ? 'person is' : 'people are'} in it.</p>
                        <p className="text-sm text-muted mt-2">Members see this workspace's expenses, income, bills and chat.</p>
                        {error && <div className="auth-msg error mt-2" role="alert">{error}</div>}
                        <div className="join-actions">
                            <button className="btn btn-secondary" onClick={close}>Not now</button>
                            <button className="btn btn-primary" onClick={join} disabled={busy}>{busy ? 'Joining…' : info.already_member ? 'Open workspace' : `Join ${info.workspace}`}</button>
                        </div>
                    </>
                )}
                {(bad || (error && !info)) && (
                    <>
                        <h2 className="modal-title" id="join-title">Can't use this invite</h2>
                        <p className="text-muted">{error || MESSAGES[info!.status]}</p>
                        <div className="join-actions"><button className="btn btn-primary" onClick={close}>OK, got it</button></div>
                    </>
                )}
            </div>
        </div>
    );
}
