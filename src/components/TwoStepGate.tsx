/**
 * Shown instead of the app when the account has two-step verification on and this session
 * hasn't entered a code yet. The data itself is also refused by the database until then (v31).
 */
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import { listTotpFactors, verifyCode } from '../services/mfa';
import { CodeInput } from './TwoStepSettings';

export default function TwoStepGate({ onPassed }: { onPassed: () => void }) {
    const logout = useStore(s => s.logout);
    const [factorId, setFactorId] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => { listTotpFactors().then(f => setFactorId(f[0]?.id || null)).catch(e => setError(e.message)); }, []);

    const submit = async () => {
        if (!factorId || code.length !== 6 || busy) return;
        setBusy(true); setError('');
        try { await verifyCode(factorId, code); onPassed(); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); setCode(''); }
        finally { setBusy(false); }
    };

    return (
        <main className="two-step-gate">
            <form className="card" onSubmit={e => { e.preventDefault(); submit(); }} aria-labelledby="gate-title">
                <ShieldCheck size={28} aria-hidden className="two-step-gate-icon" />
                <h1 id="gate-title">{tx('Enter your verification code')}</h1>
                <p>{tx('Open your authenticator app and enter the 6-digit code for Zaylo.')}</p>
                <label className="sr-only" htmlFor="gate-code">{tx('6-digit code')}</label>
                <CodeInput id="gate-code" value={code} onChange={v => { setCode(v); setError(''); }} autoFocus />
                {error && <p className="form-error" role="alert">{tx(error)}</p>}
                <button className="btn btn-primary" disabled={busy || code.length !== 6 || !factorId}>{busy ? tx('Checking…') : tx('Continue')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>{tx('Sign out')}</button>
                <p className="keep-hint">{tx('Lost your phone? Write to Zaylo support from the email address of your account.')} <a href="https://zaylo.cc/privacy" target="_blank" rel="noreferrer">{tx('Contact details')}</a></p>
            </form>
        </main>
    );
}
