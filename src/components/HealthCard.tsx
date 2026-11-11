import { tx } from '../i18n/translations';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertTriangle, MessageCircleQuestion } from 'lucide-react';
import { getHealthReport, type HealthReport } from '../services/zayloAI';
import { useStore } from '../store/useStore';
import { formatMoney } from '../constants';

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
                <div className="card-title">{tx('Money health')}</div>
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
                                    <div className="health-tip-title">{t.title}{t.saving ? <span className="health-saving">{tx('Could save about')} {formatMoney(t.saving, cur)} {tx('a month')}</span> : null}</div>
                                    <div className="health-tip-detail">{t.detail}</div>
                                </motion.li>
                            ))}
                        </ol>
                    )}
                    <p className="health-ai-note">{tx('Written by AI from this workspace\'s totals, budget, recent expenses, bills and savings goals. It can be wrong, and it is not financial advice.')} <Link to="/settings?section=ai">{tx('What is sent')}</Link></p>
                    {onAsk && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={onAsk}><MessageCircleQuestion size={15} />{' '}{tx('Ask Zaylo a question')}</button>}
                </motion.div>
            ) : (
                <div>
                    <p style={{ color: 'var(--ink-2)', fontSize: 14, marginBottom: 14 }}>{tx('Get a score for this cycle, a two-line read-out and three tips built from your own spending.')}</p>
                    <button className="btn btn-primary btn-sm" onClick={run} disabled={!hasData || loading}>{loading ? tx('Reading your month…') : tx('Check my money health')}</button>
                    {!hasData && <p className="text-xs text-muted mt-2">{tx('Add a few expenses first.')}</p>}
                </div>
            )}
            {error && <div className="auth-msg error" style={{ marginTop: 12, marginBottom: 0 }} role="alert">{error}</div>}
        </div>
    );
}

function ScoreRing({ score }: { score: number }) {
    const r = 34, c = 2 * Math.PI * r;
    const label = tx(score >= 80 ? 'Strong' : score >= 50 ? 'Steady' : 'Needs care');
    return (
        <div className="score-ring" role="img" aria-label={`Money health ${score} out of 100, ${label}`}>
            <svg width="84" height="84" viewBox="0 0 84 84">
                <circle cx="42" cy="42" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
                <motion.circle cx="42" cy="42" r={r} fill="none" stroke="var(--note)" strokeWidth="8" strokeLinecap="round"
                    transform="rotate(-90 42 42)" strokeDasharray={c}
                    initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} />
            </svg>
            <span className="score-num">{score}<small>{label}</small></span>
        </div>
    );
}
