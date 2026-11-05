import { tx } from '../../i18n/translations';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Download, FileText, File as FileIcon, Film, Image as ImageIcon, Music, Paperclip, X } from 'lucide-react';
import { kindOf, formatBytes, signedUrls, downloadUrl, ACCEPT, type Attachment } from '../../services/chatFiles';

/** An attachment as shown in a chat, with who sent it and when. */
export interface GalleryItem extends Attachment { messageId: string; sender: string; createdAt: string; localUrl?: string }

/** Resolves signed URLs for the given attachments; local previews win while uploading. */
export function useAttachmentUrls(items: { path: string; localUrl?: string }[]) {
    const [urls, setUrls] = useState<Record<string, string>>({});
    const key = items.filter(i => !i.localUrl).map(i => i.path).sort().join('|');
    useEffect(() => {
        let alive = true;
        const paths = key ? key.split('|') : [];
        if (!paths.length) return;
        signedUrls(paths).then(u => { if (alive) setUrls(prev => ({ ...prev, ...u })); }).catch(() => {});
        return () => { alive = false; };
    }, [key]);
    return useMemo(() => {
        const out = { ...urls };
        items.forEach(i => { if (i.localUrl) out[i.path] = i.localUrl; });
        return out;
    }, [urls, items]);
}

const KindIcon = ({ a, size = 18 }: { a: Attachment; size?: number }) => {
    const k = kindOf(a);
    if (k === 'image') return <ImageIcon size={size} />;
    if (k === 'video') return <Film size={size} />;
    if (k === 'audio') return <Music size={size} />;
    if (k === 'pdf') return <FileText size={size} />;
    return <FileIcon size={size} />;
};

/** Attachments inside a message bubble. */
export function MessageAttachments({ items, urls, onOpen }: { items: GalleryItem[]; urls: Record<string, string>; onOpen: (path: string) => void }) {
    if (!items.length) return null;
    const media = items.filter(a => ['image', 'video'].includes(kindOf(a)));
    const other = items.filter(a => !['image', 'video'].includes(kindOf(a)));
    return (
        <div className="msg-files">
            {media.length > 0 && (
                <div className={`msg-media count-${Math.min(media.length, 4)}`}>
                    {media.slice(0, 4).map((a, i) => (
                        <button type="button" key={a.path} className="msg-media-item" onClick={() => onOpen(a.path)} aria-label={`Open ${a.name}`}>
                            {urls[a.path] ? (kindOf(a) === 'image'
                                ? <img src={urls[a.path]} alt={a.name} loading="lazy" />
                                : <><video src={urls[a.path]} preload="metadata" muted playsInline /><span className="play-badge"><Film size={14} /></span></>)
                                : <span className="media-ph"><KindIcon a={a} /></span>}
                            {i === 3 && media.length > 4 && <span className="more-badge">+{media.length - 4}</span>}
                        </button>
                    ))}
                </div>
            )}
            {other.map(a => kindOf(a) === 'audio' && urls[a.path] ? (
                <audio key={a.path} controls src={urls[a.path]} preload="none" className="msg-audio" />
            ) : (
                <button type="button" key={a.path} className="file-card" onClick={() => onOpen(a.path)}>
                    <span className={`file-ico k-${kindOf(a)}`}><KindIcon a={a} /></span>
                    <span className="file-meta"><span className="file-name">{a.name}</span><span className="file-size">{kindOf(a) === 'pdf' ? 'PDF' : (a.name.split('.').pop() || tx('File')).toUpperCase()} · {formatBytes(a.size)}</span></span>
                </button>
            ))}
        </div>
    );
}

