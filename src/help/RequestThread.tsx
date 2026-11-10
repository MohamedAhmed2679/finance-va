import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Send } from 'lucide-react';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import { supabase } from '../lib/supabase';
import { FilePicker, Lightbox, MessageAttachments, PendingFiles, type GalleryItem } from '../components/chat/Attachments';
import { useAttachmentUrls } from '../components/chat/useAttachmentUrls';
import { STATUS_LABEL, categoryLabel, checkSupportFiles, closeRequest, getRequest, listMessages, reopenRequest, sendReply, SEVERITIES, type SupportMessage, type SupportRequest } from '../services/support';
import { fmtDateTime } from './format';

export function StatusBadge({ status }: { status: SupportRequest['status'] }) {
    const tone = status === 'open' ? 'badge-primary' : status === 'waiting_on_you' ? 'badge-warning' : status === 'resolved' ? 'badge-success' : '';
    return <span className={`badge ${tone}`}>{tx(STATUS_LABEL[status])}</span>;
}

const toItems = (m: SupportMessage): GalleryItem[] => (m.attachments || []).map(a => ({ ...a, messageId: m.id, sender: m.from_admin ? 'Zaylo team' : 'You', createdAt: m.created_at }));

/** One support request: its details, the conversation, and close / reopen. requestId null = the earlier free-form conversation. */
export default function RequestThread({ requestId }: { requestId: string | null }) {
    const user = useStore(s => s.user);
    const lang = user?.language ?? 'en';
    const me = user?.dbId;
    const [req, setReq] = useState<SupportRequest | null>(null);
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [state, setState] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
    const [text, setText] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [progress, setProgress] = useState<number | null>(null);
    const [sending, setSending] = useState(false);
    const [confirmClose, setConfirmClose] = useState(false);
    const [viewing, setViewing] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const items = useMemo(() => messages.flatMap(toItems), [messages]);
    const urls = useAttachmentUrls(items);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let alive = true;
         
        setState('loading');
        (async () => {
            try {
                const [r, m] = await Promise.all([requestId ? getRequest(requestId) : Promise.resolve(null), listMessages(requestId)]);
                if (!alive) return;
                if (requestId && !r) { setState('missing'); return; }
                setReq(r); setMessages(m); setState('ready');
            } catch { if (alive) setState('error'); }
        })();
        if (!supabase || !me) return () => { alive = false; };
        const channel = supabase.channel(`support:${me}:${requestId || 'legacy'}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `user_id=eq.${me}` }, p => {
                const m = p.new as SupportMessage;
                if ((m.request_id || null) !== requestId) return;
                setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
                if (requestId) getRequest(requestId).then(r => { if (alive && r) setReq(r); }).catch(() => {});
            })
            .subscribe();
        return () => { alive = false; supabase?.removeChannel(channel); };
    }, [requestId, me, attempt]);

    useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length]);

    function addFiles(list: File[]) {
        const next = [...files, ...list];
        const problem = checkSupportFiles(next);
        if (problem) { toast.error(tx(problem)); return; }
        setFiles(next);
    }

    async function send() {
        const body = text.trim();
        if ((!body && !files.length) || !me || sending) return;
        const id = crypto.randomUUID();
        const sendingFiles = files;
        setSending(true);
        if (sendingFiles.length) setProgress(0);
        try {
            const attachments = await sendReply(requestId, id, body, sendingFiles, n => setProgress(n));
            setMessages(prev => prev.some(m => m.id === id) ? prev : [...prev, { id, user_id: me, request_id: requestId, from_admin: false, sender_name: user?.name || '', body, created_at: new Date().toISOString(), read_at: null, attachments }]);
            setText(''); setFiles([]);
            if (requestId) getRequest(requestId).then(r => r && setReq(r)).catch(() => {});
        } catch (e) { toast.error(e instanceof Error ? tx(e.message) : tx('Message didn\'t send. Try again.')); }   // the text stays in the box
        finally { setSending(false); setProgress(null); }
    }

    async function close() {
        if (!req) return;
        try { await closeRequest(req.id); setReq({ ...req, status: 'closed', closed_at: new Date().toISOString() }); setConfirmClose(false); toast.success(tx('Request closed. You can reopen it if you need to.')); }
        catch (e) { toast.error(e instanceof Error ? tx(e.message) : tx('The request couldn\'t be closed. Try again.')); }
    }
    async function reopen() {
        if (!req) return;
        try { await reopenRequest(req.id); setReq({ ...req, status: 'open', closed_at: null }); toast.success(tx('Request reopened.')); }
        catch (e) { toast.error(e instanceof Error ? tx(e.message) : tx('The request couldn\'t be reopened. Try again.')); }
    }

    if (state === 'loading') return <div className="card" aria-busy="true"><div className="skeleton" style={{ height: 22, width: '45%', marginBottom: 12 }} /><div className="skeleton" style={{ height: 14, width: '70%', marginBottom: 8 }} /><div className="skeleton" style={{ height: 120 }} /></div>;
    if (state === 'missing') return <div className="card"><div className="empty-state"><div className="empty-title">{tx('This request doesn\'t exist')}</div><div className="empty-desc">{tx('It may belong to a different account.')}</div></div></div>;
    if (state === 'error') return <div className="card"><div className="empty-state"><div className="empty-title">{tx('This request couldn\'t be loaded')}</div><div className="empty-desc">{tx('Check your connection and try again.')}</div><button className="btn btn-secondary mt-4" onClick={() => setAttempt(a => a + 1)}>{tx('Try again')}</button></div></div>;

    const closed = req?.status === 'closed';
    return (
        <div className="help-thread">
            {req && (
                <section className="card help-req-head" aria-label={tx('Request details')}>
                    <div className="help-req-title">
                        <h2><span className="help-req-number" translate="no">#{req.number}</span> <span translate="no">{req.subject}</span></h2>
                        <StatusBadge status={req.status} />
                    </div>
                    <dl className="help-meta">
                        <div><dt>{tx('Category')}</dt><dd>{tx(categoryLabel(req.category))}{req.confidential ? ` · ${tx('Confidential')}` : ''}</dd></div>
                        <div><dt>{tx('Severity')}</dt><dd>{tx(SEVERITIES.find(s => s.key === req.severity)?.label || req.severity)}</dd></div>
                        <div><dt>{tx('Created')}</dt><dd>{fmtDateTime(req.created_at, lang)}</dd></div>
                        <div><dt>{tx('Last update')}</dt><dd>{fmtDateTime(req.updated_at, lang)}</dd></div>
                    </dl>
                    <div className="help-req-actions">
                        {closed || req.status === 'resolved'
                            ? <button className="btn btn-secondary btn-sm" onClick={reopen}>{tx('Reopen request')}</button>
                            : confirmClose
                                ? <><span className="text-sm">{tx('Close this request?')}</span><button className="btn btn-secondary btn-sm" onClick={() => setConfirmClose(false)}>{tx('Keep open')}</button><button className="btn btn-primary btn-sm" onClick={close}>{tx('Close request')}</button></>
                                : <button className="btn btn-secondary btn-sm" onClick={() => setConfirmClose(true)}>{tx('Close request')}</button>}
                    </div>
                </section>
            )}

            <section className="card chat-panel help-chat" aria-label={tx('Conversation')}>
                <div className="chat-scroll" ref={scrollRef} aria-live="polite">
                    {messages.length === 0 && <div className="empty-state" style={{ margin: 'auto' }}><div className="empty-desc">{tx('No messages yet.')}</div></div>}
                    {messages.map(m => (
                        <div key={m.id} translate="no" className={`bubble ${m.from_admin ? '' : 'mine'}`}>
                            {m.from_admin && <span className="who">{tx('Zaylo team')}</span>}
                            {m.attachments?.length ? <MessageAttachments items={toItems(m)} urls={urls} onOpen={setViewing} /> : null}
                            {m.body && <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}
                            <time dateTime={m.created_at}>{fmtDateTime(m.created_at, lang)}</time>
                        </div>
                    ))}
                </div>
                {closed ? (
                    <p className="help-closed-note">{tx('This request is closed. Reopen it to send another message.')}</p>
                ) : (
                    <>
                        <PendingFiles files={files} progress={progress} onRemove={i => setFiles(f => f.filter((_, j) => j !== i))} />
                        <div className="chat-compose">
                            <FilePicker onAdd={addFiles} disabled={sending} />
                            <textarea className="form-input" rows={1} placeholder={tx('Write a reply')} value={text} aria-label={tx('Reply')} maxLength={4000}
                                onChange={e => setText(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                            <button className="btn btn-primary btn-icon" style={{ width: 44, minHeight: 44 }} onClick={send} disabled={(!text.trim() && !files.length) || sending} aria-label={tx('Send')}><Send size={18} /></button>
                        </div>
                    </>
                )}
            </section>
            {viewing && <Lightbox items={items} start={viewing} urls={urls} onClose={() => setViewing(null)} />}
        </div>
    );
}
