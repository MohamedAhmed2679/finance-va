/**
 * AutoTrack in three short steps: which banks and wallets text you, whether to ask first,
 * and switching it on for this device (or trying it with one pasted message where SMS can't
 * be read). Everything the old settings screen asked for up front is now optional, under
 * "More options".
 */
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, ShieldCheck, Smartphone, ClipboardPaste, Apple, Copy } from 'lucide-react';
import { tx } from '../i18n/translations';
import { platform, nativeStatus, deviceState, ZayloSms, type NativeStatus } from '../autotrack/native';
import { receiverSenders, drainAndroid } from '../autotrack/runner';
import { knownSenders } from '../autotrack/senders';
import { parseMessage } from '../autotrack/parse';
import { loadSettings, saveSettings, loadAccounts, processMessage, type AutoTrackSettings } from '../autotrack/service';
import { markSetUp, createAccountsFor } from '../autotrack/setup';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../constants';

const POPULAR = ['cib', 'nbe', 'banquemisr', 'qnb', 'instapay', 'vfcash', 'etisalatcash', 'orangecash', 'telda', 'fawry'];

export default function AutoTrackSetup({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
    const userId = useStore(s => s.user?.dbId || s.user?.id);
    const plat = platform();
    const [step, setStep] = useState(1);
    const [picked, setPicked] = useState<string[]>([]);
    const [other, setOther] = useState('');
    const [mode, setMode] = useState<AutoTrackSettings['mode']>('review');
    const [settings, setSettings] = useState<AutoTrackSettings | null>(null);
    const [st, setSt] = useState<NativeStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [past, setPast] = useState(true);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        loadSettings().then(s => { setSettings(s); setMode(s.mode); }).catch(e => setErr(/does not exist|schema cache/i.test(String(e?.message)) ? tx('AutoTrack needs the latest database update.') : String(e?.message || e)));
        loadAccounts().then(a => setPicked(a.map(x => x.senderId).filter(Boolean) as string[])).catch(() => {});
        nativeStatus().then(setSt);
    }, []);

    const providers = useMemo(() => {
        const all = knownSenders();
        const popular = POPULAR.map(id => all.find(k => k.id === id)!).filter(Boolean);
        return showAll ? [...popular, ...all.filter(k => !POPULAR.includes(k.id))] : popular;
    }, [showAll]);
    const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

    async function saveChoices() {
        setBusy(true); setErr('');
        try {
            const custom = other.trim().length >= 2 ? [...new Set([...(settings?.custom_senders ?? []), other.trim()])].slice(0, 20) : (settings?.custom_senders ?? []);
            await saveSettings({ mode, custom_senders: custom });
            setSettings(s => s ? { ...s, mode, custom_senders: custom } : s);
            await createAccountsFor(picked);
            setStep(3);
        } catch (e) { setErr((e as Error).message); }
        finally { setBusy(false); }
    }

    async function turnOnAndroid() {
        setBusy(true); setErr('');
        try {
            const { permission } = await ZayloSms.requestPermission();
            if (permission !== 'granted') { setErr(tx('Android didn\'t allow it. You can allow SMS for Zaylo in Android settings, or paste messages instead.')); return; }
            const senders = receiverSenders(settings?.custom_senders ?? []);
            await ZayloSms.configure({ enabled: true, paused: false, senders });
            let imported = 0;
            if (past) {
                const h = await ZayloSms.requestHistoryPermission();
                if (h.permission === 'granted') {
                    const { messages } = await ZayloSms.scanHistory({ from: Date.now() - 30 * 86_400_000, to: Date.now(), senders });
                    for (const m of messages) {
                        const r = await processMessage({ text: m.body, sender: m.sender, receivedAt: new Date(m.receivedAt), ingestion: 'history' }, { allowAuto: false });
                        if (r.outcome === 'stored' || r.outcome === 'queued') imported++;
                    }
                }
            }
            drainAndroid().catch(() => {});
            setSt(await nativeStatus());
            finish(imported ? `${tx('AutoTrack is on.')} ${imported} ${tx('past alerts are waiting in Needs Review.')}` : tx('AutoTrack is on. New bank and wallet alerts will show up here.'));
        } catch (e) { setErr((e as Error).message); }
        finally { setBusy(false); }
    }

    function finish(message: string) { markSetUp(userId); toast.success(message, { duration: 6000 }); onDone(); }

    const androidReady = plat === 'android' && st?.supported;
    const on = deviceState(st) === 'enabled';

    return (
        <section className="card at-setup" aria-labelledby="at-setup-title">
            <div className="at-setup-head">
                <h2 id="at-setup-title">{tx('Set up AutoTrack')}</h2>
                <ol className="at-setup-steps" aria-label={tx('Steps')}>
                    {[1, 2, 3].map(n => <li key={n} className={n < step ? 'done' : n === step ? 'now' : ''} aria-current={n === step ? 'step' : undefined}>{n < step ? <Check size={12} /> : n}</li>)}
                </ol>
            </div>
            {err && <div className="at-banner" role="alert">{err}</div>}

            {step === 1 && (
                <div className="at-setup-body">
                    <h3>{tx('Which banks and wallets send you SMS?')}</h3>
                    <p className="at-note">{tx('Pick all that apply. Money moved between these is recorded as a transfer, not as spending.')}</p>
                    <div className="chip-wrap" role="group" aria-label={tx('Banks and wallets')}>
                        {providers.map(k => (
                            <button key={k.id} type="button" className={`category-chip${picked.includes(k.id) ? ' selected' : ''}`} aria-pressed={picked.includes(k.id)} onClick={() => toggle(k.id)}>
                                {picked.includes(k.id) && <Check size={13} aria-hidden />}{k.name}
                            </button>
                        ))}
                        {!showAll && <button type="button" className="category-chip" onClick={() => setShowAll(true)}>{tx('More…')}</button>}
                    </div>
                    <label className="form-label" htmlFor="at-other" style={{ marginTop: 14 }}>{tx('Not listed? Type the sender name exactly as it shows in Messages')}</label>
                    <input id="at-other" className="form-input" dir="ltr" value={other} onChange={e => setOther(e.target.value)} placeholder="e.g. MyBank" />
                    <div className="at-setup-actions">
                        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>{tx('Not now')}</button>}
                        <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>{tx('Next')}</button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="at-setup-body">
                    <h3>{tx('When an alert arrives…')}</h3>
                    <div className="income-type" role="radiogroup" aria-label={tx('When an alert arrives')}>
                        <button type="button" role="radio" aria-checked={mode === 'review'} className={mode === 'review' ? 'active' : ''} onClick={() => setMode('review')}>
                            <strong>{tx('Ask me first')}</strong><span>{tx('You tap once to confirm each one. Recommended.')}</span>
                        </button>
                        <button type="button" role="radio" aria-checked={mode === 'auto'} className={mode === 'auto' ? 'active' : ''} onClick={() => setMode('auto')}>
                            <strong>{tx('Add it for me')}</strong><span>{tx('Clear purchases and salaries are added; anything unclear still asks.')}</span>
                        </button>
                    </div>
                    <div className="at-setup-actions">
                        <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>{tx('Back')}</button>
                        <button type="button" className="btn btn-primary" onClick={saveChoices} disabled={busy || !settings}>{busy ? tx('Saving…') : tx('Next')}</button>
                    </div>
                </div>
            )}

            {step === 3 && androidReady && (
                <div className="at-setup-body">
                    <h3><Smartphone size={17} aria-hidden /> {on ? tx('AutoTrack is already on for this phone') : tx('Turn it on for this phone')}</h3>
                    <ul className="at-consent">
                        <li><ShieldCheck size={15} aria-hidden /> {tx('Only messages from banks and wallets are read. Everything else is ignored on the phone.')}</li>
                        <li><ShieldCheck size={15} aria-hidden /> {tx('Zaylo keeps the amount, merchant and last digits, never the whole message or any code.')}</li>
                        <li><ShieldCheck size={15} aria-hidden /> {tx('Pause or turn it off any time in Settings → AutoTrack.')}</li>
                    </ul>
                    <label className="at-check"><input type="checkbox" checked={past} onChange={e => setPast(e.target.checked)} /> {tx('Also bring in bank alerts from the last 30 days (they wait for your review)')}</label>
                    <p className="at-note">{tx('Android will ask you to allow SMS for Zaylo.')}</p>
                    <div className="at-setup-actions">
                        <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>{tx('Back')}</button>
                        {on ? <button type="button" className="btn btn-primary" onClick={() => finish(tx('AutoTrack is ready.'))}>{tx('Done')}</button>
                            : <button type="button" className="btn btn-primary" onClick={turnOnAndroid} disabled={busy}>{busy ? tx('Turning on…') : tx('Turn on AutoTrack')}</button>}
                    </div>
                </div>
            )}

            {step === 3 && !androidReady && (
                <div className="at-setup-body">
                    {plat === 'android' && <p className="at-banner">{tx('This version of the app can\'t read SMS yet. Update Zaylo from the latest Android build; meanwhile you can paste messages.')}</p>}
                    {plat === 'ios' && <IosShortcut />}
                    <TryPaste onSaved={() => finish(tx('AutoTrack is ready. Paste or share bank messages any time.'))} onSkip={() => finish(tx('AutoTrack is ready.'))} />
                </div>
            )}
        </section>
    );
}

