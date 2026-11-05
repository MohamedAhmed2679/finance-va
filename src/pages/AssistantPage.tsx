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

    async function send(q?: string) {
        const question = (q ?? text).trim();
        if (!question || busy) return;
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
                    <h1 className="page-title">Ask Zaylo</h1>
                    <p className="page-subtitle">Questions about your money, help with the app, budgets and plans. It only sees totals from this workspace.</p>
                </div>
                {messages.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => { setMessages([]); setError(''); }}><RotateCcw size={14} /> New conversation</button>}
            </div>

            <div className="assistant-layout">
                <div className="card chat-panel assistant-panel">
                    <div className="chat-scroll" ref={scroll} aria-live="polite">
                        {messages.length === 0 && (
                            <div className="assistant-empty">
                                <ZayloMark size={44} />
                                <h2>How can I help?</h2>
                                <p>Ask in English or Arabic. Try one of these:</p>
                                <div className="assistant-suggest">
                                    {suggestions.map(s => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
                                </div>
                            </div>
                        )}
                        <AnimatePresence initial={false}>
                            {messages.map((m, i) => (
                                <motion.div key={i} className={`bubble ${m.role === 'user' ? 'mine' : 'ai'}`}
                                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                                    {m.role === 'assistant' ? <Rich text={m.text} /> : m.text}
                                </motion.div>
                            ))}
                        </AnimatePresence>
                        {busy && <div className="bubble ai typing" aria-label="Zaylo is thinking"><span /><span /><span /></div>}
                        {error && <div className="auth-msg error" role="alert">{error}</div>}
                    </div>
                    <form className="chat-compose" onSubmit={e => { e.preventDefault(); send(); }}>
                        <textarea ref={input} className="form-input" rows={1} value={text} placeholder="Ask about your spending, bills or the app…" aria-label="Ask Zaylo"
                            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                        <button className="btn btn-primary" disabled={busy || !text.trim()} aria-label="Send"><Send size={17} /></button>
                    </form>
                </div>
                <aside className="assistant-side">
                    <HealthCard compact />
                    <p className="text-xs text-muted" style={{ padding: '0 4px' }}><Sparkles size={12} style={{ verticalAlign: -1 }} /> Answers come from Google Gemini using a summary of this workspace. Zaylo can't move money and isn't a licensed financial adviser.</p>
                </aside>
            </div>
        </div>
    );
}
