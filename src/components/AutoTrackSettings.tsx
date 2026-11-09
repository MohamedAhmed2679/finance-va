/**
 * Settings → AutoTrack. Consent comes first: nothing is requested from the system, and nothing is
 * read, until the person has seen what is accessed, why, where it's processed and what is kept.
 */
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck, Smartphone, Pause, Play, Trash2, Plus, Sparkles, History, Apple } from 'lucide-react';
import { tx } from '../i18n/translations';
import Dialog from './Dialog';
import { CATEGORIES } from '../constants';
import { platform, nativeStatus, deviceState, ZayloSms, type DeviceState, type NativeStatus } from '../autotrack/native';
import { receiverSenders, drainAndroid } from '../autotrack/runner';
import {
    loadSettings, saveSettings, loadAccounts, addAccount, removeAccount, loadRules, removeRule, deleteImported, processMessage,
    DEFAULT_SETTINGS, type AutoTrackSettings as Settings,
} from '../autotrack/service';
import type { OwnAccount } from '../autotrack/classify';
import { knownSenders } from '../autotrack/senders';
import AutoTrackSetup from './AutoTrackSetup';
import { isSetUp } from '../autotrack/setup';
import { useStore } from '../store/useStore';

const STATE_TEXT: Record<DeviceState, [string, string]> = {
    unsupported: ['Not available on this device', 'Automatic tracking needs the Zaylo Android app. Here you can paste messages instead.'],
    off: ['Off', 'Zaylo isn\'t reading any messages on this phone.'],
    enabled: ['On', 'New alerts from banks and wallets are read on this phone.'],
    paused: ['Paused', 'Nothing is read until you resume.'],
    denied: ['Permission denied', 'Android isn\'t letting Zaylo receive SMS. Allow it in Android settings, or keep using Paste.'],
};

