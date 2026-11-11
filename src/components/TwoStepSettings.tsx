/**
 * Settings → Security & Privacy → Two-step verification, and "Sign out other devices".
 * Setting up: scan the QR code (or type the key), then confirm one code. It is only on after that.
 */
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck, MonitorSmartphone } from 'lucide-react';
import { tx } from '../i18n/translations';
import { listTotpFactors, startEnrolment, verifyCode, cancelEnrolment, removeFactor, signOutOtherDevices, type TotpFactor, type Enrolment } from '../services/mfa';

export function CodeInput({ value, onChange, id, autoFocus }: { value: string; onChange: (v: string) => void; id: string; autoFocus?: boolean }) {
    return (
        <input id={id} className="form-input code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} dir="ltr"
            autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
    );
}

export default function TwoStepSettings() {
    const [factors, setFactors] = useState<TotpFactor[] | null>(null);
    const [loadError, setLoadError] = useState('');
    const [setup, setSetup] = useState<Enrolment | null>(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [confirmOthers, setConfirmOthers] = useState(false);
    const pending = useRef<string | null>(null);

    const load = () => { setLoadError(''); listTotpFactors().then(setFactors).catch(e => { setFactors([]); setLoadError(e.message); }); };
    useEffect(() => { load(); return () => { if (pending.current) cancelEnrolment(pending.current); }; }, []);

    const on = (factors?.length || 0) > 0;
    const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

    const begin = () => run(async () => { const e = await startEnrolment(); pending.current = e.factorId; setSetup(e); setCode(''); });
    const confirm = () => run(async () => {
        if (!setup) return;
        await verifyCode(setup.factorId, code);
        pending.current = null; setSetup(null); setCode('');
        toast.success(tx('Two-step verification is on.'));
        load();
    });
    const cancel = () => { if (setup) cancelEnrolment(setup.factorId); pending.current = null; setSetup(null); setCode(''); setError(''); };
    const remove = () => run(async () => {
        if (!factors?.[0]) return;
        await verifyCode(factors[0].id, code);            // prove it's you before turning it off
        for (const f of factors) await removeFactor(f.id);
        setRemoving(false); setCode('');
        toast.success(tx('Two-step verification is off.'));
        load();
    });

    return (
        <div className="two-step">
            <div className="two-step-head"><ShieldCheck size={16} aria-hidden /> <strong>{tx('Two-step verification')}</strong>
                {factors !== null && !loadError && <span className={`badge ${on ? 'badge-success' : ''}`}>{on ? tx('On') : tx('Off')}</span>}</div>
            <p className="keep-hint">{tx('After your password or sign-in, Zaylo asks for a 6-digit code from an authenticator app on your phone. Someone who learns your password still can\'t get in.')}</p>
            {loadError && <p className="form-error" role="alert">{tx(loadError)} <button className="link-btn" onClick={load}>{tx('Try again')}</button></p>}

            {!on && !setup && factors !== null && !loadError && <button className="btn btn-secondary btn-sm" onClick={begin} disabled={busy}>{busy ? tx('Starting…') : tx('Set up two-step verification')}</button>}

            {setup && (
                <form className="two-step-setup" onSubmit={e => { e.preventDefault(); if (code.length === 6) confirm(); }}>
                    <ol>
                        <li>{tx('Open an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password).')}</li>
                        <li>{tx('Scan this code, or type the key below into the app.')}
                            <img className="two-step-qr" src={setup.qrSvg} alt={tx('QR code for your authenticator app')} width={168} height={168} />
                            <code className="two-step-secret" dir="ltr" translate="no">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                        </li>
                        <li><label htmlFor="two-step-code">{tx('Enter the 6-digit code the app shows.')}</label>
                            <CodeInput id="two-step-code" value={code} onChange={v => { setCode(v); setError(''); }} />
                        </li>
                    </ol>
                    {error && <p className="form-error" role="alert">{tx(error)}</p>}
                    <p className="keep-hint">{tx('Keep the app on a phone you won\'t lose. If you lose it, you will need to contact support and prove the account is yours before it can be turned off.')}</p>
                    <div className="two-step-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={cancel} disabled={busy}>{tx('Cancel')}</button>
                        <button className="btn btn-primary btn-sm" disabled={busy || code.length !== 6}>{busy ? tx('Checking…') : tx('Turn on')}</button>
                    </div>
                </form>
            )}

            {on && !removing && <button className="btn btn-secondary btn-sm" onClick={() => { setRemoving(true); setCode(''); setError(''); }}>{tx('Turn off two-step verification')}</button>}
            {on && removing && (
                <form className="two-step-setup" onSubmit={e => { e.preventDefault(); if (code.length === 6) remove(); }}>
                    <label htmlFor="two-step-off">{tx('To turn it off, enter a code from your authenticator app.')}</label>
                    <CodeInput id="two-step-off" value={code} onChange={v => { setCode(v); setError(''); }} autoFocus />
                    {error && <p className="form-error" role="alert">{tx(error)}</p>}
                    <div className="two-step-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setRemoving(false); setError(''); }} disabled={busy}>{tx('Keep it on')}</button>
                        <button className="btn btn-danger btn-sm" disabled={busy || code.length !== 6}>{busy ? tx('Checking…') : tx('Turn off')}</button>
                    </div>
                </form>
            )}

            <div className="two-step-head" style={{ marginTop: 20 }}><MonitorSmartphone size={16} aria-hidden /> <strong>{tx('Other devices')}</strong></div>
            <p className="keep-hint">{tx('Signs your account out on every other phone, computer and browser. Use it if you lost a device or see activity you don\'t recognise. This device stays signed in.')}</p>
            {confirmOthers
                ? <div className="two-step-actions" style={{ justifyContent: 'flex-start' }}>
                    <span className="keep-hint">{tx('Sign out all other devices?')}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => setConfirmOthers(false)}>{tx('Cancel')}</button>
                    <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => run(async () => { await signOutOtherDevices(); setConfirmOthers(false); toast.success(tx('Your other devices were signed out.')); })}>{tx('Sign out other devices')}</button>
                </div>
                : <button className="btn btn-secondary btn-sm" onClick={() => setConfirmOthers(true)}>{tx('Sign out other devices')}</button>}
            {confirmOthers && error && <p className="form-error" role="alert">{tx(error)}</p>}
        </div>
    );
}
