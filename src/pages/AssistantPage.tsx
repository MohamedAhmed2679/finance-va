import { tx } from '../i18n/translations';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Send, Sparkles, RotateCcw, ThumbsUp, ThumbsDown, Flag, LifeBuoy, Trash2, Info } from 'lucide-react';
import { askZaylo, type ChatMessage } from '../services/zayloAI';
import { AiConsentDeclined, hasAiConsent } from '../services/aiConsent';
import { sendAiFeedback } from '../services/support';
import { relatedArticles } from '../help/articles';
import { useStore } from '../store/useStore';
import { ZayloMark } from '../components/brand/Brand';
import HealthCard from '../components/HealthCard';

const SUGGESTIONS = [
    'How do I create a savings goal?',
    'Why is a transaction still pending?',
    'How can I organize recurring expenses?',
    'How do I update my privacy settings?',
    'How much did I spend on dining this cycle?',
    'Which bills are due this week?',
];
const AR_SUGGESTIONS = ['كيف أنشئ هدف ادخار؟', 'لماذا ما زالت المعاملة معلّقة؟', 'كيف أنظّم المصروفات المتكررة؟', 'كيف أحدّث إعدادات الخصوصية؟', 'كم صرفت على المطاعم في هذه الدورة؟', 'ما الفواتير المستحقة هذا الأسبوع؟'];

/** Things a person should never type into an assistant. Checked on the device before anything is sent. */
function sensitiveReason(text: string): string | null {
    const digits = text.replace(/[\s-]/g, '');
    const card = digits.match(/\d{13,19}/);
    if (card && luhn(card[0])) return 'That looks like a card number. Remove it before you send: Zaylo AI must not receive card numbers.';
    if (/\b(password|passcode|كلمة\s*(ال)?(سر|مرور))\b\s*(is|:|=|هي)\s*\S+/i.test(text)) return 'That looks like a password. Remove it before you send: nobody at Zaylo, and no AI, needs your password.';
    if (/\b(cvv|cvc)\b\D{0,6}\d{3,4}\b/i.test(text)) return 'That looks like a card security code. Remove it before you send.';
    return null;
}
function luhn(n: string) { let sum = 0, alt = false; for (let i = n.length - 1; i >= 0; i--) { let d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; } return sum % 10 === 0; }

const storeKey = (ws: string) => `zaylo_chat_${ws}`;

/** Light markdown: **bold** and "- " bullets, rendered safely as React nodes. */
function Rich({ text }: { text: string }) {
    const lines = text.split('\n');
    const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>);
    const out: React.ReactNode[] = [];
    let list: string[] = [];
    const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
    lines.forEach((l, i) => {
        const m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
        if (m) list.push(m[1]);
        else { flush(); if (l.trim()) out.push(<p key={i}>{inline(l)}</p>); }
    });
    flush();
    return <>{out}</>;
}

