import { useEffect, useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';
import { tx } from '../i18n/translations';
import { FilePicker, PendingFiles } from '../components/chat/Attachments';
import { NAV, navLabel } from '../components/nav';
import { useStore } from '../store/useStore';
import { CATEGORIES, SECURITY_CATEGORIES, SEVERITIES, checkSupportFiles, collectDiagnostics, createRequest, type Severity, type SupportRequest } from '../services/support';

interface Draft { category: string; subject: string; description: string; severity: Severity; feature: string; ref: string; diagnostics: boolean }
const draftKey = (kind: string) => `zaylo_support_draft_${kind}`;
const emptyDraft = (kind: 'support' | 'security', preset?: Partial<Draft>): Draft => ({ category: '', subject: '', description: '', severity: kind === 'security' ? 'high' : 'normal', feature: '', ref: '', diagnostics: false, ...preset });

/**
 * A structured request to the Zaylo team. kind="security" is the confidential form: it is never
 * routed through the AI assistant, and it opens with what to do right now.
 */
export default function RequestForm({ kind, preset, onCreated, onCancel }: { kind: 'support' | 'security'; preset?: Partial<Draft>; onCreated: (r: SupportRequest) => void; onCancel: () => void }) {
    const lang = useStore(s => s.user?.language ?? 'en');
    const uid = useId();
    const [d, setD] = useState<Draft>(() => {
        try { const saved = JSON.parse(sessionStorage.getItem(draftKey(kind)) || 'null'); if (saved && !preset) return { ...emptyDraft(kind), ...saved }; } catch { /* no draft */ }
        return emptyDraft(kind, preset);
    });
    const [files, setFiles] = useState<File[]>([]);
    const [progress, setProgress] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [tried, setTried] = useState(false);
    const [error, setError] = useState('');
    // One pair of ids per form: a retry after a dropped connection reuses them, so the request can't be created twice.
    const ids = useRef({ requestId: crypto.randomUUID(), messageId: crypto.randomUUID() });
    const firstError = useRef<HTMLElement | null>(null);

    useEffect(() => { try { sessionStorage.setItem(draftKey(kind), JSON.stringify(d)); } catch { /* optional */ } }, [d, kind]);
    const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }));

    const cats = kind === 'security' ? SECURITY_CATEGORIES : CATEGORIES;
    const errs = {
        category: d.category ? '' : kind === 'security' ? 'Choose what you are reporting.' : 'Choose a category.',
        subject: d.subject.trim().length < 3 ? 'Write a short subject (at least 3 characters).' : d.subject.trim().length > 140 ? 'Keep the subject under 140 characters.' : '',
        description: d.description.trim().length < 10 ? 'Describe what happened in a sentence or two.' : d.description.length > 4000 ? 'Keep the description under 4,000 characters.' : '',
    };
    const invalid = Boolean(errs.category || errs.subject || errs.description);
    const show = (k: keyof typeof errs) => (tried && errs[k] ? errs[k] : '');
    const diagnostics = collectDiagnostics();

    function addFiles(list: File[]) {
        const next = [...files, ...list];
        const problem = checkSupportFiles(next);
        if (problem) { toast.error(tx(problem)); return; }
        setFiles(next);
    }

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (busy) return;
        setTried(true); setError('');
        if (invalid) { requestAnimationFrame(() => (document.querySelector(`#${CSS.escape(uid)}-form [aria-invalid="true"]`) as HTMLElement | null)?.focus()); return; }
        setBusy(true);
        try {
            if (files.length) setProgress(0);
            const r = await createRequest({
                category: d.category, subject: d.subject, description: d.description, severity: d.severity,
                relatedFeature: d.feature || undefined, relatedRef: d.ref || undefined,
                diagnostics: d.diagnostics ? diagnostics : null, files, confidential: kind === 'security',
            }, ids.current, n => setProgress(n));
            try { sessionStorage.removeItem(draftKey(kind)); } catch { /* optional */ }
            onCreated(r);
        } catch (err) {
            setError(err instanceof Error ? tx(err.message) : tx('Your request wasn\'t sent. Check your connection and try again.'));
            firstError.current?.focus();
        } finally { setBusy(false); setProgress(null); }
    }

    const hint = kind === 'security' ? SECURITY_CATEGORIES.find(c => c.key === d.category)?.hint : '';

    return (
        <form id={`${uid}-form`} className="card help-form" onSubmit={submit} noValidate>
            {kind === 'security' && (
                <div className="help-callout" role="note">
                    <ShieldAlert size={20} aria-hidden />
                    <div>
                        <strong>{tx('If you think someone else can get into your account, do this first')}</strong>
                        <ol>
                            <li>{tx('Change the password of the email or sign-in account you use for Zaylo.')}</li>
                            <li>{tx('Sign out of Zaylo on every device you don\'t have with you, then sign in again here.')}</li>
                            <li>{tx('Then send this report so the team can check your account.')}</li>
                        </ol>
                        <p>{tx('Zaylo will never ask for your password, PIN or a security code. Don\'t include them in this report.')}</p>
                    </div>
                </div>
            )}

            <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-cat`}>{kind === 'security' ? tx('What are you reporting?') : tx('Category')}</label>
                <select id={`${uid}-cat`} className="form-input form-select" value={d.category} onChange={e => set('category', e.target.value)}
                    aria-invalid={Boolean(show('category'))} aria-describedby={show('category') ? `${uid}-cat-err` : hint ? `${uid}-cat-hint` : undefined} required>
                    <option value="">{tx('Choose…')}</option>
                    {cats.map(c => <option key={c.key} value={c.key}>{tx(c.label)}</option>)}
                </select>
                {hint && !show('category') && <p className="form-hint" id={`${uid}-cat-hint`}>{tx(hint)}</p>}
                {show('category') && <p className="form-error" id={`${uid}-cat-err`}>{tx(show('category'))}</p>}
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-subj`}>{tx('Subject')}</label>
                <input id={`${uid}-subj`} className="form-input" value={d.subject} maxLength={140} onChange={e => set('subject', e.target.value)}
                    aria-invalid={Boolean(show('subject'))} aria-describedby={show('subject') ? `${uid}-subj-err` : undefined} required autoComplete="off" />
                {show('subject') && <p className="form-error" id={`${uid}-subj-err`}>{tx(show('subject'))}</p>}
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-desc`}>{tx('What happened?')}</label>
                <textarea id={`${uid}-desc`} className="form-input" rows={6} value={d.description} maxLength={4000} onChange={e => set('description', e.target.value)}
                    aria-invalid={Boolean(show('description'))} aria-describedby={`${uid}-desc-hint${show('description') ? ` ${uid}-desc-err` : ''}`} required />
                <p className="form-hint" id={`${uid}-desc-hint`}>{tx('Say what you did, what you expected and what you saw. Don\'t include passwords, card numbers or security codes.')}</p>
                {show('description') && <p className="form-error" id={`${uid}-desc-err`}>{tx(show('description'))}</p>}
            </div>

            <fieldset className="form-group help-severity">
                <legend className="form-label">{tx('How much is this affecting you?')}</legend>
                <div className="help-radio-row">
                    {SEVERITIES.map(s => (
                        <label key={s.key} className={`help-radio ${d.severity === s.key ? 'on' : ''}`}>
                            <input type="radio" name={`${uid}-sev`} value={s.key} checked={d.severity === s.key} onChange={() => set('severity', s.key)} />
                            <span><strong>{tx(s.label)}</strong><small>{tx(s.hint)}</small></span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="help-two">
                <div className="form-group">
                    <label className="form-label" htmlFor={`${uid}-feat`}>{tx('Related feature')} <span className="optional">{tx('(optional)')}</span></label>
                    <select id={`${uid}-feat`} className="form-input form-select" value={d.feature} onChange={e => set('feature', e.target.value)}>
                        <option value="">{tx('None')}</option>
                        {NAV.filter(n => n.key !== 'help').map(n => <option key={n.key} value={n.key}>{navLabel(lang, n)}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label className="form-label" htmlFor={`${uid}-ref`}>{tx('Related record')} <span className="optional">{tx('(optional)')}</span></label>
                    <input id={`${uid}-ref`} className="form-input" value={d.ref} maxLength={120} onChange={e => set('ref', e.target.value)} aria-describedby={`${uid}-ref-hint`} autoComplete="off" />
                    <p className="form-hint" id={`${uid}-ref-hint`}>{tx('For example the shop and date of an expense. Only what you type here is shared: the team does not get your records with this request.')}</p>
                </div>
            </div>

            <div className="form-group">
                <span className="form-label">{tx('Attachments')} <span className="optional">{tx('(optional)')}</span></span>
                <div className="help-attach">
                    <FilePicker onAdd={addFiles} disabled={busy} />
                    <span className="form-hint">{tx('Screenshots, PDFs or text files. Up to 5 files, 10 MB each. Hide anything private before you attach it.')}</span>
                </div>
                <PendingFiles files={files} progress={progress} onRemove={i => setFiles(f => f.filter((_, j) => j !== i))} />
            </div>

            <div className="form-group">
                <label className="help-check">
                    <input type="checkbox" checked={d.diagnostics} onChange={e => set('diagnostics', e.target.checked)} />
                    <span>{tx('Include technical details about this device and app version')}</span>
                </label>
                <details className="help-details">
                    <summary>{tx('See exactly what would be included')}</summary>
                    <dl translate="no">{Object.entries(diagnostics).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
                </details>
            </div>

            {error && <div className="auth-msg error" role="alert" tabIndex={-1} ref={el => { firstError.current = el; }}>{error}</div>}

            <div className="help-form-actions">
                <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>{tx('Cancel')}</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? tx('Sending…') : kind === 'security' ? tx('Send confidential report') : tx('Send request')}</button>
            </div>
            <p className="form-hint">{kind === 'security'
                ? tx('This report goes to the Zaylo team only. It is not read or answered by AI.')
                : tx('The Zaylo team replies inside the request and you get a notification. There is no live chat or phone support.')}</p>
        </form>
    );
}
