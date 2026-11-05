import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Send } from 'lucide-react';
import { useStore } from '../store/useStore';
import { supabase, isSupabaseReady } from '../lib/supabase';
import { checkFiles, uploadChatFiles, type Attachment } from '../services/chatFiles';
import { FilePicker, Lightbox, MessageAttachments, PendingFiles, useAttachmentUrls, type GalleryItem } from '../components/chat/Attachments';

interface SupportMessage { id: string; user_id: string; from_admin: boolean; sender_name: string; body: string; created_at: string; read_at: string | null; attachments?: (Attachment & { localUrl?: string })[] }

const toItems = (m: SupportMessage): GalleryItem[] => (m.attachments || []).map(a => ({ ...a, messageId: m.id, sender: m.from_admin ? 'Zaylo team' : 'You', createdAt: m.created_at }));

/** Private conversation between a user and the Zaylo team. */
export default function MessagesPage() {
    const user = useStore(s => s.user);
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [text, setText] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [progress, setProgress] = useState<number | null>(null);
    const [viewing, setViewing] = useState<string | null>(null);
    const items = useMemo(() => messages.flatMap(toItems), [messages]);
    const urls = useAttachmentUrls(items);
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

    function addFiles(list: File[]) {
        const next = [...files, ...list];
        const problem = checkFiles(next);
        if (problem) { toast.error(problem); return; }
        setFiles(next);
    }

    async function send() {
        const body = text.trim();
        if ((!body && !files.length) || !me || !supabase || progress != null) return;
        const id = crypto.randomUUID();
        const sending = files;
        const local = sending.map(f => ({ path: `local:${id}:${f.name}`, name: f.name, type: f.type || 'application/octet-stream', size: f.size, localUrl: URL.createObjectURL(f) }));
        setMessages(prev => [...prev, { id, user_id: me, from_admin: false, sender_name: user?.name || '', body, created_at: new Date().toISOString(), read_at: null, attachments: local }]);
        setText('');
        let attachments: Attachment[] = [];
        if (sending.length) {
            setProgress(0);
            try { attachments = await uploadChatFiles(`support/${me}`, sending, n => setProgress(n)); }
            catch (err) { setProgress(null); setMessages(prev => prev.filter(m => m.id !== id)); setText(body); toast.error(err instanceof Error ? err.message : "Files didn't upload."); return; }
            setProgress(null); setFiles([]);
        }
        const row: Record<string, unknown> = { id, user_id: me, body, sender_name: user?.name || '' };
        if (attachments.length) row.attachments = attachments;
        const { error } = await supabase.from('support_messages').insert(row);
        if (error) { setMessages(prev => prev.filter(m => m.id !== id)); setText(body); if (sending.length) setFiles(sending); toast.error("Message didn't send. Try again."); }
        else setMessages(prev => prev.map(m => m.id === id ? { ...m, attachments: attachments.map((a, i) => ({ ...a, localUrl: local[i]?.localUrl })) } : m));
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
                                {m.attachments?.length ? <MessageAttachments items={toItems(m)} urls={urls} onOpen={setViewing} /> : null}
                                {m.body && <div>{m.body}</div>}
                                <time>{new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
                <PendingFiles files={files} progress={progress} onRemove={i => setFiles(f => f.filter((_, j) => j !== i))} />
                <div className="chat-compose">
                    <FilePicker onAdd={addFiles} disabled={progress != null} />
                    <textarea className="form-input" rows={1} placeholder="Write to the Zaylo team" value={text} aria-label="Message"
                        onChange={e => setText(e.target.value)}
                        onPaste={e => { const f = Array.from(e.clipboardData.files || []); if (f.length) { e.preventDefault(); addFiles(f); } }}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                    <button className="btn btn-primary btn-icon" style={{ width: 44, minHeight: 44 }} onClick={send} disabled={(!text.trim() && !files.length) || progress != null} aria-label="Send"><Send size={18} /></button>
                </div>
            </section>
            <AnimatePresence>{viewing && <Lightbox items={items} start={viewing} urls={urls} onClose={() => setViewing(null)} />}</AnimatePresence>
        </div>
    );
}
