import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Mic, Square, Camera, Upload, FileText, Sparkles, MessageSquareText, RotateCcw } from 'lucide-react';
import { extractExpenses, AIError, type CaptureSource } from '../services/zayloAI';
import { parseLocally, type ParsedExpense } from '../services/aiExpenseParser';
import { useStore } from '../store/useStore';

export type CaptureMode = 'voice' | 'scan' | 'text';

interface Props {
    initialMode?: CaptureMode;
    onClose: () => void;
    /** Called with the expenses Zaylo found; the caller shows them for review before saving. */
    onResult: (expenses: ParsedExpense[], source: CaptureSource) => void;
}

const MODES: { key: CaptureMode; label: string; icon: typeof Mic }[] = [
    { key: 'voice', label: 'Say it', icon: Mic },
    { key: 'scan', label: 'Receipt', icon: Camera },
    { key: 'text', label: 'Paste text', icon: MessageSquareText },
];
const MAX_SECONDS = 60;

function pickAudioType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return types.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) || '';
}

/** One place to add expenses with Zaylo AI: speak, scan/upload a receipt or PDF, or paste a bank SMS. */
export default function SmartCapture({ initialMode = 'voice', onClose, onResult }: Props) {
    const [mode, setMode] = useState<CaptureMode>(initialMode);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [note, setNote] = useState('');

    async function run(source: CaptureSource, input: { text?: string; file?: Blob }) {
        setBusy(true); setError(''); setNote('');
        try {
            const r = await extractExpenses({ source, ...input });
            if (r.expenses.length) { onResult(r.expenses, source); return; }
            setNote(r.note || (r.transcript ? `Heard: “${r.transcript}”. No amount found — try saying how much and where.` : 'No expense found. Try a clearer photo or add more detail.'));
        } catch (e) {
            const err = e as AIError;
            // Text still works offline / without AI thanks to on-device rules.
            if (input.text && (err.status === 0 || err.status >= 500)) {
                const local = parseLocally(input.text, useStore.getState().currency);
                if (local.length) { onResult(local, source); return; }
            }
            setError(err.message || 'Something went wrong.');
        } finally { setBusy(false); }
    }

    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [busy, onClose]);

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <motion.div className="modal capture" role="dialog" aria-label="Add with Zaylo AI"
                initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
                <div className="modal-header">
                    <h2 className="modal-title capture-title"><Sparkles size={18} /> Add with Zaylo AI</h2>
                    <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X size={20} /></button>
                </div>

                <div className="segmented mb-4" role="tablist">
                    {MODES.map(m => (
                        <button key={m.key} type="button" role="tab" aria-pressed={mode === m.key} aria-selected={mode === m.key} disabled={busy}
                            onClick={() => { setMode(m.key); setError(''); setNote(''); }}>
                            {mode === m.key && <motion.span layoutId="cap-seg" className="seg-pill" />}
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><m.icon size={15} />{m.label}</span>
                        </button>
                    ))}
                </div>

                <AnimatePresence mode="wait">
                    <motion.div key={mode} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.16 }}>
                        {mode === 'voice' && <VoicePane busy={busy} onAudio={blob => run('voice', { file: blob })} onError={setError} />}
                        {mode === 'scan' && <ScanPane busy={busy} onFile={(f, src) => run(src, { file: f })} />}
                        {mode === 'text' && <TextPane busy={busy} onText={t => run('sms', { text: t })} />}
                    </motion.div>
                </AnimatePresence>

                {busy && (
                    <div className="capture-status" role="status">
                        <span className="capture-spark" aria-hidden="true" /> Reading it with Zaylo AI…
                    </div>
                )}
                {note && !busy && <div className="auth-msg" style={{ background: 'var(--amber-soft)', color: 'var(--amber)', marginTop: 14 }} role="status">{note}</div>}
                {error && !busy && <div className="auth-msg error" style={{ marginTop: 14 }} role="alert">{error}</div>}
                <p className="text-xs text-muted" style={{ marginTop: 14 }}>You'll review everything before it's saved.</p>
            </motion.div>
        </div>
    );
}

