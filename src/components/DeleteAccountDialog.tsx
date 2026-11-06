import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Dialog from './Dialog';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import { confirmationText, deleteAccount, deletionPreview, type DeletionPreview } from '../services/account';
import { clearLocalUserData } from '../services/deviceData';
import { forgetAccount } from '../services/savedSignIn';

/** Settings → Security & Privacy → Delete account. Shows exactly what will happen, then asks the person to type their email. */
export default function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
    const user = useStore(s => s.user);
    const logout = useStore(s => s.logout);
    const [preview, setPreview] = useState<DeletionPreview | null | 'loading'>('loading');
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const expected = confirmationText(user?.email);
    const matches = (expected === 'DELETE' ? typed.trim() : typed.trim().toLowerCase()) === expected;

    useEffect(() => { deletionPreview().then(setPreview).catch(() => setPreview(null)); }, []);

    async function remove() {
        if (!matches || busy) return;
        setBusy(true); setError('');
        try {
            const r = await deleteAccount(typed.trim());
            clearLocalUserData();
            if (user?.email) await forgetAccount(user.email).catch(() => {});
            try { localStorage.removeItem('zaylo_outbox_v1'); } catch { /* storage blocked */ }
            toast.success(r.warning || tx('Your Zaylo account was deleted.'), { id: 'account-deleted', duration: 9000 });
            onClose();
            logout();
        } catch (e) {
            setError(e instanceof Error ? e.message : tx('Couldn\'t delete your account. Try again.'));
            setBusy(false);
        }
    }

    const list = (title: string, items: string[]) => items.length > 0 && (
        <div className="del-group"><div className="del-group-title">{title}</div><ul>{items.map(n => <li key={n}>{n}</li>)}</ul></div>
    );

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <Dialog labelledBy="dlg-del-account" onClose={() => { if (!busy) onClose(); }} style={{ maxWidth: 480, padding: 24 }}>
                <h2 id="dlg-del-account" style={{ fontSize: 19, fontWeight: 700, color: 'var(--danger)', marginBottom: 8 }}>{tx('Delete your Zaylo account?')}</h2>
                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 14 }}>
                    {tx('This permanently deletes your account and can\'t be undone. Download a report or backup first if you want to keep a copy.')}
                </p>
                {preview === 'loading' ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tx('Checking your workspaces…')}</p> : preview && (
                    <div className="del-summary">
                        {list(tx('Deleted with everything in them'), preview.deleteWorkspaces)}
                        {list(tx('Shared workspaces that pass to the next admin or member (their data stays)'), preview.transferWorkspaces)}
                        {list(tx('Shared workspaces you leave (your entries stay, shown as "Deleted user")'), preview.leaveWorkspaces)}
                    </div>
                )}
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '12px 0' }}>
                    {tx('Also deleted: your profile, chat messages, notifications, reminders, connected devices, cloud backup connections, Smart Carts and photos.')}
                </p>
                <form onSubmit={e => { e.preventDefault(); remove(); }}>
                    <label className="form-label" htmlFor="del-confirm">
                        {expected === 'DELETE' ? tx('Type DELETE to confirm') : tx('Type your email address to confirm')}
                    </label>
                    {expected !== 'DELETE' && <div className="del-expected" dir="ltr">{user?.email}</div>}
                    <input id="del-confirm" className="form-input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} dir="ltr" data-autofocus disabled={busy} />
                    {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
                    <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
                        <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={busy}>{tx('Cancel')}</button>
                        <button type="submit" className="btn btn-danger" style={{ flex: 1 }} disabled={!matches || busy}>{busy ? tx('Deleting…') : tx('Delete account')}</button>
                    </div>
                </form>
            </Dialog>
        </div>
    );
}