export default function AutoTrackSettings({ onOpenAutoTrack }: { onOpenAutoTrack?: () => void }) {
    const plat = platform();
    const [st, setSt] = useState<NativeStatus | null>(null);
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [accounts, setAccounts] = useState<OwnAccount[]>([]);
    const [rules, setRules] = useState<{ id: string; match: string; target?: string; category?: string }[]>([]);
    const [explain, setExplain] = useState<null | 'enable' | 'history' | 'ai'>(null);
    const [addingAccount, setAddingAccount] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [loadErr, setLoadErr] = useState('');
    const state = deviceState(st);
    const userId = useStore(s => s.user?.dbId || s.user?.id);
    const [wizard, setWizard] = useState(() => !isSetUp(userId));

    const refresh = useCallback(async () => {
        setSt(await nativeStatus());
        try {
            const [s, a, r] = await Promise.all([loadSettings(), loadAccounts(), loadRules()]);
            setSettings(s); setAccounts(a); setRules(r); setLoadErr('');
        } catch (e) { setLoadErr(/does not exist|schema cache/i.test((e as Error).message) ? tx('AutoTrack needs the latest database update.') : (e as Error).message); }
    }, []);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server; the flag shows progress
    useEffect(() => { refresh(); }, [refresh]);

    async function enableAndroid() {
        setExplain(null);
        const { permission } = await ZayloSms.requestPermission();
        if (permission !== 'granted') { toast.error(tx('Permission not given. AutoTrack stays off; everything else in Zaylo works as usual.')); await refresh(); return; }
        await ZayloSms.configure({ enabled: true, paused: false, senders: receiverSenders(settings.custom_senders) });
        toast.success(tx('AutoTrack is on for this phone.'));
        await refresh();
    }
    async function setPaused(paused: boolean) { await ZayloSms.configure({ enabled: true, paused, senders: receiverSenders(settings.custom_senders) }); await refresh(); if (!paused) drainAndroid().catch(() => {}); }
    async function turnOff() {
        await ZayloSms.configure({ enabled: false, paused: false, senders: [] });
        toast.success(tx('AutoTrack is off. Messages are no longer read. Records already added stay unless you delete them below.'), { duration: 7000 });
        await refresh();
    }
    async function update(patch: Partial<Settings>) {
        setSettings(s => ({ ...s, ...patch }));
        try { await saveSettings(patch); if (patch.custom_senders && state === 'enabled') await ZayloSms.configure({ enabled: true, paused: false, senders: receiverSenders(patch.custom_senders) }); }
        catch (e) { toast.error((e as Error).message); refresh(); }
    }

    return (
        <div className="card">
            <div className="at-settings-head">
                <ShieldCheck size={20} aria-hidden />
                <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{tx('AutoTrack')}</h3>
                    <p className="at-note" style={{ margin: 0 }}>{tx('Turns bank and wallet SMS alerts into records. Off unless you turn it on.')}</p>
                </div>
                {onOpenAutoTrack && <button className="btn btn-secondary btn-sm" style={{ marginInlineStart: 'auto' }} onClick={onOpenAutoTrack}>{tx('Open AutoTrack')}</button>}
            </div>
            {loadErr && <div className="at-banner" role="alert">{loadErr}</div>}
            {wizard && !loadErr ? <AutoTrackSetup onDone={() => { setWizard(false); refresh(); }} onCancel={() => setWizard(false)} />
                : !loadErr && <button className="btn btn-secondary btn-sm" style={{ marginBottom: 8 }} onClick={() => setWizard(true)}>{tx('Run setup again')}</button>}

            {/* ── this device */}
            <section className="at-section" aria-labelledby="at-device">
                <h4 id="at-device"><Smartphone size={15} aria-hidden /> {tx('This device')}</h4>
                <div className="at-status" data-state={state}><strong>{tx(STATE_TEXT[state][0])}</strong> · {tx(STATE_TEXT[state][1])}</div>
                {plat === 'android' && st && (
                    <div className="at-actions">
                        {state === 'off' && <button className="btn btn-primary btn-sm" onClick={() => setExplain('enable')}>{tx('Turn on AutoTrack')}</button>}
                        {state === 'enabled' && <button className="btn btn-secondary btn-sm" onClick={() => setPaused(true)}><Pause size={14} /> {tx('Pause')}</button>}
                        {state === 'paused' && <button className="btn btn-primary btn-sm" onClick={() => setPaused(false)}><Play size={14} /> {tx('Resume')}</button>}
                        {(state === 'enabled' || state === 'paused' || state === 'denied') && <button className="btn btn-secondary btn-sm" onClick={turnOff}>{tx('Turn off')}</button>}
                        {(state === 'denied' || state === 'enabled') && <button className="btn btn-ghost btn-sm" onClick={() => ZayloSms.openAppSettings()}>{tx('Android permission settings')}</button>}
                        {state === 'enabled' && <button className="btn btn-ghost btn-sm" onClick={() => setExplain('history')}><History size={14} /> {tx('Import past messages…')}</button>}
                    </div>
                )}
                {plat === 'android' && !st && <p className="at-note">{tx('This version of the app can\'t read SMS. Install the latest Zaylo Android build to use automatic tracking.')}</p>}
                {plat === 'ios' && <IosShortcutHelp />}
                {(plat === 'web' || plat === 'desktop') && <p className="at-note">{tx('Browsers and the desktop app can\'t read text messages. Paste a message in AutoTrack, or share it to Zaylo from your Android phone.')}</p>}
                <p className="at-note">{tx('Last processed:')} {settings.last_processed_at ? new Date(settings.last_processed_at).toLocaleString() : tx('never')}{st?.pending ? ` · ${tx('Waiting on this phone:')} ${st.pending}` : ''}</p>
                {settings.last_error && <p className="at-error">{tx(settings.last_error)}</p>}
            </section>

            {/* ── how alerts are added */}
            <section className="at-section" aria-labelledby="at-mode">
                <h4 id="at-mode">{tx('How alerts are added')}</h4>
                <label className={`at-target ${settings.mode === 'review' ? 'on' : ''}`}>
                    <input type="radio" name="at-mode" checked={settings.mode === 'review'} onChange={() => update({ mode: 'review' })} />
                    <span><strong>{tx('Review first')}</strong> ({tx('recommended')})<br /><span className="at-note">{tx('Every alert waits in Needs Review. Nothing changes your totals until you confirm it.')}</span></span>
                </label>
                <label className={`at-target ${settings.mode === 'auto' ? 'on' : ''}`}>
                    <input type="radio" name="at-mode" checked={settings.mode === 'auto'} onChange={() => update({ mode: 'auto' })} />
                    <span><strong>{tx('Auto-add clear transactions')}</strong><br /><span className="at-note">{tx('Only completed transactions from a known bank or wallet, with the amount, currency and accounts read clearly and no possible duplicate. Everything else still goes to Needs Review. Each one is labelled "Added by AutoTrack" and can be undone.')}</span></span>
                </label>
            </section>

            <details className="at-more">
                <summary>{tx('More options')}<span className="at-note">{tx('Accounts, rules, senders, Zaylo AI, delete imported data')}</span></summary>
            {/* ── my accounts */}
            <section className="at-section" aria-labelledby="at-accounts">
                <h4 id="at-accounts">{tx('My accounts and wallets')}</h4>
                <p className="at-note">{tx('Used to recognise transfers between your own accounts, which don\'t count as income or spending. Only the last digits are stored.')}</p>
                {accounts.length === 0 ? <p className="at-note">{tx('None added yet.')}</p> : (
                    <ul className="at-rows">{accounts.map(a => (
                        <li key={a.id}><span>{a.label}{a.last4 ? <span dir="ltr"> ••{a.last4}</span> : ''} <span className="at-note">· {tx(a.kind === 'bank' ? 'Bank account' : a.kind === 'wallet' ? 'Wallet' : a.kind === 'card' ? 'Card' : 'Cash')}</span></span>
                            <button className="btn btn-ghost btn-icon" aria-label={`${tx('Remove')} ${a.label}`} onClick={async () => { await removeAccount(a.id); refresh(); }}><Trash2 size={15} /></button></li>
                    ))}</ul>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => setAddingAccount(true)}><Plus size={14} /> {tx('Add account')}</button>
            </section>

            {/* ── rules */}
            <section className="at-section" aria-labelledby="at-rules">
                <h4 id="at-rules">{tx('Your rules')}</h4>
                <p className="at-note">{tx('Created when you tick "Remember this" while confirming. They apply to new alerts only.')}</p>
                {rules.length === 0 ? <p className="at-note">{tx('No rules yet.')}</p> : (
                    <ul className="at-rows">{rules.map(r => (
                        <li key={r.id}><span><strong dir="auto">{r.match}</strong> → {tx(r.target === 'income' ? 'Income & Earnings' : r.target === 'expense' ? 'Expenses' : r.target === 'transfer' ? 'Transfers' : 'Needs Review')}{r.category ? ` · ${tx(CATEGORIES.find(c => c.key === r.category)?.label ?? r.category)}` : ''}</span>
                            <button className="btn btn-ghost btn-icon" aria-label={`${tx('Remove rule')} ${r.match}`} onClick={async () => { await removeRule(r.id); refresh(); }}><Trash2 size={15} /></button></li>
                    ))}</ul>
                )}
            </section>

            {/* ── senders */}
            <section className="at-section" aria-labelledby="at-senders">
                <h4 id="at-senders">{tx('Senders')}</h4>
                <p className="at-note">{tx('Zaylo reads alerts from these banks and wallets:')} {knownSenders().map(k => k.name).join(', ')}.</p>
                <p className="at-note">{tx('A sender name is not proof a message is genuine; Zaylo can\'t verify that. Alerts from senders you add yourself are never auto-added.')}</p>
                <SenderEditor value={settings.custom_senders} onChange={v => update({ custom_senders: v })} />
            </section>

            {/* ── AI */}
            <section className="at-section" aria-labelledby="at-ai">
                <h4 id="at-ai"><Sparkles size={15} aria-hidden /> {tx('Zaylo AI for unfamiliar messages')}</h4>
                <p className="at-note">{tx('Off by default. When on, an alert whose format Zaylo doesn\'t recognise is sent, with numbers masked, to Zaylo AI (Google Gemini) to read. Codes and personal messages are never sent. Results always wait in Needs Review.')}</p>
                {settings.ai_consent
                    ? <button className="btn btn-secondary btn-sm" onClick={() => update({ ai_consent: false })}>{tx('Turn off AI reading')}</button>
                    : <button className="btn btn-secondary btn-sm" onClick={() => setExplain('ai')}>{tx('Turn on AI reading…')}</button>}
            </section>

            {/* ── delete */}
            <section className="at-section" aria-labelledby="at-del">
                <h4 id="at-del">{tx('Imported data')}</h4>
                <p className="at-note">{tx('Delete what AutoTrack stored (alert details and excerpts). You choose whether the records it added are kept.')}</p>
                <button className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}><Trash2 size={14} /> {tx('Delete imported data…')}</button>
            </section>

            </details>

            {explain === 'enable' && <ExplainDialog kind="enable" onCancel={() => setExplain(null)} onAgree={enableAndroid} />}
            {explain === 'ai' && <ExplainDialog kind="ai" onCancel={() => setExplain(null)} onAgree={async () => { setExplain(null); await update({ ai_consent: true }); }} />}
            {explain === 'history' && <HistoryDialog customSenders={settings.custom_senders} onClose={() => { setExplain(null); refresh(); }} />}
            {addingAccount && <AccountDialog onClose={() => setAddingAccount(false)} onSaved={() => { setAddingAccount(false); refresh(); }} />}
            {deleting && <DeleteDialog onClose={() => setDeleting(false)} />}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────── consent

function ExplainDialog({ kind, onCancel, onAgree }: { kind: 'enable' | 'ai'; onCancel: () => void; onAgree: () => void }) {
    const rows: [string, string][] = kind === 'enable' ? [
        ['What Zaylo accesses', 'New text messages as they arrive on this phone. Only messages from banks and wallets are kept for processing; everything else is dropped on the phone straight away. Your past messages are not read unless you separately choose to import them.'],
        ['Why', 'To add your purchases, income and transfers without typing them.'],
        ['Where it\'s processed', 'On this phone. Zaylo AI is not used unless you turn that on separately.'],
        ['What is kept', 'The transaction details (amount, currency, merchant, last digits of the account, time) and a short masked excerpt, stored in your Zaylo account. Never whole messages, never security codes.'],
        ['Your control', 'Review first is the default. Pause or turn off any time; turning off stops all reading. Records already added stay unless you delete them.'],
    ] : [
        ['What is sent', 'Only bank or wallet alerts Zaylo can\'t read itself, with phone, card and reference numbers masked. Never security codes or personal messages.'],
        ['Who processes it', 'Zaylo AI, which uses Google Gemini. The message is used to read this one transaction.'],
        ['What happens next', 'Whatever the AI reads always goes to Needs Review for you to check. It is never added automatically.'],
    ];
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
            <Dialog labelledBy="at-explain" onClose={onCancel} style={{ maxWidth: 500 }}>
                <div className="modal-header"><h2 className="modal-title" id="at-explain">{kind === 'enable' ? tx('Before you turn on AutoTrack') : tx('Use Zaylo AI for unfamiliar messages?')}</h2></div>
                <dl className="at-explain">{rows.map(([k, v]) => <div key={k}><dt>{tx(k)}</dt><dd>{tx(v)}</dd></div>)}</dl>
                {kind === 'enable' && <p className="at-note">{tx('Next, Android asks whether Zaylo may receive SMS. You can say no and keep using everything else in Zaylo.')}</p>}
                <div className="at-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onCancel} data-autofocus>{tx('Not now')}</button>
                    <button className="btn btn-primary" onClick={onAgree}>{kind === 'enable' ? tx('Continue') : tx('Turn on')}</button>
                </div>
            </Dialog>
        </div>
    );
}

function HistoryDialog({ customSenders, onClose }: { customSenders: string[]; onClose: () => void }) {
    const today = new Date().toISOString().slice(0, 10);
    const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
    const [to, setTo] = useState(today);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState('');
    async function run() {
        if (from > to) { setDone(tx('The start date is after the end date.')); return; }
        setBusy(true); setDone('');
        try {
            const { permission } = await ZayloSms.requestHistoryPermission();
            if (permission !== 'granted') { setDone(tx('Permission not given, so nothing was imported.')); return; }
            const { messages } = await ZayloSms.scanHistory({ from: new Date(`${from}T00:00:00`).getTime(), to: new Date(`${to}T23:59:59`).getTime(), senders: receiverSenders(customSenders) });
            let review = 0, dupes = 0;
            for (const m of messages) {
                const r = await processMessage({ text: m.body, sender: m.sender, receivedAt: new Date(m.receivedAt), ingestion: 'history' }, { allowAuto: false });
                if (r.outcome === 'stored' || r.outcome === 'queued') review++; else if (r.outcome === 'duplicate') dupes++;
            }
            setDone(`${tx('Done.')} ${messages.length} ${tx('bank or wallet messages checked')}, ${review} ${tx('added to Needs Review')}, ${dupes} ${tx('already recorded')}.`);
        } catch (e) { setDone((e as Error).message); }
        finally { setBusy(false); }
    }
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <Dialog labelledBy="at-hist" onClose={() => { if (!busy) onClose(); }} style={{ maxWidth: 460 }}>
                <div className="modal-header"><h2 className="modal-title" id="at-hist">{tx('Import past messages')}</h2></div>
                <p className="at-note">{tx('This reads messages already on this phone, but only from banks and wallets and only between the dates you choose. Android will ask for a separate permission to read past messages. Everything imported goes to Needs Review; nothing is added automatically.')}</p>
                <div className="at-grid">
                    <div className="form-group"><label className="form-label" htmlFor="h-from">{tx('From')}</label><input id="h-from" type="date" className="form-input" max={to} value={from} onChange={e => setFrom(e.target.value)} data-autofocus /></div>
                    <div className="form-group"><label className="form-label" htmlFor="h-to">{tx('To')}</label><input id="h-to" type="date" className="form-input" max={today} value={to} onChange={e => setTo(e.target.value)} /></div>
                </div>
                {done && <p className="at-reason" role="status">{done}</p>}
                <div className="at-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose} disabled={busy}>{tx('Close')}</button>
                    <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? tx('Importing…') : tx('I agree, import')}</button>
                </div>
            </Dialog>
        </div>
    );
}

function AccountDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [label, setLabel] = useState('');
    const [kind, setKind] = useState<OwnAccount['kind']>('bank');
    const [last4, setLast4] = useState('');
    const [provider, setProvider] = useState('');
    const [err, setErr] = useState('');
    async function save() {
        if (!label.trim()) { setErr(tx('Give it a name, e.g. CIB current account.')); return; }
        if (last4 && !/^\d{3,4}$/.test(last4)) { setErr(tx('Enter only the last 3 or 4 digits.')); return; }
        try { await addAccount({ label, kind, last4: last4 || undefined, providerId: provider || undefined }); onSaved(); }
        catch (e) { setErr((e as Error).message); }
    }
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <Dialog labelledBy="at-acc" onClose={onClose} style={{ maxWidth: 420 }}>
                <div className="modal-header"><h2 className="modal-title" id="at-acc">{tx('Add account')}</h2></div>
                <div className="form-group"><label className="form-label" htmlFor="acc-name">{tx('Name')}</label><input id="acc-name" className="form-input" value={label} onChange={e => setLabel(e.target.value)} data-autofocus /></div>
                <div className="at-grid">
                    <div className="form-group"><label className="form-label" htmlFor="acc-kind">{tx('Type')}</label>
                        <select id="acc-kind" className="form-input" value={kind} onChange={e => setKind(e.target.value as OwnAccount['kind'])}>
                            <option value="bank">{tx('Bank account')}</option><option value="card">{tx('Card')}</option><option value="wallet">{tx('Wallet')}</option><option value="cash">{tx('Cash')}</option>
                        </select></div>
                    {kind !== 'cash' && <div className="form-group"><label className="form-label" htmlFor="acc-last4">{tx('Last digits')}</label><input id="acc-last4" className="form-input" dir="ltr" inputMode="numeric" maxLength={4} value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, ''))} /></div>}
                </div>
                {kind !== 'cash' && <div className="form-group"><label className="form-label" htmlFor="acc-prov">{tx('Bank or wallet')}</label>
                    <select id="acc-prov" className="form-input" value={provider} onChange={e => setProvider(e.target.value)}><option value="">{tx('Not set')}</option>{knownSenders().map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></div>}
                {err && <p role="alert" className="at-error">{err}</p>}
                <div className="at-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>{tx('Cancel')}</button>
                    <button className="btn btn-primary" onClick={save}>{tx('Save')}</button>
                </div>
            </Dialog>
        </div>
    );
}

