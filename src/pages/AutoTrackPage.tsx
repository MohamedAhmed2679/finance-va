/**
 * AutoTrack: bank and wallet alerts turned into records, with the user in control.
 * Needs Review · Added · Ignored · Transfers, plus Paste Message.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ClipboardPaste, RotateCcw, Link2, Check, EyeOff, Settings2, Repeat } from 'lucide-react';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import { CATEGORIES, formatCurrency } from '../constants';
import Dialog from '../components/Dialog';
import { takePendingImport } from '../autotrack/useAutoTrackDevice';
import AutoTrackSetup from '../components/AutoTrackSetup';
import { isSetUp } from '../autotrack/setup';
import {
    loadItems, loadAccounts, loadTransfers, confirmItem, ignoreItem, undoItem, restoreItem, linkItem, saveRule, processMessage, flushOutbox, pendingCount,
    addTransfer, deleteTransfer, type AutoTrackItem, type Transfer,
} from '../autotrack/service';
import type { OwnAccount } from '../autotrack/classify';

type Tab = 'review' | 'added' | 'ignored' | 'transfers';
type Target = 'income' | 'expense' | 'transfer';
const TARGET_LABEL: Record<string, string> = { income: 'Income & Earnings', expense: 'Expenses', transfer: 'Transfers', review: 'Needs a decision', ignore: 'Not recorded' };

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function AutoTrackPage({ onOpenSettings }: { onOpenSettings?: () => void }) {
    const { activeWorkspaceId, expenses, incomes, loadWorkspaceData, user } = useStore();
    const [setup, setSetup] = useState(() => !isSetUp(user?.dbId || user?.id));
    const loadData = () => { if (activeWorkspaceId) loadWorkspaceData(activeWorkspaceId).catch(() => {}); };
    const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('tab') as Tab) || 'review');
    const [items, setItems] = useState<AutoTrackItem[] | null>(null);
    const [accounts, setAccounts] = useState<OwnAccount[]>([]);
    const [transfers, setTransfers] = useState<Transfer[]>([]);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState<AutoTrackItem | null>(null);
    const [linking, setLinking] = useState<AutoTrackItem | null>(null);
    const [pasting, setPasting] = useState<string | null>(null);
    const [addingTransfer, setAddingTransfer] = useState(false);
    const [busyId, setBusyId] = useState('');

    const refresh = useCallback(async () => {
        try {
            await flushOutbox().catch(() => 0);
            const [it, acc, tr] = await Promise.all([loadItems(), loadAccounts(), activeWorkspaceId ? loadTransfers(activeWorkspaceId) : Promise.resolve([])]);
            setItems(it); setAccounts(acc); setTransfers(tr); setError('');
        } catch (e) {
            setItems(i => i ?? []);
            setError(/relation .*autotrack|does not exist|schema cache/i.test((e as Error).message) ? tx('AutoTrack needs the latest database update before it can be used.') : (e as Error).message);
        }
    }, [activeWorkspaceId]);
    useEffect(() => { refresh(); }, [refresh]);

    // An import link (iPhone Shortcut) or a shared message opens Paste with the text filled in
    useEffect(() => {
        const q = new URLSearchParams(location.search);
        const text = q.get('import') ?? takePendingImport();
        if (text) { setPasting(text); q.delete('import'); history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`); }
        const onShared = (e: Event) => setPasting((e as CustomEvent<string>).detail);
        window.addEventListener('zaylo:autotrack-import', onShared);
        return () => window.removeEventListener('zaylo:autotrack-import', onShared);
    }, []);

    const groups = useMemo(() => {
        const l = items ?? [];
        return {
            review: l.filter(i => i.status === 'needs_review' || i.status === 'failed'),
            added: l.filter(i => i.status === 'auto_added' || i.status === 'confirmed' || i.status === 'linked'),
            ignored: l.filter(i => i.status === 'ignored' || i.status === 'undone'),
        };
    }, [items]);

    async function act(id: string, fn: () => Promise<unknown>, ok: string) {
        setBusyId(id);
        try { await fn(); toast.success(tx(ok), { id: `at-${id}` }); await refresh(); loadData(); }
        catch (e) { toast.error((e as Error).message, { id: `at-${id}` }); }
        finally { setBusyId(''); }
    }
    const undo = (it: AutoTrackItem) => act(it.id, () => undoItem(it.id), 'Undone. It no longer counts in your totals.');

    const list = tab === 'transfers' ? null : groups[tab];
    const pending = pendingCount();

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{tx('AutoTrack')}</h1>
                    <p className="page-subtitle">{tx('Bank and wallet alerts turned into records. Nothing counts in your totals until it\'s confirmed or auto-added.')}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => setPasting('')}><ClipboardPaste size={15} />{' '}{tx('Paste message')}</button>
                    {!setup && !isSetUp(user?.dbId || user?.id) && <button className="btn btn-secondary btn-sm" onClick={() => setSetup(true)}>{tx('Set up')}</button>}
                    {onOpenSettings && <button className="btn btn-secondary btn-sm" onClick={onOpenSettings}><Settings2 size={15} />{' '}{tx('Settings')}</button>}
                </div>
            </div>

            {error && <div className="at-banner" role="alert">{error}</div>}
            {setup && !error && <AutoTrackSetup onDone={() => { setSetup(false); refresh(); loadData(); }} onCancel={() => setSetup(false)} />}
            {pending > 0 && <div className="at-banner">{tx('Waiting to sync:')} {pending}</div>}

            <div className="segmented mb-4" role="tablist" aria-label={tx('AutoTrack views')}>
                {([['review', 'Needs Review', groups.review.length], ['added', 'Added', groups.added.length], ['ignored', 'Ignored', groups.ignored.length], ['transfers', 'Transfers', transfers.length]] as const).map(([k, label, n]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>
                        {tx(label)}{n > 0 && <span className="at-count">{n}</span>}
                    </button>
                ))}
            </div>

            {items === null ? <div className="card at-empty">{tx('Loading…')}</div>
                : tab === 'transfers' ? (
                    <TransfersView transfers={transfers} onAdd={() => setAddingTransfer(true)} onDelete={id => act(id, () => deleteTransfer(id), 'Transfer removed.')} />
                ) : list!.length === 0 ? (
                    <div className="card at-empty">
                        {tab === 'review' ? tx('Nothing waiting. New bank or wallet alerts that need a decision appear here.')
                            : tab === 'added' ? tx('Nothing added by AutoTrack yet.') : tx('Nothing ignored.')}
                    </div>
                ) : (
                    <ul className="at-list">
                        {list!.map(it => (
                            <ItemCard key={it.id} it={it} busy={busyId === it.id}
                                onConfirm={() => setEditing(it)}
                                onIgnore={() => act(it.id, () => ignoreItem(it.id), 'Ignored. It won\'t be added.')}
                                onLink={() => setLinking(it)}
                                onUndo={() => undo(it)}
                                onRestore={() => act(it.id, () => restoreItem(it.id), 'Moved back to Needs Review.')} />
                        ))}
                    </ul>
                )}

            {editing && <ConfirmSheet it={editing} accounts={accounts} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await refresh(); loadData(); }} />}
            {linking && <LinkSheet it={linking} expenses={expenses.filter(e => !e.deleted && e.workspaceId === activeWorkspaceId)} incomes={incomes.filter(i => i.workspaceId === activeWorkspaceId)} transfers={transfers}
                onClose={() => setLinking(null)} onLink={(kind, id) => act(linking.id, async () => { await linkItem(linking.id, kind, id); setLinking(null); }, 'Linked. No new record was added.')} />}
            {pasting !== null && <PasteSheet initial={pasting} fromLink={Boolean(pasting)} onClose={() => setPasting(null)} onDone={async () => { setPasting(null); setTab('review'); await refresh(); loadData(); }} />}
            {addingTransfer && <TransferSheet accounts={accounts} onClose={() => setAddingTransfer(false)} onSave={async t => { await addTransfer(activeWorkspaceId, t); setAddingTransfer(false); toast.success(tx('Transfer added.')); refresh(); }} />}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────── item card

function ItemCard({ it, busy, onConfirm, onIgnore, onLink, onUndo, onRestore }: {
    it: AutoTrackItem; busy: boolean; onConfirm: () => void; onIgnore: () => void; onLink: () => void; onUndo: () => void; onRestore: () => void;
}) {
    const [showExcerpt, setShowExcerpt] = useState(false);
    const Icon = it.suggested_target === 'transfer' || it.final_target === 'transfer' ? ArrowLeftRight : it.direction === 'credit' ? ArrowDownLeft : ArrowUpRight;
    const amount = it.amount !== null && it.currency ? formatCurrency(it.amount, it.currency) : tx('Amount unclear');
    const target = it.final_target ?? it.suggested_target;
    return (
        <li className="card at-item">
            <div className="at-item-top">
                <span className={`at-icon at-${it.direction}`} aria-hidden><Icon size={18} /></span>
                <div className="at-main">
                    <div className="at-title">{it.counterparty || it.provider_name || tx('Unknown sender')}</div>
                    <div className="at-meta">
                        {[it.provider_name, it.account_ref ? `••${it.account_ref}` : null, fmtTime(it.occurred_at)].filter(Boolean).join(' · ')}
                        {!it.occurred_at_from_text && <span title={tx('The message had no date, so the time it arrived is used.')}> ({tx('arrival time')})</span>}
                    </div>
                </div>
                <div className={`at-amount ${it.direction === 'credit' ? 'in' : ''}`} dir="ltr">{it.direction === 'credit' ? '+' : it.direction === 'debit' ? '−' : ''}{amount}</div>
            </div>

            <div className="at-tags">
                {it.status === 'auto_added' && <span className="badge badge-primary">{tx('Added by AutoTrack')}</span>}
                {it.status === 'confirmed' && <span className="badge badge-success">{tx('Confirmed')}</span>}
                {it.status === 'linked' && <span className="badge badge-success">{tx('Linked to an existing record')}</span>}
                {it.status === 'undone' && <span className="badge">{tx('Undone')}</span>}
                {it.status === 'failed' && <span className="badge badge-danger">{tx('Couldn\'t be saved; try again')}</span>}
                <span className="badge">{tx(TARGET_LABEL[target] ?? target)}</span>
                {it.tx_status !== 'completed' && <span className="badge badge-warning">{tx(it.tx_status === 'pending' ? 'Pending' : it.tx_status === 'declined' ? 'Declined' : 'Reversed')}</span>}
                {it.fee !== null && it.currency && <span className="badge">{tx('Fee')} {formatCurrency(it.fee, it.currency)}</span>}
                {it.ai_used && <span className="badge badge-warning">{tx('Read by Zaylo AI')}</span>}
            </div>

            <p className="at-reason">{tx(it.reason)}</p>
            {it.issues.length > 0 && <ul className="at-issues">{it.issues.map(i => <li key={i}>{tx(i)}</li>)}</ul>}
            {it.balance_after !== null && it.currency && <p className="at-note">{tx('Balance printed in the message:')} {formatCurrency(it.balance_after, it.currency)} {tx('(not a live balance)')}</p>}

            {it.excerpt && (
                <button type="button" className="at-excerpt-toggle" aria-expanded={showExcerpt} onClick={() => setShowExcerpt(v => !v)}>
                    {showExcerpt ? tx('Hide message excerpt') : tx('Show message excerpt')}
                </button>
            )}
            {showExcerpt && <blockquote className="at-excerpt" dir="auto">{it.excerpt}</blockquote>}

            <div className="at-actions">
                {(it.status === 'needs_review' || it.status === 'failed') && <>
                    <button className="btn btn-primary btn-sm" disabled={busy || it.amount === null} onClick={onConfirm}><Check size={14} />{' '}{tx('Review & confirm')}</button>
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onLink}><Link2 size={14} />{' '}{it.duplicate_of_id ? tx('Link to the match') : tx('Link to existing')}</button>
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onIgnore}><EyeOff size={14} />{' '}{tx('Ignore')}</button>
                </>}
                {(it.status === 'auto_added' || it.status === 'confirmed' || it.status === 'linked') &&
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onUndo}><RotateCcw size={14} />{' '}{tx('Undo')}</button>}
                {(it.status === 'ignored' || it.status === 'undone') &&
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onRestore}><Repeat size={14} />{' '}{tx('Review again')}</button>}
            </div>
        </li>
    );
}

// ─────────────────────────────────────────────────────────────── confirm (with corrections)

function ConfirmSheet({ it, accounts, onClose, onDone }: { it: AutoTrackItem; accounts: OwnAccount[]; onClose: () => void; onDone: () => void }) {
    const suggested: Target = it.suggested_target === 'income' || it.suggested_target === 'expense' || it.suggested_target === 'transfer' ? it.suggested_target : it.direction === 'credit' ? 'income' : 'expense';
    const [target, setTarget] = useState<Target>(suggested);
    const [amount, setAmount] = useState(it.amount !== null ? String(it.amount) : '');
    const [currency, setCurrency] = useState(it.currency ?? 'EGP');
    const [when, setWhen] = useState(() => toLocalInput(it.occurred_at ?? it.received_at));
    const [category, setCategory] = useState(it.category ?? 'other');
    const [title, setTitle] = useState(it.counterparty ?? '');
    const [from, setFrom] = useState(it.from_account_id ?? '');
    const [to, setTo] = useState(it.to_account_id ?? '');
    const [remember, setRemember] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    async function save() {
        const n = Number(amount.replace(/,/g, ''));
        if (!(n > 0) || !/^\d+(\.\d{1,2})?$/.test(amount.replace(/,/g, ''))) { setErr(tx('Enter the amount, e.g. 650 or 650.50.')); return; }
        if (!/^[A-Za-z]{3}$/.test(currency)) { setErr(tx('Enter a 3-letter currency, e.g. EGP.')); return; }
        setBusy(true); setErr('');
        try {
            await confirmItem(it.id, target, {
                amount: n, currency: currency.toUpperCase(), occurredAt: new Date(when).toISOString(),
                category: target === 'expense' ? category : undefined, title: title.trim() || undefined,
                from: target === 'transfer' ? from || null : null, to: target === 'transfer' ? to || null : null,
            });
            if (remember && it.counterparty) await saveRule({ match: it.counterparty, target, category: target === 'expense' ? category as never : undefined }).catch(() => {});
            toast.success(tx(`Added to ${TARGET_LABEL[target]}.`));
            onDone();
        } catch (e) { setErr((e as Error).message); setBusy(false); }
    }

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <Dialog labelledBy="at-confirm-title" onClose={() => { if (!busy) onClose(); }} style={{ maxWidth: 480 }}>
                <div className="modal-header"><h2 className="modal-title" id="at-confirm-title">{tx('Confirm transaction')}</h2></div>
                <p className="at-reason" style={{ marginTop: 0 }}>{tx(it.reason)}</p>
                <fieldset className="form-group at-targets">
                    <legend className="form-label">{tx('Record it as')}</legend>
                    {(['expense', 'income', 'transfer'] as Target[]).map(t => (
                        <label key={t} className={`at-target ${target === t ? 'on' : ''}`}>
                            <input type="radio" name="at-target" value={t} checked={target === t} onChange={() => setTarget(t)} data-autofocus={target === t ? '' : undefined} />
                            <span>{tx(TARGET_LABEL[t])}</span>
                        </label>
                    ))}
                </fieldset>
                {target === 'income' && it.direction === 'credit' && it.suggested_target === 'review' && <p className="at-note">{tx('Only choose Income if this is money you earned. Repayments, gifts and refunds are not earnings.')}</p>}
                <div className="at-grid">
                    <div className="form-group"><label className="form-label" htmlFor="at-amount">{tx('Amount')}</label><input id="at-amount" className="form-input" inputMode="decimal" dir="ltr" value={amount} onChange={e => setAmount(e.target.value)} /></div>
                    <div className="form-group"><label className="form-label" htmlFor="at-cur">{tx('Currency')}</label><input id="at-cur" className="form-input" dir="ltr" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} /></div>
                </div>
                <div className="form-group"><label className="form-label" htmlFor="at-when">{tx('Date and time')}</label><input id="at-when" type="datetime-local" className="form-input" value={when} onChange={e => setWhen(e.target.value)} /></div>
                <div className="form-group"><label className="form-label" htmlFor="at-title">{target === 'income' ? tx('Name') : target === 'transfer' ? tx('Note') : tx('Merchant')}</label><input id="at-title" className="form-input" value={title} onChange={e => setTitle(e.target.value)} /></div>
                {target === 'expense' && (
                    <div className="form-group"><label className="form-label" htmlFor="at-cat">{tx('Category')}</label>
                        <select id="at-cat" className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
                            {CATEGORIES.filter(c => c.key !== 'income').map(c => <option key={c.key} value={c.key}>{c.emoji} {tx(c.label)}</option>)}
                        </select></div>
                )}
                {target === 'transfer' && (
                    <div className="at-grid">
                        <div className="form-group"><label className="form-label" htmlFor="at-from">{tx('From')}</label>
                            <select id="at-from" className="form-input" value={from} onChange={e => setFrom(e.target.value)}><option value="">{tx('Not set')}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}{a.last4 ? ` ••${a.last4}` : ''}</option>)}</select></div>
                        <div className="form-group"><label className="form-label" htmlFor="at-to">{tx('To')}</label>
                            <select id="at-to" className="form-input" value={to} onChange={e => setTo(e.target.value)}><option value="">{tx('Not set')}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}{a.last4 ? ` ••${a.last4}` : ''}</option>)}</select></div>
                    </div>
                )}
                {target === 'transfer' && accounts.length === 0 && <p className="at-note">{tx('Add your accounts in AutoTrack settings so transfers can show where money moved.')}</p>}
                {it.fee !== null && it.currency && (target === 'expense' || target === 'transfer') && <p className="at-note">{tx('The fee stated in the message is added as its own expense:')} {formatCurrency(it.fee, it.currency)}</p>}
                {it.counterparty && (
                    <label className="at-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> {tx('Remember this for')} “{it.counterparty}” <span className="at-note">({tx('applies to new alerts only; you can remove it in settings')})</span></label>
                )}
                {err && <p role="alert" className="at-error">{err}</p>}
                <div className="at-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose} disabled={busy}>{tx('Cancel')}</button>
                    <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? tx('Saving…') : tx('Confirm')}</button>
                </div>
            </Dialog>
        </div>
    );
}
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// ─────────────────────────────────────────────────────────────── link to an existing record

function LinkSheet({ it, expenses, incomes, transfers, onClose, onLink }: {
    it: AutoTrackItem; expenses: { id: string; amount: number; currency: string; merchant: string; purchaseAt: string; source?: string }[];
    incomes: { id: string; amount: number; currency: string; name: string; date: string }[]; transfers: Transfer[];
    onClose: () => void; onLink: (kind: Target, id: string) => void;
}) {
    const at = new Date(it.occurred_at ?? it.received_at).getTime();
    const near = (iso: string) => Math.abs(new Date(iso).getTime() - at) < 10 * 86_400_000;
    const same = (a: number, c: string) => it.amount === null || (Math.abs(a - it.amount) < 0.005 && c === it.currency);
    const options = [
        ...(it.direction !== 'credit' || it.channel === 'refund' ? expenses.filter(e => near(e.purchaseAt) && (same(e.amount, e.currency) || it.channel === 'refund')).map(e => ({ kind: 'expense' as Target, id: e.id, label: e.merchant, sub: `${tx('Expense')}${e.source === 'smart_cart' ? ' · Smart Cart' : ''} · ${fmtTime(e.purchaseAt)}`, amount: formatCurrency(e.amount, e.currency) })) : []),
        ...(it.direction !== 'debit' ? incomes.filter(i => near(i.date) && same(i.amount, i.currency)).map(i => ({ kind: 'income' as Target, id: i.id, label: i.name, sub: `${tx('Income')} · ${fmtTime(i.date)}`, amount: formatCurrency(i.amount, i.currency) })) : []),
        ...transfers.filter(t => near(t.occurred_at) && same(t.amount, t.currency)).map(t => ({ kind: 'transfer' as Target, id: t.id, label: `${t.from_label ?? '?'} → ${t.to_label ?? '?'}`, sub: `${tx('Transfer')} · ${fmtTime(t.occurred_at)}`, amount: formatCurrency(t.amount, t.currency) })),
    ].sort((a, b) => (a.id === it.duplicate_of_id ? -1 : b.id === it.duplicate_of_id ? 1 : 0));
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <Dialog labelledBy="at-link-title" onClose={onClose} style={{ maxWidth: 480 }}>
                <div className="modal-header"><h2 className="modal-title" id="at-link-title">{tx('Link to an existing record')}</h2></div>
                <p className="at-note">{it.channel === 'refund' ? tx('Pick the purchase this refund belongs to. Nothing new is added to your totals.') : tx('Pick the record this alert is about. Nothing new is added to your totals.')}</p>
                {options.length === 0 ? <p className="at-empty">{tx('No records with this amount around this date.')}</p> : (
                    <ul className="at-list">
                        {options.map(o => (
                            <li key={o.id}>
                                <button className="at-link-option" onClick={() => onLink(o.kind, o.id)} data-autofocus={o.id === options[0].id ? '' : undefined}>
                                    <span><strong>{o.label}</strong>{o.id === it.duplicate_of_id && <span className="badge badge-primary" style={{ marginInlineStart: 6 }}>{tx('Likely match')}</span>}<br /><span className="at-meta">{o.sub}</span></span>
                                    <span dir="ltr">{o.amount}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="at-actions" style={{ justifyContent: 'flex-end' }}><button className="btn btn-secondary" onClick={onClose}>{tx('Cancel')}</button></div>
            </Dialog>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────── paste

function PasteSheet({ initial, fromLink, onClose, onDone }: { initial: string; fromLink: boolean; onClose: () => void; onDone: () => void }) {
    const [text, setText] = useState(initial);
    const [sender, setSender] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState('');
    async function go() {
        if (!text.trim()) return;
        setBusy(true); setResult('');
        try {
            const r = await processMessage({ text, sender: sender.trim() || null, ingestion: fromLink ? 'ios_shortcut' : 'paste' }, { allowAuto: !fromLink });
            if (r.outcome === 'stored' || r.outcome === 'auto_added' || r.outcome === 'queued') { toast.success(tx(r.message)); onDone(); return; }
            setResult(tx(r.message));
        } catch (e) { setResult((e as Error).message); }
        finally { setBusy(false); }
    }
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <Dialog labelledBy="at-paste-title" onClose={() => { if (!busy) onClose(); }} style={{ maxWidth: 480 }}>
                <div className="modal-header"><h2 className="modal-title" id="at-paste-title">{fromLink ? tx('Add this message?') : tx('Paste a bank or wallet message')}</h2></div>
                <p className="at-note">{tx('Read on this device. Only the transaction details and a short masked excerpt are saved, never the whole message. Security codes are never kept.')}</p>
                {fromLink && <p className="at-note">{tx('Messages opened from a link always go to Needs Review.')}</p>}
                <div className="form-group"><label className="form-label" htmlFor="at-text">{tx('Message')}</label>
                    <textarea id="at-text" className="form-input" rows={5} dir="auto" value={text} onChange={e => setText(e.target.value)} data-autofocus /></div>
                <div className="form-group"><label className="form-label" htmlFor="at-sender">{tx('Sender (optional)')}</label>
                    <input id="at-sender" className="form-input" dir="ltr" placeholder="CIB, NBE, InstaPay…" value={sender} onChange={e => setSender(e.target.value)} />
                    <span className="at-note">{tx('Knowing the bank helps Zaylo read the message; it isn\'t treated as proof the message is genuine.')}</span></div>
                {result && <p className="at-reason" role="status">{result}</p>}
                <div className="at-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose} disabled={busy}>{tx('Cancel')}</button>
                    <button className="btn btn-primary" onClick={go} disabled={busy || !text.trim()}>{busy ? tx('Reading…') : tx('Read message')}</button>
                </div>
            </Dialog>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────── transfers

function TransfersView({ transfers, onAdd, onDelete }: { transfers: Transfer[]; onAdd: () => void; onDelete: (id: string) => void }) {
    return (
        <div>
            <div className="at-banner">{tx('Transfers move money between your own accounts. They don\'t count as income or spending.')}</div>
            <div style={{ marginBottom: 12 }}><button className="btn btn-secondary btn-sm" onClick={onAdd}><ArrowLeftRight size={14} />{' '}{tx('Add transfer')}</button></div>
            {transfers.length === 0 ? <div className="card at-empty">{tx('No transfers yet.')}</div> : (
                <ul className="at-list">
                    {transfers.map(t => (
                        <li key={t.id} className="card at-item">
                            <div className="at-item-top">
                                <span className="at-icon" aria-hidden><ArrowLeftRight size={18} /></span>
                                <div className="at-main"><div className="at-title">{t.from_label ?? tx('Not set')} → {t.to_label ?? tx('Not set')}</div><div className="at-meta">{fmtTime(t.occurred_at)}{t.source === 'autotrack' ? ` · ${tx('Added by AutoTrack')}` : ''}</div></div>
                                <div className="at-amount" dir="ltr">{formatCurrency(t.amount, t.currency)}</div>
                            </div>
                            {t.source === 'manual' && <div className="at-actions"><button className="btn btn-secondary btn-sm" onClick={() => onDelete(t.id)}>{tx('Remove')}</button></div>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function TransferSheet({ accounts, onClose, onSave }: { accounts: OwnAccount[]; onClose: () => void; onSave: (t: { amount: number; currency: string; from?: OwnAccount; to?: OwnAccount; occurredAt: string; note?: string }) => Promise<void> }) {
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('EGP');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [when, setWhen] = useState(() => toLocalInput(new Date().toISOString()));
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    async function save() {
        const n = Number(amount.replace(/,/g, ''));
        if (!(n > 0)) { setErr(tx('Enter the amount.')); return; }
        if (from && from === to) { setErr(tx('Choose two different accounts.')); return; }
        setBusy(true);
        try { await onSave({ amount: n, currency, from: accounts.find(a => a.id === from), to: accounts.find(a => a.id === to), occurredAt: new Date(when).toISOString() }); }
        catch (e) { setErr((e as Error).message); setBusy(false); }
    }
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <Dialog labelledBy="at-tr-title" onClose={onClose} style={{ maxWidth: 440 }}>
                <div className="modal-header"><h2 className="modal-title" id="at-tr-title">{tx('Add transfer')}</h2></div>
                <div className="at-grid">
                    <div className="form-group"><label className="form-label" htmlFor="tr-amount">{tx('Amount')}</label><input id="tr-amount" className="form-input" inputMode="decimal" dir="ltr" value={amount} onChange={e => setAmount(e.target.value)} data-autofocus /></div>
                    <div className="form-group"><label className="form-label" htmlFor="tr-cur">{tx('Currency')}</label><input id="tr-cur" className="form-input" dir="ltr" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} /></div>
                </div>
                <div className="at-grid">
                    <div className="form-group"><label className="form-label" htmlFor="tr-from">{tx('From')}</label><select id="tr-from" className="form-input" value={from} onChange={e => setFrom(e.target.value)}><option value="">{tx('Not set')}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
                    <div className="form-group"><label className="form-label" htmlFor="tr-to">{tx('To')}</label><select id="tr-to" className="form-input" value={to} onChange={e => setTo(e.target.value)}><option value="">{tx('Not set')}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
                </div>
                <div className="form-group"><label className="form-label" htmlFor="tr-when">{tx('Date and time')}</label><input id="tr-when" type="datetime-local" className="form-input" value={when} onChange={e => setWhen(e.target.value)} /></div>
                {err && <p role="alert" className="at-error">{err}</p>}
                <div className="at-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose} disabled={busy}>{tx('Cancel')}</button>
                    <button className="btn btn-primary" onClick={save} disabled={busy}>{tx('Save transfer')}</button>
                </div>
            </Dialog>
        </div>
    );
}
