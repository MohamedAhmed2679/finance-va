import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import { AiDataNotice } from './AiConsentDialog';
import { consentHistory, hasAiConsent, refreshAiConsent, setAiConsent, type ConsentEvent } from '../services/aiConsent';
import { fmtDateTime } from '../help/format';

/** Settings → AI and data: what is sent, the current choice, how to withdraw it, and the record of past choices. */
export default function AiSettings() {
    const lang = useStore(s => s.user?.language ?? 'en');
    const [on, setOn] = useState(hasAiConsent());
    const [busy, setBusy] = useState(false);
    const [history, setHistory] = useState<ConsentEvent[] | null>(null);

    const load = () => { refreshAiConsent().then(v => { if (v !== null) setOn(v); }); consentHistory().then(setHistory).catch(() => setHistory([])); };
    useEffect(load, []);

    async function change(next: boolean) {
        setBusy(true);
        try { await setAiConsent(next, 'settings'); setOn(next); toast.success(next ? tx('AI features are on.') : tx('AI features are off. Nothing more will be sent to the AI provider.')); }
        catch (e) { setOn(hasAiConsent()); toast.error(e instanceof Error ? tx(e.message) : tx('Your choice couldn\'t be saved. Try again.')); }
        finally { setBusy(false); load(); }
    }

    return (
        <div className="card animate-fadeIn ai-settings">
            <h2 className="settings-title">{tx('AI and data')}</h2>
            <p className="form-hint">{tx('AI features are optional. Zaylo works fully without them: you can add records by hand, and use the Help Center and support requests.')}</p>

            <div className="setting-row">
                <div>
                    <strong id="ai-switch-label">{tx('Allow Zaylo AI to process my data')}</strong>
                    <span>{on ? tx('On. Data is sent only when you use an AI feature.') : tx('Off. Nothing is sent to the AI provider.')}</span>
                </div>
                <button type="button" role="switch" aria-checked={on} aria-labelledby="ai-switch-label" className="switch" disabled={busy} onClick={() => change(!on)}><span /></button>
            </div>

            <AiDataNotice />

            <h3 className="help-subhead">{tx('Your choices so far')}</h3>
            {history === null && <div className="skeleton" style={{ height: 20, width: '60%' }} />}
            {history?.length === 0 && <p className="form-hint">{tx('No choices recorded yet.')}</p>}
            {history && history.length > 0 && (
                <ul className="consent-history">
                    {history.map(h => <li key={h.id}><span className={`badge ${h.granted ? 'badge-success' : ''}`}>{h.granted ? tx('Allowed') : tx('Withdrawn')}</span><time dateTime={h.created_at}>{fmtDateTime(h.created_at, lang)}</time></li>)}
                </ul>
            )}
        </div>
    );
}