// ───────────────────────── Voice ─────────────────────────
function VoicePane({ busy, onAudio, onError }: { busy: boolean; onAudio: (b: Blob) => void; onError: (m: string) => void }) {
    const [recording, setRecording] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [level, setLevel] = useState(0);
    const rec = useRef<MediaRecorder | null>(null);
    const stream = useRef<MediaStream | null>(null);
    const raf = useRef(0);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);
    const ctx = useRef<AudioContext | null>(null);

    const cleanup = () => {
        cancelAnimationFrame(raf.current);
        if (timer.current) clearInterval(timer.current);
        stream.current?.getTracks().forEach(t => t.stop());
        ctx.current?.close().catch(() => undefined);
        stream.current = null; ctx.current = null;
        setLevel(0);
    };
    useEffect(() => () => { if (rec.current?.state === 'recording') rec.current.stop(); cleanup(); }, []);

    async function start() {
        onError('');
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            onError('This browser can\'t record audio. Use Paste text instead.');
            return;
        }
        try {
            stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch {
            onError('Allow microphone access to add expenses by voice.');
            return;
        }
        const type = pickAudioType();
        const chunks: BlobPart[] = [];
        const r = new MediaRecorder(stream.current, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
        r.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        r.onstop = () => {
            const blob = new Blob(chunks, { type: r.mimeType || type || 'audio/webm' });
            cleanup();
            setRecording(false);
            if (blob.size > 1500) onAudio(blob); else onError('That was too short. Hold on and say the amount and where.');
        };
        r.start();
        rec.current = r;
        setRecording(true);
        setSeconds(0);
        timer.current = setInterval(() => setSeconds(s => {
            if (s + 1 >= MAX_SECONDS && r.state === 'recording') r.stop();
            return s + 1;
        }), 1000);
        try {
            ctx.current = new AudioContext();
            const analyser = ctx.current.createAnalyser();
            analyser.fftSize = 256;
            ctx.current.createMediaStreamSource(stream.current).connect(analyser);
            const buf = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => { analyser.getByteFrequencyData(buf); setLevel(buf.reduce((a, b) => a + b, 0) / buf.length / 128); raf.current = requestAnimationFrame(tick); };
            tick();
        } catch { /* level meter is optional */ }
    }
    const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };

    return (
        <div className="capture-pane" style={{ textAlign: 'center' }}>
            <p className="capture-hint">Say what you spent, in Arabic or English.<br /><span>“Lunch at Zooba 240 pounds and Uber 85 yesterday”</span></p>
            <button type="button" className={`mic-btn ${recording ? 'on' : ''}`} onClick={recording ? stop : start} disabled={busy}
                aria-label={recording ? 'Stop recording' : 'Start recording'} style={{ ['--level' as string]: Math.min(1, level).toFixed(2) }}>
                {recording ? <Square size={26} fill="currentColor" /> : <Mic size={30} />}
            </button>
            <div className="capture-meta">{recording ? `Listening… ${seconds}s · tap to finish` : busy ? '' : 'Tap to start'}</div>
        </div>
    );
}

// ───────────────────────── Scan / upload ─────────────────────────
function ScanPane({ busy, onFile }: { busy: boolean; onFile: (f: File, source: 'scan' | 'upload') => void }) {
    const camera = useRef<HTMLInputElement>(null);
    const upload = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState<{ url?: string; name: string } | null>(null);
    const [drag, setDrag] = useState(false);

    function take(f: File | undefined, source: 'scan' | 'upload') {
        if (!f) return;
        if (preview?.url) URL.revokeObjectURL(preview.url);
        setPreview({ url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined, name: f.name });
        onFile(f, source);
    }

    return (
        <div className="capture-pane">
            <div className={`drop ${drag ? 'over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files?.[0], 'upload'); }}>
                {preview ? (
                    <div className="drop-preview">
                        {preview.url ? <img src={preview.url} alt="Receipt to read" /> : <FileText size={40} />}
                        <span>{preview.name}</span>
                    </div>
                ) : (
                    <>
                        <p className="capture-hint" style={{ marginBottom: 14 }}>Photograph a receipt, or upload a photo, screenshot or PDF invoice.</p>
                        <div className="drop-actions">
                            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => camera.current?.click()}><Camera size={17} /> Take a photo</button>
                            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => upload.current?.click()}><Upload size={17} /> Upload file</button>
                        </div>
                        <p className="text-xs text-muted" style={{ marginTop: 12 }}>Or drop a file here · JPG, PNG, HEIC or PDF up to 3 MB</p>
                    </>
                )}
            </div>
            {preview && !busy && <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setPreview(null)}><RotateCcw size={14} /> Use another file</button>}
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => { take(e.target.files?.[0], 'scan'); e.target.value = ''; }} />
            <input ref={upload} type="file" accept="image/*,application/pdf" hidden onChange={e => { take(e.target.files?.[0], 'upload'); e.target.value = ''; }} />
        </div>
    );
}

// ───────────────────────── Text ─────────────────────────
function TextPane({ busy, onText }: { busy: boolean; onText: (t: string) => void }) {
    const [text, setText] = useState('');
    return (
        <form className="capture-pane" onSubmit={e => { e.preventDefault(); if (text.trim()) onText(text.trim()); }}>
            <label className="form-label" htmlFor="cap-text">Bank SMS, wallet notification or a quick note</label>
            <textarea id="cap-text" className="form-input" rows={5} value={text} onChange={e => setText(e.target.value)} disabled={busy}
                placeholder={'Paste one or more messages, e.g.\nPurchase of EGP 450.00 at CARREFOUR MAADI on 04/11 using card **1234'} />
            <button className="btn btn-primary w-full" style={{ marginTop: 12 }} disabled={busy || !text.trim()}><Sparkles size={16} /> Read it</button>
        </form>
    );
}
