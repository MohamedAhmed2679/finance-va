import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound } from 'lucide-react';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import { savedAccounts, forgetAccount, keepSignedIn, setKeepSignedIn, removeBiometricSignIn, biometricSignInPossible, type SavedAccount } from '../services/savedSignIn';

/** Settings → Security & Privacy → Saved sign-in on this device. */
export default function SavedSignInSettings() {
    const me = useStore(s => s.user?.email ?? '');
    const [keep, setKeep] = useState(keepSignedIn);
    const [list, setList] = useState<SavedAccount[]>(savedAccounts);
    useEffect(() => setList(savedAccounts()), []);
    const mine = list.find(a => a.email.toLowerCase() === me.toLowerCase());

    return (
        <div className="saved-signin-settings">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}><KeyRound size={16} aria-hidden /> {tx('Saved sign-in on this device')}</div>
            <label className="keep-signed-in" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={keep} onChange={e => { setKeep(e.target.checked); setKeepSignedIn(e.target.checked); toast.success(e.target.checked ? tx('You\'ll stay signed in on this device.') : tx('From now on, closing the app signs you out here and removes your data from this device.'), { id: 'keep' }); }} />
                <span>{tx('Keep me signed in on this device')}<br /><span className="keep-hint">{tx('Turn off on shared devices. Takes effect the next time the app is closed.')}</span></span>
            </label>
            {biometricSignInPossible() && (
                <p className="keep-hint" style={{ margin: '8px 0' }}>
                    {mine?.biometric
                        ? <>{tx('Fingerprint / Face ID sign-in is on for this account.')} <button className="auth-link" onClick={async () => { await removeBiometricSignIn(mine.email); setList(savedAccounts()); toast.success(tx('Fingerprint / Face ID sign-in turned off.')); }}>{tx('Turn off')}</button></>
                        : tx('Fingerprint / Face ID sign-in: sign in once with your password and Zaylo will offer it.')}
                </p>
            )}
            {list.length > 0 && (
                <ul className="at-rows">
                    {list.map(a => (
                        <li key={a.email}>
                            <span><strong>{a.name}</strong> <span dir="ltr" className="keep-hint">{a.email}</span></span>
                            <button className="btn btn-ghost btn-sm" onClick={async () => { await forgetAccount(a.email); setList(savedAccounts()); }}>{tx('Forget')}</button>
                        </li>
                    ))}
                </ul>
            )}
            <p className="keep-hint">{tx('Only names and emails are saved for the sign-in screen, never passwords. Your browser or phone may also offer to save your password.')}</p>
        </div>
    );
}