/** Paste one message, see what Zaylo reads before anything is saved. */
export function TryPaste({ onSaved, onSkip }: { onSaved: () => void; onSkip?: () => void }) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const preview = useMemo(() => (text.trim().length > 8 ? parseMessage(text, null, new Date()) : null), [text]);
    const readable = preview && preview.amountMinor != null && preview.kind === 'transaction';
    async function paste() {
        try { const t = await navigator.clipboard.readText(); if (t) setText(t); } catch { setMsg(tx('Long-press the box and choose Paste.')); }
    }
    async function save() {
        setBusy(true); setMsg('');
        try {
            const r = await processMessage({ text, sender: null, receivedAt: new Date(), ingestion: 'paste' });
            if (r.outcome === 'stored' || r.outcome === 'queued' || r.outcome === 'auto_added' || r.outcome === 'duplicate') { toast.success(tx(r.message || 'Added to Needs Review.')); onSaved(); }
            else setMsg(tx(r.message || 'This doesn\'t look like a bank or wallet transaction.'));
        } catch (e) { setMsg((e as Error).message); }
        finally { setBusy(false); }
    }
    return (
        <div className="at-try">
            <h3><ClipboardPaste size={17} aria-hidden /> {tx('Try it: paste a bank or wallet SMS')}</h3>
            <p className="at-note">{tx('Copy a message from your bank in Messages and paste it here. Zaylo shows what it read before saving anything.')}</p>
            <textarea id="at-try-text" className="form-input" rows={4} dir="auto" value={text} onChange={e => setText(e.target.value)} placeholder={tx('e.g. Purchase of EGP 650 at Carrefour using card **5678')} aria-label={tx('Bank or wallet message')} />
            <div className="at-try-row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={paste}><ClipboardPaste size={14} /> {tx('Paste')}</button>
                {preview && (
                    <span className="at-try-preview" role="status">
                        {readable
                            ? <>{preview.direction === 'credit' ? tx('Money in') : tx('Money out')}: <strong dir="ltr">{formatCurrency(preview.amountMinor! / 100, preview.currency || 'EGP')}</strong>{preview.counterparty ? <> · {preview.counterparty}</> : null}</>
                            : tx('No amount found yet.')}
                    </span>
                )}
            </div>
            {msg && <p className="at-error" role="alert">{msg}</p>}
            <div className="at-setup-actions">
                {onSkip && <button type="button" className="btn btn-ghost" onClick={onSkip}>{tx('Skip for now')}</button>}
                <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !readable}>{busy ? tx('Saving…') : tx('Add it')}</button>
            </div>
        </div>
    );
}

function IosShortcut() {
    const url = 'https://zaylo.cc/autotrack?import=';
    return (
        <div className="at-ios">
            <h3><Apple size={17} aria-hidden /> {tx('On iPhone: one Shortcut does it')}</h3>
            <p className="at-note">{tx('iPhone doesn\'t let apps read messages, but a Shortcut can pass your bank\'s alerts to Zaylo:')}</p>
            <ol className="at-steps">
                <li>{tx('Shortcuts → Automation → + → Message → Sender: your bank → Run Immediately.')}</li>
                <li>{tx('Add "URL Encode" (Shortcut Input → Content), then "Open URLs" with this link followed by the encoded text:')}</li>
            </ol>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success(tx('Link copied')), () => {})}><Copy size={14} /> {tx('Copy link')}</button>
        </div>
    );
}
