import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { Mic, Square, X, RefreshCw } from 'lucide-react';
import { parseExpensesText } from '../services/aiExpenseParser';
import type { ParsedExpense } from '../services/aiExpenseParser';

interface VoiceExpenseEntryProps {
    onClose: () => void;
    onAdd: (expenses: ParsedExpense[]) => void;
}

const LANGUAGES = [
    { code: 'en-US', name: 'English', flag: '🇺🇸' },
    { code: 'ar-SA', name: 'Arabic', flag: '🇸🇦' },
    { code: 'es-ES', name: 'Spanish', flag: '🇪🇸' },
    { code: 'fr-FR', name: 'French', flag: '🇫🇷' },
    { code: 'de-DE', name: 'German', flag: '🇩🇪' },
    { code: 'it-IT', name: 'Italian', flag: '🇮🇹' },
    { code: 'ru-RU', name: 'Russian', flag: '🇷🇺' }
];

export default function VoiceExpenseEntry({ onClose, onAdd }: VoiceExpenseEntryProps) {
    const { user, currency } = useStore();
    const [lang, setLang] = useState(LANGUAGES.find(l => l.code.startsWith(user?.language ?? 'en'))?.code || 'en-US');
    const [transcript, setTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');
    const recognitionRef = useRef<any>(null);

    // Waveform visualizer states
    const [volume, setVolume] = useState(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const animationFrameRef = useRef<number>(0);

    const processTranscript = async (text: string) => {
        setIsProcessing(true);
        try {
            const expenses = await parseExpensesText(text, currency);
            onAdd(expenses);
        } catch (err: any) {
            setError(err.message || "Failed to process voice entry. Please try again.");
            setIsProcessing(false);
        }
    };

    const stopVisualizer = () => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (micStreamRef.current) micStreamRef.current.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) audioContextRef.current.close();
        setVolume(0);
    };

    const stopListening = async (process: boolean = true) => {
        setIsListening(false);
        recognitionRef.current?.stop();
        stopVisualizer();

        if (process && transcript.trim().length > 0) {
            processTranscript(transcript);
        }
    };

    useEffect(() => {
        // @ts-ignore
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setError("Your browser doesn't support Voice Expense Entry. Please try Chrome or Safari.");
            return;
        }
        
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = lang;

        recognition.onresult = (event: any) => {
            let finalOutput = '';
            for (let i = 0; i < event.results.length; i++) {
                finalOutput += event.results[i][0].transcript;
            }
            setTranscript(finalOutput);
        };

        recognition.onerror = (event: any) => {
            if (event.error === 'not-allowed') {
                setError('Microphone access denied. Please allow microphone access to use this feature.');
                stopListening(false);
            }
        };

        recognitionRef.current = recognition;

        return () => {
            if (isListening) stopListening(false);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lang]);

    const setupVisualizer = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            micStreamRef.current = stream;
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            analyserRef.current = audioContextRef.current.createAnalyser();
            const source = audioContextRef.current.createMediaStreamSource(stream);
            source.connect(analyserRef.current);
            analyserRef.current.fftSize = 256;
            
            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const updateVisualizer = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getByteFrequencyData(dataArray);
                const avg = dataArray.reduce((acc, val) => acc + val, 0) / bufferLength;
                setVolume(avg);
                animationFrameRef.current = requestAnimationFrame(updateVisualizer);
            };
            
            updateVisualizer();
        } catch (err) {
            console.error("Could not start visualizer", err);
        }
    };



    const startListening = async () => {
        setError('');
        setTranscript('');
        try {
            await setupVisualizer();
            recognitionRef.current?.start();
            setIsListening(true);
        } catch (err) {
            setError('Could not start microphone.');
        }
    };

    return (
        <div className="sheet-overlay">
            <div className="animate-slideUp" style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'var(--bg-surface)', borderTopLeftRadius: 'var(--radius-xl)', borderTopRightRadius: 'var(--radius-xl)',
                padding: '32px 24px', boxShadow: 'var(--shadow-lg)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                    <h3 style={{ fontSize: 20, fontWeight: 700 }}>Voice Entry</h3>
                    <button onClick={onClose} className="btn-ghost btn-icon"><X size={20} /></button>
                </div>

                {error ? (
                    <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 24, fontSize: 14 }}>
                        {error}
                        <button className="btn btn-sm btn-ghost" style={{ marginTop: 8, color: 'inherit' }} onClick={() => setError('')}>Try Again</button>
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 24, scrollbarWidth: 'none' }}>
                            {LANGUAGES.map(l => (
                                <button key={l.code} onClick={() => { setLang(l.code); recognitionRef.current.lang = l.code; }}
                                    style={{
                                        flexShrink: 0, padding: '6px 12px', borderRadius: 99, border: '1px solid var(--border-default)',
                                        background: lang === l.code ? 'var(--primary-soft)' : 'transparent',
                                        color: lang === l.code ? 'var(--accent)' : 'var(--text-secondary)',
                                        fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer'
                                    }}>
                                    <span>{l.flag}</span>
                                    <span>{l.name}</span>
                                </button>
                            ))}
                        </div>

                        <div style={{ minHeight: 120, background: 'var(--bg-input)', borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 24, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ flex: 1, fontSize: 16, color: transcript ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                {transcript || (isListening ? "Listening..." : "Tap the microphone and describe your expense...")}
                            </div>
                            
                            {/* Visualizer bars */}
                            {isListening && (
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', height: 40, alignItems: 'flex-end', marginTop: 16 }}>
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <div key={i} style={{
                                            width: 6, background: 'var(--accent)', borderRadius: 3,
                                            height: 4 + ((i * 1.5) * volume * 0.4) + 'px',
                                            transition: 'height 50ms ease'
                                        }} />
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                            {isProcessing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--accent)' }}>
                                    <RefreshCw size={32} className="animate-spin" />
                                    <span style={{ fontSize: 14, fontWeight: 500 }}>Extracting expenses...</span>
                                </div>
                            ) : isListening ? (
                                <button onClick={() => stopListening(true)}
                                    style={{
                                        width: 80, height: 80, borderRadius: 40, background: 'var(--danger-soft)', color: 'var(--danger)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none'
                                    }}>
                                    <Square size={32} fill="currentColor" />
                                </button>
                            ) : (
                                <button onClick={startListening}
                                    style={{
                                        width: 80, height: 80, borderRadius: 40, background: 'var(--accent)', color: '#fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none',
                                        boxShadow: '0 8px 24px var(--primary-soft)'
                                    }}>
                                    <Mic size={36} />
                                </button>
                            )}
                        </div>
                        
                        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                            {isProcessing ? "Powered by Claude AI" : isListening ? "Tap to finish" : "Supports multiple items. E.g. \"Coffee 5 dollars and lunch 12.50\""}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
