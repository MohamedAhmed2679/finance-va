import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Send, Users, UserPlus, X, Trash2, Images } from 'lucide-react';
import { checkFiles, uploadChatFiles, type Attachment } from '../services/chatFiles';
import { ChatGallery, FilePicker, Lightbox, MessageAttachments, PendingFiles, useAttachmentUrls, type GalleryItem } from '../components/chat/Attachments';
import { useStore, type WorkspaceRole } from '../store/useStore';
import { supabase, isSupabaseReady } from '../lib/supabase';

interface ChatMessage { id: string; workspace_id: string; user_id: string; sender_name: string; body: string; is_deleted: boolean; created_at: string; attachments?: (Attachment & { localUrl?: string })[]; pending?: boolean }

const toItems = (m: Pick<ChatMessage, 'id' | 'sender_name' | 'created_at' | 'attachments'>): GalleryItem[] =>
    (m.attachments || []).map(a => ({ ...a, messageId: m.id, sender: m.sender_name, createdAt: m.created_at }));

const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
    const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

export default function ChatPage() {
    const { user, workspaces, activeWorkspaceId, inviteMember, removeMember, refreshMembers } = useStore();
    const ws = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [text, setText] = useState('');
    const [showMembers, setShowMembers] = useState(false);
    const [side, setSide] = useState<'members' | 'gallery'>('members');
    const [files, setFiles] = useState<File[]>([]);
    const [progress, setProgress] = useState<number | null>(null);
    const [dragging, setDragging] = useState(false);
    const [viewing, setViewing] = useState<string | null>(null);
    const [history, setHistory] = useState<GalleryItem[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [adding, setAdding] = useState('');
    const [role, setRole] = useState<WorkspaceRole>('member');
    const scrollRef = useRef<HTMLDivElement>(null);
    const me = user?.dbId;
    const myRole = ws?.members.find(m => m.uid === me)?.role;
    const canManage = Boolean(user?.isAdmin) || myRole === 'owner' || myRole === 'admin' || ws?.ownerId === me;

    // Load history + subscribe to new messages for this workspace
    useEffect(() => {
        if (!ws || !isSupabaseReady() || !supabase) { setLoading(false); return; }
        let alive = true;
        setLoading(true);
        setMessages([]);
        setHistory([]);
        setFiles([]);
        refreshMembers(ws.id).catch(() => {});
        supabase.from('chat_messages').select('*').eq('workspace_id', ws.id).eq('is_deleted', false)
            .order('created_at', { ascending: false }).limit(200)
            .then(({ data, error }) => {
                if (!alive) return;
                if (error) toast.error(/relation|does not exist/i.test(error.message) ? 'Chat needs the latest database update.' : "Couldn't load messages.");
                setMessages(((data as ChatMessage[]) || []).reverse());
                setLoading(false);
            });
        const channel = supabase.channel(`chat:${ws.id}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `workspace_id=eq.${ws.id}` }, payload => {
                const m = payload.new as ChatMessage;
                setMessages(prev => prev.some(p => p.id === m.id) ? prev.map(p => p.id === m.id ? m : p) : [...prev, m]);
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `workspace_id=eq.${ws.id}` }, payload => {
                const m = payload.new as ChatMessage;
                setMessages(prev => m.is_deleted ? prev.filter(p => p.id !== m.id) : prev.map(p => p.id === m.id ? m : p));
            })
            .subscribe();
        return () => { alive = false; supabase?.removeChannel(channel); };
    }, [ws?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages.length]);

    function addFiles(list: File[]) {
        const next = [...files, ...list];
        const problem = checkFiles(next);
        if (problem) { toast.error(problem); return; }
        setFiles(next);
    }

    async function send() {
        const body = text.trim();
        if ((!body && !files.length) || !ws || !me || !supabase || progress != null) return;
        const id = crypto.randomUUID();
        const sending = files;
        const local = sending.map(f => ({ path: `local:${id}:${f.name}`, name: f.name, type: f.type || 'application/octet-stream', size: f.size, localUrl: URL.createObjectURL(f) }));
        const optimistic: ChatMessage = { id, workspace_id: ws.id, user_id: me, sender_name: user?.name || '', body, is_deleted: false, created_at: new Date().toISOString(), attachments: local, pending: true };
        setMessages(prev => [...prev, optimistic]);
        setText('');
        let attachments: Attachment[] = [];
        if (sending.length) {
            setProgress(0);
            try { attachments = await uploadChatFiles(ws.id, sending, n => setProgress(n)); }
            catch (err) {
                setProgress(null);
                setMessages(prev => prev.filter(m => m.id !== id));
                setText(body);
                toast.error(err instanceof Error ? err.message : "Files didn't upload.");
                return;
            }
            setProgress(null);
            setFiles([]);
        }
        const row: Record<string, unknown> = { id, workspace_id: ws.id, user_id: me, body };
        if (attachments.length) row.attachments = attachments;
        const { error } = await supabase.from('chat_messages').insert(row);
        if (error) {
            setMessages(prev => prev.filter(m => m.id !== id));
            setText(body);
            if (sending.length) setFiles(sending);
            toast.error(/row-level security/i.test(error.message) ? "You're not a member of this workspace's chat." : /attachments|check constraint/i.test(error.message) ? 'Attachments need the latest database update.' : "Message didn't send. Try again.");
        } else {
            // Keep the local previews until the realtime copy replaces them
            setMessages(prev => prev.map(m => m.id === id ? { ...m, pending: false, attachments: attachments.map((a, i) => ({ ...a, localUrl: local[i]?.localUrl })) } : m));
        }
    }

    // Everything shared in this chat, newest first: loaded messages + older history
    useEffect(() => {
        if (side !== 'gallery' || !ws || !supabase) return;
        let alive = true;
        setHistoryLoading(true);
        supabase.from('chat_messages').select('id, sender_name, created_at, attachments').eq('workspace_id', ws.id).eq('is_deleted', false)
            .order('created_at', { ascending: false }).limit(1000)
            .then(({ data }) => {
                if (!alive) return;
                setHistory(((data as ChatMessage[]) || []).filter(m => m.attachments?.length).flatMap(toItems));
                setHistoryLoading(false);
            });
        return () => { alive = false; };
    }, [side, ws?.id, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const gallery = useMemo(() => {
        const seen = new Set<string>();
        const live = [...messages].reverse().flatMap(toItems);
        return [...live, ...history].filter(a => !a.path.startsWith('local:') && !seen.has(a.path) && seen.add(a.path))
            .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    }, [messages, history]);
    const allAttachments = useMemo(() => [...messages.flatMap(toItems), ...history], [messages, history]);
    const urls = useAttachmentUrls(allAttachments);
    // The viewer walks through the conversation in reading order
    const viewerItems = useMemo(() => {
        const inChat = messages.flatMap(toItems);
        return side === 'gallery' ? [...gallery].reverse() : inChat;
    }, [messages, gallery, side]);

    async function deleteMessage(id: string) {
        if (!supabase) return;
        const { error } = await supabase.from('chat_messages').update({ is_deleted: true }).eq('id', id);
        if (error) toast.error("Couldn't delete that message.");
        else setMessages(prev => prev.filter(m => m.id !== id));
    }

    async function addMember(e: React.FormEvent) {
        e.preventDefault();
        if (!ws || !adding.trim()) return;
        try {
            const r = await inviteMember(ws.id, adding.trim(), '', role);
            if (r === 'not_found') toast.error('No Zaylo account matches that email, phone or Zaylo ID.');
            else if (r === 'pending') { toast.success("They don't have Zaylo yet. They'll join this chat when they sign up with that email."); setAdding(''); }
            else if (r === 'already_member') toast("They're already in this workspace.");
            else if (r === 'self') toast("That's you.");
            else { toast.success('Added and notified'); setAdding(''); }
        } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); }
    }

    const grouped = useMemo(() => {
        const out: (ChatMessage | { divider: string; key: string })[] = [];
        let last = '';
        messages.forEach(m => {
            const k = dayKey(m.created_at);
            if (k !== last) { out.push({ divider: dayLabel(m.created_at), key: k }); last = k; }
            out.push(m);
        });
        return out;
    }, [messages]);

    if (!ws) return <div className="page"><div className="empty-state"><div className="empty-title">No workspace yet</div></div></div>;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{ws.name} chat</h1>
                    <p className="page-subtitle">{ws.members.length} {ws.members.length === 1 ? 'member' : 'members'} · only people in this workspace can read it</p>
                </div>
                <div className="flex gap-2">
                    <button className={`btn ${side === 'gallery' && showMembers ? 'btn-primary' : 'btn-secondary'} chat-gallery-toggle`} onClick={() => { setSide('gallery'); setShowMembers(v => side !== 'gallery' || !v); }} aria-pressed={side === 'gallery'}><Images size={16} /> Gallery</button>
                    <button className="btn btn-secondary chat-members-toggle" onClick={() => { setSide('members'); setShowMembers(v => side !== 'members' || !v); }} style={{ display: 'inline-flex' }}><Users size={16} /> Members</button>
                </div>
            </div>

            <div className={`chat-layout ${showMembers ? 'show-members' : ''}`}>
                <section className={`card chat-panel ${dragging ? 'is-dragging' : ''}`} aria-label="Messages"
                    onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
                    onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
                    onDrop={e => { e.preventDefault(); setDragging(false); const f = Array.from(e.dataTransfer.files || []); if (f.length) addFiles(f); }}>
                    {dragging && <div className="drop-hint">Drop to attach</div>}
                    <div className="chat-scroll" ref={scrollRef} aria-live="polite">
                        {loading && <div className="skeleton" style={{ height: 40, width: '60%' }} />}
                        {!loading && messages.length === 0 && (
                            <div className="empty-state" style={{ margin: 'auto' }}>
                                <div className="empty-title">Start the conversation</div>
                                <div className="empty-desc">{ws.members.length > 1 ? 'Messages here are shared with everyone in this workspace.' : 'Add someone to this workspace to chat about shared spending.'}</div>
                            </div>
                        )}
                        <AnimatePresence initial={false}>
                            {grouped.map(item => 'divider' in item ? (
                                <div key={item.key} className="chat-day">{item.divider}</div>
                            ) : (
                                <motion.div key={item.id} layout className={`bubble ${item.user_id === me ? 'mine' : ''}`}
                                    initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: item.pending ? 0.6 : 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}>
                                    <span className="who">{item.sender_name}</span>
                                    {item.attachments?.length ? <MessageAttachments items={toItems(item)} urls={urls} onOpen={setViewing} /> : null}
                                    {item.body && <div>{item.body}</div>}
                                    <time style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        {(item.user_id === me || canManage) && !item.pending && (
                                            <button className="icon-btn" style={{ width: 20, height: 20, color: 'inherit', opacity: 0.7 }} aria-label="Delete message" onClick={() => deleteMessage(item.id)}><Trash2 size={12} /></button>
                                        )}
                                    </time>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                    <PendingFiles files={files} progress={progress} onRemove={i => setFiles(f => f.filter((_, j) => j !== i))} />
                    <div className="chat-compose">
                        <FilePicker onAdd={addFiles} disabled={progress != null} />
                        <textarea className="form-input" rows={1} placeholder={files.length ? 'Add a caption (optional)' : 'Write a message'} value={text} aria-label="Message"
                            onChange={e => setText(e.target.value)}
                            onPaste={e => { const f = Array.from(e.clipboardData.files || []); if (f.length) { e.preventDefault(); addFiles(f); } }}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                        <motion.button className="btn btn-primary btn-icon" style={{ width: 44, minHeight: 44 }} whileTap={{ scale: 0.9 }} onClick={send} disabled={(!text.trim() && !files.length) || progress != null} aria-label="Send"><Send size={18} /></motion.button>
                    </div>
                </section>

                <aside className="card chat-members" aria-label={side === 'gallery' ? 'Gallery' : 'Members'}>
                    <div className="seg side-tabs" role="tablist" aria-label="Side panel">
                        <button role="tab" aria-selected={side === 'members'} className={side === 'members' ? 'active' : ''} onClick={() => setSide('members')}><Users size={14} /> Members</button>
                        <button role="tab" aria-selected={side === 'gallery'} className={side === 'gallery' ? 'active' : ''} onClick={() => setSide('gallery')}><Images size={14} /> Gallery</button>
                        {showMembers && <button className="icon-btn" onClick={() => setShowMembers(false)} aria-label="Hide panel"><X size={16} /></button>}
                    </div>
                    {side === 'gallery' ? <ChatGallery items={gallery} urls={urls} loading={historyLoading} onOpen={setViewing} /> : <>
                    <div className="ledger">
                        {ws.members.map(m => (
                            <div key={m.uid} className="ledger-row" style={{ gridTemplateColumns: '32px minmax(0,1fr) auto', padding: '8px 0' }}>
                                <span className="user-avatar" style={{ width: 32, height: 32, fontSize: 13 }}>{(m.name || '?')[0].toUpperCase()}</span>
                                <div style={{ minWidth: 0 }}><div className="ledger-title" style={{ fontSize: 14 }}>{m.name}{m.uid === me ? ' (you)' : ''}</div><div className="ledger-sub">{m.role}</div></div>
                                {canManage && m.role !== 'owner' && m.uid !== me ? (
                                    <button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={async () => {
                                        if (!confirm(`Remove ${m.name}? They lose access to this workspace and its chat.`)) return;
                                        try { await removeMember(ws.id, m.uid); toast.success(`${m.name} removed`); } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); }
                                    }}><X size={15} style={{ color: 'var(--cinnabar)' }} /></button>
                                ) : <span />}
                            </div>
                        ))}
                    </div>
                    {canManage && (
                        <form onSubmit={addMember} className="mt-4">
                            <label className="form-label" htmlFor="chat-add">Add someone by email, phone or Zaylo ID</label>
                            <input id="chat-add" className="form-input mt-1" placeholder="Email, phone or ZY-XXXXXX" value={adding} onChange={e => setAdding(e.target.value)} />
                            <div className="flex gap-2 mt-2">
                                <select className="form-select" value={role} onChange={e => setRole(e.target.value as WorkspaceRole)} aria-label="Role"><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select>
                                <button className="btn btn-primary" disabled={!adding.trim()}><UserPlus size={16} /> Add</button>
                            </div>
                        </form>
                    )}
                    </>}
                </aside>
            </div>
            <AnimatePresence>{viewing && <Lightbox items={viewerItems} start={viewing} urls={urls} onClose={() => setViewing(null)} />}</AnimatePresence>
        </div>
    );
}
