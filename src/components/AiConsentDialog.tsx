import { useEffect, useState } from 'react';
import Dialog from './Dialog';
import { tx } from '../i18n/translations';
import { AI_DATA_SENT, AI_NEVER_SENT, AI_PROVIDER, answerConsentAsk, onConsentAsk, setAiConsent, type AiSurface } from '../services/aiConsent';

/** What is sent, to whom and why. Used in the permission dialog and in Settings. */
export function AiDataNotice() {
    return (
        <div className="consent-notice">
            <dl className="consent-facts">
                <div><dt>{tx('Who receives it')}</dt><dd translate="no">{AI_PROVIDER}</dd></div>
                <div><dt>{tx('Why')}</dt><dd>{tx('To write answers and summaries, and to read receipts, voice notes and price tags. Zaylo does not use it for advertising.')}</dd></div>
            </dl>
            <h3 className="consent-sub">{tx('What is sent, by feature')}</h3>
            <ul className="consent-list">
                {AI_DATA_SENT.map(d => <li key={d.feature}><strong>{tx(d.feature)}</strong><span>{tx(d.sends)}</span></li>)}
            </ul>
            <p className="consent-never">{tx(AI_NEVER_SENT)}</p>
            <p className="consent-never">{tx('Data is sent only when you use one of these features. You can turn this off at any time in Settings, under AI and data. Everything else in Zaylo works without it.')}</p>
            <p className="consent-never"><a href="https://zaylo.cc/privacy" target="_blank" rel="noreferrer">{tx('Privacy policy')}</a></p>
        </div>
    );
}

/** Mounted once in the app. Appears when a feature needs AI and the person hasn't allowed it yet. */
export default function AiConsentDialog() {
    const [ask, setAsk] = useState<{ surface: AiSurface } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => onConsentAsk(a => { setAsk(a); setError(''); setBusy(false); }), []);
    if (!ask) return null;

    async function allow() {
        setBusy(true); setError('');
        try { await setAiConsent(true, ask!.surface); answerConsentAsk(true); }
        catch (e) { setError(e instanceof Error ? tx(e.message) : tx('Your choice couldn\'t be saved, so AI features stay off. Try again.')); setBusy(false); }
    }

    return (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
            <Dialog onClose={() => answerConsentAsk(false)} labelledBy="ai-consent-title" className="modal consent-modal">
                <div className="modal-header"><h2 className="modal-title" id="ai-consent-title">{tx('Allow Zaylo AI to process your data?')}</h2></div>
                <p className="consent-lead">{tx('This feature uses an AI service outside Zaylo. Before anything is sent, here is what it involves.')}</p>
                <AiDataNotice />
                {error && <div className="auth-msg error" role="alert">{error}</div>}
                <div className="consent-actions">
                    <button className="btn btn-secondary" onClick={() => answerConsentAsk(false)} disabled={busy} data-autofocus>{tx('Don\'t allow')}</button>
                    <button className="btn btn-primary" onClick={allow} disabled={busy}>{busy ? tx('Saving…') : tx('Allow')}</button>
                </div>
            </Dialog>
        </div>
    );
}