function DeleteDialog({ onClose }: { onClose: () => void }) {
    const [alsoRecords, setAlsoRecords] = useState(false);
    const [busy, setBusy] = useState(false);
    async function go() {
        setBusy(true);
        try {
            const r = await deleteImported(alsoRecords);
            toast.success(`${tx('Deleted')} ${r.items} ${tx('imported alerts')}${alsoRecords ? `, ${r.recordsRemoved} ${tx('records removed')}` : ''}.`);
            onClose();
        } catch (e) { toast.error((e as Error).message); setBusy(false); }
    }
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <Dialog labelledBy="at-del-t" onClose={() => { if (!busy) onClose(); }} style={{ maxWidth: 460 }}>
                <div className="modal-header"><h2 className="modal-title" id="at-del-t">{tx('Delete imported data?')}</h2></div>
                <p className="at-note">{tx('All AutoTrack alerts, excerpts and review history are deleted. This can\'t be undone.')}</p>
                <label className="at-check"><input type="checkbox" checked={alsoRecords} onChange={e => setAlsoRecords(e.target.checked)} /> {tx('Also remove the expenses, income and transfers AutoTrack added')}</label>
                <p className="at-note">{alsoRecords ? tx('Those records leave your totals. Records you linked an alert to (ones you created yourself) are kept.') : tx('The records AutoTrack added stay as ordinary entries in your totals.')}</p>
                <div className="at-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose} disabled={busy} data-autofocus>{tx('Cancel')}</button>
                    <button className="btn btn-danger" onClick={go} disabled={busy}>{busy ? tx('Deleting…') : tx('Delete')}</button>
                </div>
            </Dialog>
        </div>
    );
}

function SenderEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
    const [v, setV] = useState('');
    const add = () => { const s = v.trim(); if (s.length >= 2 && !value.includes(s)) onChange([...value, s].slice(0, 20)); setV(''); };
    return (
        <div>
            {value.length > 0 && <ul className="at-rows">{value.map(s => <li key={s}><span dir="ltr">{s}</span><button className="btn btn-ghost btn-icon" aria-label={`${tx('Remove')} ${s}`} onClick={() => onChange(value.filter(x => x !== s))}><Trash2 size={15} /></button></li>)}</ul>}
            <div style={{ display: 'flex', gap: 8 }}>
                <label className="sr-only" htmlFor="at-sender-add">{tx('Add a sender name')}</label>
                <input id="at-sender-add" className="form-input" dir="ltr" placeholder={tx('Sender name as shown in Messages')} value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
                <button className="btn btn-secondary btn-sm" onClick={add} disabled={v.trim().length < 2}>{tx('Add')}</button>
            </div>
        </div>
    );
}

function IosShortcutHelp() {
    const url = 'com.financeva.app://autotrack?import=';
    return (
        <div className="at-ios">
            <p className="at-note"><Apple size={14} aria-hidden /> {tx('iPhone doesn\'t let any app read your messages. You can set up a Shortcut that sends a bank alert to Zaylo for you:')}</p>
            <ol className="at-steps">
                <li>{tx('Open Shortcuts → Automation → New Automation → Message.')}</li>
                <li>{tx('Choose "Sender" (your bank or wallet, e.g. CIB) and set it to Run Immediately.')}</li>
                <li>{tx('Add the action "URL Encode" with Shortcut Input → Content, then "Open URLs" with:')} <code dir="ltr">{url}</code> {tx('followed by the encoded text.')}</li>
            </ol>
            <p className="at-note">{tx('Without the app, use https://zaylo.cc/autotrack?import= instead.')}</p>
            <p className="at-note">{tx('Zaylo opens with the message ready; you tap Read message. These always go to Needs Review. You can also copy any message and use Paste in AutoTrack.')}</p>
        </div>
    );
}
