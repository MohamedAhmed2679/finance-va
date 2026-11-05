import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileSpreadsheet, FileText, X, Receipt, CalendarClock, Wallet, Check } from 'lucide-react';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import type { ReportSection } from '../reports/report';
import { buildReportFile, deliverFile, periodRange, reportInputFromStore, type PeriodKey } from '../services/reports';

const SECTIONS: { key: ReportSection; label: string; icon: typeof Receipt }[] = [
    { key: 'expenses', label: 'Expenses', icon: Receipt },
    { key: 'bills', label: 'Bills & Commitments', icon: CalendarClock },
    { key: 'income', label: 'Income', icon: Wallet },
];
const PERIODS: { key: PeriodKey; label: string }[] = [
    { key: 'this_month', label: 'This month' },
    { key: 'last_month', label: 'Last month' },
    { key: 'this_year', label: 'This year' },
    { key: 'all', label: 'All time' },
    { key: 'custom', label: 'Custom' },
];

/** Pick what goes into a report and download it as Excel or PDF. */
export default function ReportSheet({ initial, onClose }: { initial?: ReportSection[]; onClose: () => void }) {
    const lang = useStore(s => s.user?.language ?? 'en');
    const ws = useStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId) || s.workspaces[0]);
    const [sections, setSections] = useState<ReportSection[]>(initial?.length ? initial : ['expenses', 'bills', 'income']);
    const [period, setPeriod] = useState<PeriodKey>('this_month');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [busy, setBusy] = useState<'' | 'xlsx' | 'pdf'>('');

    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onClose]);

    const toggle = (k: ReportSection) => setSections(s => (s.includes(k) ? s.filter(x => x !== k) : [...s, k]));
    const range = periodRange(period, lang, { from, to });
    const badRange = period === 'custom' && from && to && from > to;

    async function make(format: 'xlsx' | 'pdf') {
        if (!sections.length || badRange) return;
        setBusy(format);
        try {
            const ordered = SECTIONS.map(s => s.key).filter(k => sections.includes(k));
            const file = await buildReportFile(reportInputFromStore(ordered, range), format);
            const how = await deliverFile(file);
            if (how === 'downloaded') toast.success(tx('Report downloaded'));
            if (how === 'shared') toast.success(tx('Report ready'));
        } catch (e) {
            console.error('[report]', e);
            toast.error(tx('Couldn\'t create the report. Try again.'));
        } finally { setBusy(''); }
    }

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal report-sheet animate-slideUp" role="dialog" aria-modal="true" aria-labelledby="report-title">
                <div className="sheet-grip" aria-hidden />
                <div className="modal-header">
                    <div>
                        <h2 className="modal-title" id="report-title">{tx('Create a report')}</h2>
                        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
                            <span translate="no">{ws?.name}</span>{' · '}{tx('Amounts in')}{' '}{ws?.currency}
                        </div>
                    </div>
                    <button className="modal-close" onClick={onClose} aria-label={tx('Close')}><X size={20} /></button>
                </div>

                <div className="report-label">{tx('Include')}</div>
                <div className="report-sections">
                    {SECTIONS.map(s => {
                        const on = sections.includes(s.key);
                        const Icon = s.icon;
                        return (
                            <button key={s.key} type="button" className={`report-section${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(s.key)}>
                                <Icon size={18} />
                                <span>{tx(s.label)}</span>
                                <span className="report-check" aria-hidden>{on && <Check size={13} strokeWidth={3} />}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="report-label">{tx('Period')}</div>
                <div className="report-periods" role="radiogroup" aria-label={tx('Period')}>
                    {PERIODS.map(p => (
                        <button key={p.key} type="button" role="radio" aria-checked={period === p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>
                            {tx(p.label)}
                        </button>
                    ))}
                </div>
                {period === 'custom' && (
                    <div className="report-dates">
                        <label><span>{tx('From')}</span><input type="date" className="form-input" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
                        <label><span>{tx('To')}</span><input type="date" className="form-input" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
                    </div>
                )}
                <div className="report-period-note">{badRange ? tx('The start date is after the end date.') : range.label}</div>

                <div className="report-actions">
                    <button className="btn btn-secondary" disabled={!sections.length || !!busy || !!badRange} onClick={() => make('xlsx')}>
                        <FileSpreadsheet size={18} />{busy === 'xlsx' ? tx('Creating…') : tx('Download Excel')}
                    </button>
                    <button className="btn btn-primary" disabled={!sections.length || !!busy || !!badRange} onClick={() => make('pdf')}>
                        <FileText size={18} />{busy === 'pdf' ? tx('Creating…') : tx('Download PDF')}
                    </button>
                </div>
                {!sections.length && <div className="report-period-note" style={{ color: 'var(--danger)' }}>{tx('Choose at least one section.')}</div>}
            </div>
        </div>
    );
}