/** Full-screen viewer for one attachment with previous/next across the chat. */
export function Lightbox({ items, start, urls, onClose }: { items: GalleryItem[]; start: string; urls: Record<string, string>; onClose: () => void }) {
    const [idx, setIdx] = useState(() => Math.max(0, items.findIndex(i => i.path === start)));
    const a = items[idx];
    const closeRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') setIdx(i => Math.min(items.length - 1, i + 1));
            if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [items.length, onClose]);
    if (!a) return null;
    const url = urls[a.path];
    const k = kindOf(a);
    return (
        <motion.div className="lightbox" role="dialog" aria-modal="true" aria-label={a.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <header className="lightbox-bar">
                <div className="lightbox-title"><strong>{a.name}</strong><span>{a.sender} · {new Date(a.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {formatBytes(a.size)}</span></div>
                {url && <a className="icon-btn" href={downloadUrl(url, a.name)} aria-label={tx('Download')}><Download size={18} /></a>}
                <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label={tx('Close')}><X size={20} /></button>
            </header>
            <div className="lightbox-stage" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
                {!url ? <div className="media-ph big"><KindIcon a={a} size={40} /></div>
                    : k === 'image' ? <img src={url} alt={a.name} />
                    : k === 'video' ? <video src={url} controls autoPlay playsInline />
                    : k === 'audio' ? <audio src={url} controls autoPlay />
                    : k === 'pdf' ? <iframe src={url} title={a.name} />
                    : <div className="lightbox-file"><span className={`file-ico k-${k}`}><KindIcon a={a} size={32} /></span><p>{tx('No preview for this file type.')}</p><a className="btn btn-primary" href={downloadUrl(url, a.name)}><Download size={16} />{' '}{tx('Download')}</a></div>}
            </div>
            {items.length > 1 && <>
                <button className="lightbox-nav prev" disabled={idx === 0} onClick={() => setIdx(i => i - 1)} aria-label={tx('Previous')}><ChevronLeft size={26} /></button>
                <button className="lightbox-nav next" disabled={idx === items.length - 1} onClick={() => setIdx(i => i + 1)} aria-label={tx('Next')}><ChevronRight size={26} /></button>
                <div className="lightbox-count">{idx + 1} / {items.length}</div>
            </>}
        </motion.div>
    );
}

/** Media / Files / Links-free gallery of everything shared in one chat. */
export function ChatGallery({ items, urls, loading, onOpen, onClose }: { items: GalleryItem[]; urls: Record<string, string>; loading?: boolean; onOpen: (path: string) => void; onClose?: () => void }) {
    const [tab, setTab] = useState<'media' | 'files'>('media');
    const media = items.filter(a => ['image', 'video'].includes(kindOf(a)));
    const files = items.filter(a => !['image', 'video'].includes(kindOf(a)));
    const list = tab === 'media' ? media : files;
    const byMonth = useMemo(() => {
        const m = new Map<string, GalleryItem[]>();
        list.forEach(a => { const k = new Date(a.createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); m.set(k, [...(m.get(k) || []), a]); });
        return [...m.entries()];
    }, [list]);
    return (
        <div className="chat-gallery">
            <div className="card-head">
                <div className="card-title">{tx('Gallery')}</div>
                {onClose && <button className="icon-btn" onClick={onClose} aria-label={tx('Close gallery')}><X size={16} /></button>}
            </div>
            <div className="seg" role="tablist" aria-label={tx('Gallery type')}>
                <button role="tab" aria-selected={tab === 'media'} className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>{tx('Photos & videos')}{' '}<span>{media.length}</span></button>
                <button role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>{tx('Files')}{' '}<span>{files.length}</span></button>
            </div>
            <div className="gallery-scroll">
                {loading && !items.length && <div className="skeleton" style={{ height: 120 }} />}
                {!loading && list.length === 0 && (
                    <div className="gallery-empty">
                        <Paperclip size={20} />
                        <p>{tab === 'media' ? tx('Photos and videos shared in this chat appear here.') : tx('PDFs, documents and other files shared here appear in this list.')}</p>
                    </div>
                )}
                {byMonth.map(([month, group]) => (
                    <section key={month}>
                        <h4 className="gallery-month">{month}</h4>
                        {tab === 'media' ? (
                            <div className="gallery-grid">
                                {group.map(a => (
                                    <button key={a.path} type="button" className="gallery-cell" onClick={() => onOpen(a.path)} aria-label={`Open ${a.name}`}>
                                        {urls[a.path] ? (kindOf(a) === 'image' ? <img src={urls[a.path]} alt="" loading="lazy" /> : <><video src={urls[a.path]} preload="metadata" muted playsInline /><span className="play-badge"><Film size={12} /></span></>) : <span className="media-ph"><KindIcon a={a} /></span>}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="gallery-files">
                                {group.map(a => (
                                    <button key={a.path} type="button" className="file-card" onClick={() => onOpen(a.path)}>
                                        <span className={`file-ico k-${kindOf(a)}`}><KindIcon a={a} /></span>
                                        <span className="file-meta"><span className="file-name">{a.name}</span><span className="file-size">{a.sender} · {formatBytes(a.size)}</span></span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                ))}
            </div>
        </div>
    );
}

/** Paperclip button + the row of files waiting to be sent. */
export function FilePicker({ onAdd, disabled }: { onAdd: (files: File[]) => void; disabled?: boolean }) {
    const input = useRef<HTMLInputElement>(null);
    return (
        <>
            <button type="button" className="icon-btn attach-btn" onClick={() => input.current?.click()} disabled={disabled} aria-label={tx('Attach files')} title={tx('Attach photos, videos or files')}><Paperclip size={19} /></button>
            <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={e => { const f = Array.from(e.target.files || []); if (f.length) onAdd(f); e.target.value = ''; }} />
        </>
    );
}

export function PendingFiles({ files, onRemove, progress }: { files: File[]; onRemove: (i: number) => void; progress?: number | null }) {
    const previews = useMemo(() => files.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')), [files]);
    useEffect(() => () => previews.forEach(u => u && URL.revokeObjectURL(u)), [previews]);
    return (
        <AnimatePresence>
            {files.length > 0 && (
                <motion.div className="pending-files" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    {files.map((f, i) => (
                        <div key={i + f.name} className="pending-file">
                            {previews[i] ? <img src={previews[i]} alt="" /> : <span className={`file-ico k-${kindOf(f)}`}><KindIcon a={{ path: '', name: f.name, type: f.type, size: f.size }} size={16} /></span>}
                            <span className="pending-name">{f.name}<small>{formatBytes(f.size)}</small></span>
                            {progress == null && <button type="button" className="icon-btn" onClick={() => onRemove(i)} aria-label={`Remove ${f.name}`}><X size={14} /></button>}
                        </div>
                    ))}
                    {progress != null && <div className="pending-progress" role="status">{tx('Uploading')}{' '}{progress} of {files.length}…</div>}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