export default function AssistantPage() {
    const { activeWorkspaceId, user } = useStore();
    const lang = (user?.language ?? 'en') as 'en' | 'ar';
    const navigate = useNavigate();
    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        try { return JSON.parse(sessionStorage.getItem(storeKey(activeWorkspaceId)) || '[]'); } catch { return []; }
    });
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    const [rated, setRated] = useState<Record<number, 'helpful' | 'not_helpful' | 'reported'>>({});
    const [reporting, setReporting] = useState<number | null>(null);
    const [reason, setReason] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [allowed, setAllowed] = useState(hasAiConsent());
    const scroll = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        try { sessionStorage.setItem(storeKey(activeWorkspaceId), JSON.stringify(messages.slice(-30))); } catch { /* optional */ }
        if (messages.length || busy) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
    }, [messages, activeWorkspaceId, busy]);
    useEffect(() => {
        const sync = () => setAllowed(hasAiConsent());
        window.addEventListener('zaylo:ai-consent-changed', sync);
        return () => window.removeEventListener('zaylo:ai-consent-changed', sync);
    }, []);

    /** A pasted bank / wallet SMS goes through AutoTrack (on the device) instead of the chat AI. */
    async function handleBankMessage(question: string): Promise<boolean> {
        const { parseMessage } = await import('../autotrack/parse');
        const p = parseMessage(question, null);
        if (p.kind === 'other' || p.kind === 'promo') return false;
        const { redactExcerpt } = await import('../autotrack/redact');
        // the chat keeps only a masked copy; codes are never shown again or sent anywhere
        const shown = p.kind === 'otp' ? tx('(security code message hidden)') : redactExcerpt(question);
        setMessages(m => [...m, { role: 'user', text: shown }]);
        setText(''); setError('');
        if (p.kind === 'otp') { setMessages(m => [...m, { role: 'assistant', text: tx('That looks like a security code. Zaylo never reads or keeps codes; don\'t share them with anyone.'), local: true }]); return true; }
        if (p.kind === 'balance') { setMessages(m => [...m, { role: 'assistant', text: tx('That\'s a balance notice, so there\'s no transaction to record.'), local: true }]); return true; }
        setBusy(true);
        try {
            const { processMessage } = await import('../autotrack/service');
            const r = await processMessage({ text: question, sender: null, ingestion: 'assistant' });
            const reply = r.outcome === 'auto_added' ? `**${tx(r.message)}** ${tx('You can change or undo it in AutoTrack.')}`
                : r.outcome === 'stored' ? `**${tx(r.message)}**\n- ${r.draft?.reason ?? ''}\n- ${tx('Open AutoTrack to confirm, change or ignore it.')}`
                : r.outcome === 'duplicate' ? tx(r.message)
                : r.outcome === 'queued' ? tx(r.message)
                : `${tx('Nothing was recorded:')} ${tx(r.message)}`;
            setMessages(m => [...m, { role: 'assistant', text: reply, local: true }]);
        } catch (e) {
            setError(e instanceof Error ? e.message : tx('Couldn\'t process that message.'));
        } finally { setBusy(false); }
        return true;
    }

    async function send(q?: string) {
        const question = (q ?? text).trim();
        if (!question || busy) return;
        const problem = sensitiveReason(question);
        if (problem) { setWarning(problem); input.current?.focus(); return; }
        setWarning('');
        if (await handleBankMessage(question)) return;
        const next: ChatMessage[] = [...messages, { role: 'user', text: question }];
        setBusy(true); setError('');
        try {
            // only the questions and AI answers go back as context; device-side notes are not part of the AI conversation
            const reply = await askZaylo(next.filter(m => !m.local).map(m => ({ role: m.role, text: m.text })));
            setMessages([...next, { role: 'assistant', text: reply }]);
            setText('');
        } catch (e) {
            if (e instanceof AiConsentDeclined) setError('');      // the notice below explains; the question stays in the box
            else { setMessages(next); setText(''); setError(e instanceof Error ? e.message : 'Zaylo AI couldn\'t answer just now.'); }
        } finally { setBusy(false); setAllowed(hasAiConsent()); input.current?.focus(); }
    }

    async function rate(i: number, rating: 'helpful' | 'not_helpful') {
        if (rated[i]) return;
        setRated(r => ({ ...r, [i]: rating }));
        try { await sendAiFeedback(rating); }
        catch { setRated(r => { const n = { ...r }; delete n[i]; return n; }); toast.error(tx('Your feedback couldn\'t be saved. Try again.')); }
    }
    async function report(i: number) {
        try {
            await sendAiFeedback('reported', { reason, answer: messages[i]?.text });
            setRated(r => ({ ...r, [i]: 'reported' })); setReporting(null); setReason('');
            toast.success(tx('Thanks. This answer was reported to the Zaylo team.'));
        } catch { toast.error(tx('Your report couldn\'t be sent. Try again.')); }
    }
    function reset() { setMessages([]); setError(''); setWarning(''); setRated({}); setReporting(null); setConfirmDelete(false); try { sessionStorage.removeItem(storeKey(activeWorkspaceId)); } catch { /* optional */ } }

    const suggestions = lang === 'ar' ? AR_SUGGESTIONS : SUGGESTIONS;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{tx('Zaylo AI Assistant')}</h1>
                    <p className="page-subtitle">{tx('Answers about using Zaylo and about the totals in this workspace, written by AI.')}</p>
                </div>
                <div className="assistant-head-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => navigate('/help?view=contact')}><LifeBuoy size={14} />{' '}{tx('Talk to support')}</button>
                    {messages.length > 0 && <button className="btn btn-secondary btn-sm" onClick={reset}><RotateCcw size={14} />{' '}{tx('New conversation')}</button>}
                    {messages.length > 0 && (confirmDelete
                        ? <span className="assistant-confirm"><span>{tx('Delete this conversation?')}</span><button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>{tx('Keep')}</button><button className="btn btn-danger btn-sm" onClick={() => { reset(); toast.success(tx('Conversation deleted from this device.')); }}>{tx('Delete')}</button></span>
                        : <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />{' '}{tx('Delete conversation')}</button>)}
                </div>
            </div>

            <div className="assistant-layout">
                <div className="card chat-panel assistant-panel">
                    <p className="assistant-notice" role="note"><Info size={15} aria-hidden /><span>{tx('AI responses may be inaccurate. Do not include passwords, card numbers, security codes, or other sensitive information.')}</span></p>
                    <div className="chat-scroll" ref={scroll} aria-live="polite">
                        {messages.length === 0 && (
                            <div className="assistant-empty">
                                <ZayloMark size={36} />
                                <h2>{tx('What do you need help with?')}</h2>
                                {!allowed && <p className="assistant-consent-note">{tx('Zaylo AI is off for your account. When you ask your first question, Zaylo shows what would be sent to the AI provider and asks for your permission. You can use the Help Center and contact support without it.')}</p>}
                                <div className="assistant-suggest">
                                    {suggestions.map(s => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
                                </div>
                            </div>
                        )}
                        <AnimatePresence initial={false}>
                            {messages.map((m, i) => {
                                const related = m.role === 'assistant' && !m.local ? relatedArticles(`${messages[i - 1]?.text || ''} ${m.text}`) : [];
                                return (
                                    <motion.div key={i} translate="no" className={`bubble ${m.role === 'user' ? 'mine' : 'ai'}`}
                                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
                                        {m.role === 'assistant' && !m.local && <span className="ai-label"><Sparkles size={12} aria-hidden /> {tx('Zaylo AI Assistant')} · {tx('AI-generated')}</span>}
                                        {m.role === 'assistant' ? <Rich text={m.text} /> : m.text}
                                        {related.length > 0 && (
                                            <div className="ai-related">
                                                <span>{tx('Related help articles')}</span>
                                                {related.map(a => <button key={a.id} onClick={() => navigate(`/help?article=${a.id}`)}>{a[lang].title}</button>)}
                                            </div>
                                        )}
                                        {m.role === 'assistant' && !m.local && (
                                            <div className="ai-feedback">
                                                {rated[i]
                                                    ? <span className="ai-feedback-done" role="status">{rated[i] === 'reported' ? tx('Reported to the Zaylo team') : tx('Thanks for the feedback')}</span>
                                                    : <>
                                                        <button className="icon-btn" onClick={() => rate(i, 'helpful')} aria-label={tx('This answer was helpful')} title={tx('Helpful')}><ThumbsUp size={15} /></button>
                                                        <button className="icon-btn" onClick={() => rate(i, 'not_helpful')} aria-label={tx('This answer was not helpful')} title={tx('Not helpful')}><ThumbsDown size={15} /></button>
                                                        <button className="icon-btn" onClick={() => { setReporting(reporting === i ? null : i); setReason(''); }} aria-expanded={reporting === i} aria-label={tx('Report this answer')} title={tx('Report this answer')}><Flag size={15} /></button>
                                                    </>}
                                            </div>
                                        )}
                                        {reporting === i && (
                                            <form className="ai-report" onSubmit={e => { e.preventDefault(); report(i); }}>
                                                <label htmlFor={`ai-report-${i}`}>{tx('What is wrong with this answer?')}</label>
                                                <textarea id={`ai-report-${i}`} className="form-input" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
                                                <p>{tx('The answer text and your note are sent to the Zaylo team. Your question is not.')}</p>
                                                <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setReporting(null)}>{tx('Cancel')}</button><button className="btn btn-primary btn-sm">{tx('Send report')}</button></div>
                                            </form>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                        {busy && <div className="bubble ai typing" role="status" aria-label={tx('Zaylo AI is writing an answer')}><span /><span /><span /></div>}
                        {error && (
                            <div className="auth-msg error" role="alert">
                                {error}{' '}
                                <button className="link-btn" onClick={() => navigate('/help?view=contact&category=ai_assistant')}>{tx('Contact support')}</button>
                            </div>
                        )}
                    </div>
                    {warning && <div className="auth-msg error assistant-warning" role="alert">{tx(warning)}</div>}
                    <form className="chat-compose" onSubmit={e => { e.preventDefault(); send(); }}>
                        <textarea ref={input} className="form-input" rows={1} value={text} maxLength={2000} placeholder={tx('Ask about the app, your spending or your bills')} aria-label={tx('Message to Zaylo AI Assistant')}
                            onChange={e => { setText(e.target.value); if (warning) setWarning(''); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                        <button className="btn btn-primary" disabled={busy || !text.trim()} aria-label={tx('Send')}><Send size={17} /></button>
                    </form>
                </div>
                <aside className="assistant-side">
                    <HealthCard compact />
                    <div className="assistant-facts">
                        <h2>{tx('About this assistant')}</h2>
                        <ul>
                            <li>{tx('It is an AI (Google Gemini), not a person.')}</li>
                            <li>{tx('It sees a summary of this workspace, not your full history. You choose whether to allow that.')}</li>
                            <li>{tx('It cannot move money or change your records.')}</li>
                            <li>{tx('It is not a financial, tax, legal or investment adviser.')}</li>
                            <li>{tx('Zaylo does not store this conversation on its servers. It stays on this device until you close the app or delete it.')}</li>
                        </ul>
                        <button className="link-btn" onClick={() => navigate('/settings?section=ai')}>{tx('AI and data settings')}</button>
                    </div>
                </aside>
            </div>
        </div>
    );
}
