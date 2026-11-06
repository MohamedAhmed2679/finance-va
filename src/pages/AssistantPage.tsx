import { tx } from '../i18n/translations';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Send, Sparkles, RotateCcw } from 'lucide-react';
import { askZaylo, type ChatMessage } from '../services/zayloAI';
import { useStore } from '../store/useStore';
import { ZayloMark } from '../components/brand/Brand';
import HealthCard from '../components/HealthCard';

const SUGGESTIONS = [
    'How much did I spend on dining this cycle?',
    'Where can I save 1,000 next month?',
    'Am I on track with my budget?',
    'Plan a budget for next month',
    'How do I scan a receipt?',
    'Which bills are due this week?',
];
const AR_SUGGESTIONS = ['كم صرفت على المطاعم هذا الشهر؟', 'أين يمكنني التوفير؟', 'هل أنا ملتزم بالميزانية؟', 'كيف أمسح إيصالًا؟'];

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
    const lang = user?.language ?? 'en';
    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        try { return JSON.parse(sessionStorage.getItem(storeKey(activeWorkspaceId)) || '[]'); } catch { return []; }
    });
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const scroll = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        try { sessionStorage.setItem(storeKey(activeWorkspaceId), JSON.stringify(messages.slice(-30))); } catch { /* optional */ }
        scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
    }, [messages, activeWorkspaceId, busy]);

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
        if (p.kind === 'otp') { setMessages(m => [...m, { role: 'assistant', text: tx('That looks like a security code. Zaylo never reads or keeps codes; don\'t share them with anyone.') }]); return true; }
        if (p.kind === 'balance') { setMessages(m => [...m, { role: 'assistant', text: tx('That\'s a balance notice, so there\'s no transaction to record.') }]); return true; }
        setBusy(true);
        try {
            const { processMessage } = await import('../autotrack/service');
            const r = await processMessage({ text: question, sender: null, ingestion: 'assistant' });
            const reply = r.outcome === 'auto_added' ? `**${tx(r.message)}** ${tx('You can change or undo it in AutoTrack.')}`
                : r.outcome === 'stored' ? `**${tx(r.message)}**\n- ${r.draft?.reason ?? ''}\n- ${tx('Open AutoTrack to confirm, change or ignore it.')}`
                : r.outcome === 'duplicate' ? tx(r.message)
                : r.outcome === 'queued' ? tx(r.message)
                : `${tx('Nothing was recorded:')} ${tx(r.message)}`;
            setMessages(m => [...m, { role: 'assistant', text: reply }]);
        } catch (e) {
            setError(e instanceof Error ? e.message : tx('Couldn\'t process that message.'));
        } finally { setBusy(false); }
        return true;
    }

    async function send(q?: string) {
        const question = (q ?? text).trim();
        if (!question || busy) return;
        if (await handleBankMessage(question)) return;
        const next: ChatMessage[] = [...messages, { role: 'user', text: question }];
        setMessages(next); setText(''); setError(''); setBusy(true);
        try {
            const reply = await askZaylo(next);
            setMessages(m => [...m, { role: 'assistant', text: reply }]);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Zaylo couldn\'t answer just now.');
        } finally { setBusy(false); input.current?.focus(); }
    }

    const suggestions = lang === 'ar' ? AR_SUGGESTIONS : SUGGESTIONS;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{tx('Ask Zaylo')}</h1>
                    <p className="page-subtitle">{tx('Questions about your money, help with the app, budgets and plans. It only sees totals from this workspace.')}</p>
                </div>
                {messages.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => { setMessages([]); setError(''); }}><RotateCcw size={14} />{' '}{tx('New conversation')}</button>}
            </div>

            <div className="assistant-layout">
                <div className="card chat-panel assistant-panel">
                    <div className="chat-scroll" ref={scroll} aria-live="polite">
                        {messages.length === 0 && (
                            <div className="assistant-empty">
                                <ZayloMark size={44} />
                                <h2>{tx('How can I help?')}</h2>
                                <p>{tx('Ask in English or Arabic. Try one of these:')}</p>
                                <div className="assistant-suggest">
                                    {suggestions.map(s => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
                                </div>
                            </div>
                        )}
                        <AnimatePresence initial={false}>
                            {messages.map((m, i) => (
                                <motion.div key={i} translate="no" className={`bubble ${m.role === 'user' ? 'mine' : 'ai'}`}
                                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                                    {m.role === 'assistant' ? <Rich text={m.text} /> : m.text}
                                </motion.div>
                            ))}
                        </AnimatePresence>
                        {busy && <div className="bubble ai typing" aria-label={tx('Zaylo is thinking')}><span /><span /><span /></div>}
                        {error && <div className="auth-msg error" role="alert">{error}</div>}
                    </div>
                    <form className="chat-compose" onSubmit={e => { e.preventDefault(); send(); }}>
                        <textarea ref={input} className="form-input" rows={1} value={text} placeholder={tx('Ask about your spending, bills or the app…')} aria-label={tx('Ask Zaylo')}
                            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                        <button className="btn btn-primary" disabled={busy || !text.trim()} aria-label={tx('Send')}><Send size={17} /></button>
                    </form>
                </div>
                <aside className="assistant-side">
                    <HealthCard compact />
                    <p className="text-xs text-muted" style={{ padding: '0 4px' }}><Sparkles size={12} style={{ verticalAlign: -1 }} />{' '}{tx('Answers come from Google Gemini using a summary of this workspace. Zaylo can\'t move money and isn\'t a licensed financial adviser.')}</p>
                </aside>
            </div>
        </div>
    );
}
