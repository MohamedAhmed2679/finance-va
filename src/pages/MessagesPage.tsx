import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Send } from 'lucide-react';
import { useStore } from '../store/useStore';
import { supabase, isSupabaseReady } from '../lib/supabase';

interface SupportMessage { id: string; user_id: string; from_admin: boolean; sender_name: string; body: string; created_at: string; read_at: string | null }

/** Private conversation between a user and the Zaylo team. */
export default function MessagesPage() {
    const user = useStore(s => s.user);
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [text, setText] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const me = user?.dbId;

    useEffect(() => {
        if (!me || !isSupabaseReady() || !supabase) { setLoading(false); return; }
        supabase.from('support_messages').select('*').eq('user_id', me).order('created_at').limit(500)
            .then(({ data }) => {
                setMessages((data as SupportMessage[]) || []);
                setLoading(false);
                const unread = (data || []).filter(m => m.from_admin && !m.read_at).map(m => m.id);
                if (unread.length) supabase!.from('support_messages').update({ read_at: new Date().toISOString() }).in('id', unread).then(() => {});
            });
        const channel = supabase.channel(`support:${me}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `user_id=eq.${me}` }, p => {
                const m = p.new as SupportMessage;
                setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
            })
            .subscribe();
        return () => { supabase?.removeChannel(channel); };
    }, [me]);

    useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages.length]);

    async function send() {
        const body = text.trim();
        if (!body || !me || !supabase) return;
        const id = crypto.randomUUID();
        setMessages(prev => [...prev, { id, user_id: me, from_admin: false, sender_name: user?.name || '', body, created_at: new Date().toISOString(), read_at: null }]);
        setText('');
        const { error } = await supabase.from('support_messages').insert({ id, user_id: me, body, sender_name: user?.name || '' });
        if (error) { setMessages(prev => prev.filter(m => m.id !== id)); setText(body); toast.error("Message didn't send. Try again."); }
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Messages</h1>
                    <p className="page-subtitle">A private conversation with the Zaylo team.</p>
                </div>
            </div>
            <section className="card chat-panel" style={{ maxWidth: 820 }}>
                <div className="chat-scroll" ref={scrollRef} aria-live="polite">
                    {loading && <div className="skeleton" style={{ height: 40, width: '50%' }} />}
                    {!loading && messages.length === 0 && (
                        <div className="empty-state" style={{ margin: 'auto' }}>
                            <div className="empty-title">Ask us anything</div>
                            <div className="empty-desc">Report a problem or suggest a feature. We reply here and you'll get a notification.</div>
                        </div>
                    )}
                    <AnimatePresence initial={false}>
                        {messages.map(m => (
                            <motion.div key={m.id} className={`bubble ${m.from_admin ? '' : 'mine'}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                                {m.from_admin && <span className="who">Zaylo team</span>}
                                <div>{m.body}</div>
                                <time>{new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
                <div className="chat-compose">
                    <textarea className="form-input" rows={1} placeholder="Write to the Zaylo team" value={text} aria-label="Message"
                        onChange={e => setText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                    <button className="btn btn-primary btn-icon" style={{ width: 44, minHeight: 44 }} onClick={send} disabled={!text.trim()} aria-label="Send"><Send size={18} /></button>
                </div>
            </section>
        </div>
    );
}
