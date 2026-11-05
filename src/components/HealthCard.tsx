import { tx } from '../i18n/translations';
import { useEffect, useId, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, RefreshCw, AlertTriangle, MessageCircleQuestion } from 'lucide-react';
import { getHealthReport, type HealthReport } from '../services/zayloAI';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../constants';

const cacheKey = (ws: string) => `zaylo_health_${ws}`;

function readCache(ws: string): { at: number; report: HealthReport } | null {
    try { const raw = localStorage.getItem(cacheKey(ws)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** AI money-health summary: score, a short read-out, three tips and any alerts. Cached for the day. */
export default function HealthCard({ onAsk, compact = false }: { onAsk?: () => void; compact?: boolean }) {
    const { activeWorkspaceId, expenses, workspaces, currency } = useStore();
    const ws = workspaces.find(w => w.id === activeWorkspaceId);
    const cur = ws?.currency || currency;
    const hasData = expenses.some(e => e.workspaceId === activeWorkspaceId && !e.deleted);
    const [report, setReport] = useState<HealthReport | null>(() => readCache(activeWorkspaceId)?.report ?? null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { setReport(readCache(activeWorkspaceId)?.report ?? null); setError(''); }, [activeWorkspaceId]);

    async function run() {
        setLoading(true); setError('');
        try {
            const r = await getHealthReport();
            setReport(r);
            try { localStorage.setItem(cacheKey(activeWorkspaceId), JSON.stringify({ at: Date.now(), report: r })); } catch { /* optional */ }
        } catch (e) { setError(e instanceof Error ? e.message : 'Couldn\'t get your summary.'); }
        finally { setLoading(false); }
    }

    return (
        <div className="card health-card">
            <div className="card-head">
                <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={17} style={{ color: 'var(--brass)' }} />{' '}{tx('Money health')}</div>
                {report && <button onClick={run} disabled={loading} className="btn btn-ghost btn-sm btn-icon" aria-label={tx('Refresh summary')}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>}
            </div>

            {loading && !report ? (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div className="skeleton" style={{ width: 84, height: 84, borderRadius: '50%' }} />
                    <div style={{ flex: 1, display: 'grid', gap: 8 }}>
                        <div className="skeleton" style={{ height: 16, width: '70%' }} />
                        <div className="skeleton" style={{ height: 12, width: '95%' }} />
                        <div className="skeleton" style={{ height: 12, width: '80%' }} />
                    </div>
                </div>
            ) : report ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: loading ? 0.5 : 1 }}>
                    <div className="health-top">
                        <ScoreRing score={report.score} />
                        <div style={{ minWidth: 0 }}>
                            <div className="health-headline">{report.headline}</div>
                            <p className="health-summary">{report.summary}</p>
                        </div>
                    </div>
                    {report.alerts?.length > 0 && (
                        <ul className="health-alerts">
                            {report.alerts.map((a, i) => <li key={i}><AlertTriangle size={14} />{a}</li>)}
                        </ul>
                    )}
                    {!compact && (
                        <ol className="health-tips">
                            {report.tips.map((t, i) => (
                                <motion.li key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.07 }}>
                                    <div className="health-tip-title">{t.title}{t.saving ? <span className="health-saving">{tx('save ~')}{formatCurrency(t.saving, cur)}/mo</span> : null}</div>
                                    <div className="health-tip-detail">{t.detail}</div>
                                </motion.li>
                            ))}
                        </ol>
                    )}
                    {onAsk && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={onAsk}><MessageCircleQuestion size={15} />{' '}{tx('Ask Zaylo a question')}</button>}
                </motion.div>
            ) : (
                <div>
                    <p style={{ color: 'var(--ink-2)', fontSize: 14, marginBottom: 14 }}>{tx('Get a score for this cycle, a two-line read-out and three tips built from your own spending.')}</p>
                    <button className="btn btn-primary btn-sm" onClick={run} disabled={!hasData || loading}><Sparkles size={15} /> {loading ? tx('Reading your month…') : tx('Check my money health')}</button>
                    {!hasData && <p className="text-xs text-muted mt-2">{tx('Add a few expenses first.')}</p>}
                </div>
            )}
            {error && <div className="auth-msg error" style={{ marginTop: 12, marginBottom: 0 }} role="alert">{error}</div>}
        </div>
    );
}

function ScoreRing({ score }: { score: number }) {
    const id = useId().replace(/:/g, '');
    const r = 34, c = 2 * Math.PI * r;
    const label = score >= 80 ? 'Strong' : score >= 50 ? 'Steady' : 'Needs care';
    return (
        <div className="score-ring" role="img" aria-label={`Money health ${score} out of 100, ${label}`}>
            <svg width="84" height="84" viewBox="0 0 84 84">
                <defs><linearGradient id={`sr${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22D3EE" /><stop offset=".45" stopColor="#2563FF" /><stop offset="1" stopColor="#7C3AED" /></linearGradient></defs>
                <circle cx="42" cy="42" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
                <motion.circle cx="42" cy="42" r={r} fill="none" stroke={`url(#sr${id})`} strokeWidth="8" strokeLinecap="round"
                    transform="rotate(-90 42 42)" strokeDasharray={c}
                    initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
            </svg>
            <span className="score-num">{score}<small>{label}</small></span>
        </div>
    );
}
