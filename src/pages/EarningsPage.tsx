import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useStore } from '../store/useStore';
import { t, tx } from '../i18n/translations';
import { getActiveCycleDates } from '../constants';
import { Briefcase, Plus, Trash2, CalendarRange, TrendingUp, TrendingDown, FileDown } from 'lucide-react';
import ReportSheet from '../components/ReportSheet';
import { format } from 'date-fns';
import { preloadRates } from '../services/exchangeRates';
import { toBase } from '../utils/money';
import { CURRENCIES } from '../constants';
import ConversionHint from '../components/ConversionHint';
import CurrencyDisplay from '../components/CurrencyDisplay';

const INCOME_SUGGESTIONS: { name: string; type: 'fixed' | 'variable' }[] = [
    { name: 'Salary', type: 'fixed' },
    { name: 'Freelance', type: 'variable' },
    { name: 'Bonus', type: 'variable' },
    { name: 'Rent income', type: 'fixed' },
    { name: 'Gift', type: 'variable' },
];
const todayIso = () => format(new Date(), 'yyyy-MM-dd');
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const dayLabel = (n: number, lang: string) => (lang === 'ar' ? `يوم ${n}` : `the ${ordinal(n)}`);
/** Accepts "1,500.50", "1500,5" and Arabic digits. */
function parseAmount(raw: string): number {
    const s = raw.trim().replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s/g, '');
    const norm = /,\d{1,2}$/.test(s) && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, '');
    const n = Number(norm);
    return Number.isFinite(n) ? n : NaN;
}

function PaydaySelect({ id, value, onChange, lang, disabled }: { id: string; value: number; onChange: (d: number) => void; lang: string; disabled?: boolean }) {
    return (
        <select id={id} className="form-select form-input" value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{lang === 'ar' ? `يوم ${d} من كل شهر` : `${ordinal(d)} of every month`}{d >= 29 ? (lang === 'ar' ? ' (أو آخر يوم)' : ' (or the last day)') : ''}</option>
            ))}
        </select>
    );
}

export default function EarningsPage() {
    const { user, incomes, expenses, workspaces, activeWorkspaceId, addIncome, deleteIncome, updateWorkspace } = useStore();
    const lang = user?.language ?? 'en';

    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];
    const isOwner = user && activeWorkspace && (activeWorkspace.ownerId === user.dbId || activeWorkspace.ownerId === user.id || activeWorkspace.ownerId === user.email || workspaces.length === 1);
    const userRole = activeWorkspace?.members.find(m => m.uid === user?.dbId || m.uid === user?.id || (m.email === user?.email && m.email))?.role || (isOwner ? 'owner' : 'viewer');
    const isViewer = workspaces.length > 0 && userRole === 'viewer' && !isOwner;
    const ws = activeWorkspace;
    const cycleStartDay = ws?.cycleStartDay ?? 1;
    const cur = ws?.currency ?? 'USD';
    const hideAmounts = user?.hideAmounts ?? false;

    const [showReport, setShowReport] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [incName, setIncName] = useState('');
    const [incAmount, setIncAmount] = useState('');
    const [incType, setIncType] = useState<'fixed' | 'variable'>('fixed');
    const [incDate, setIncDate] = useState(todayIso);
    const canSetPayday = Boolean(isOwner || userRole === 'admin');
    const [payday, setPayday] = useState(cycleStartDay);
    useEffect(() => { setPayday(cycleStartDay); }, [cycleStartDay]);
    const [editPayday, setEditPayday] = useState(false);
    function savePayday(day: number) {
        if (!ws || !canSetPayday || day === ws.cycleStartDay) return;
        updateWorkspace(ws.id, { cycleStartDay: day });
        toast.success(`${tx('Salary day set to')} ${dayLabel(day, lang)}`);
    }
    const formRef = useRef<HTMLDivElement>(null);
    // On a phone the form opens below the stats: bring it into view and focus the first field.
    useEffect(() => {
        if (!showAdd) return;
        const el = formRef.current; if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const t = setTimeout(() => (el.querySelector('#inc-name') as HTMLInputElement | null)?.focus({ preventScroll: true }), 250);
        return () => clearTimeout(t);
    }, [showAdd]);
    const [incCurrency, setIncCurrency] = useState(cur);
    useEffect(() => { setIncCurrency(cur); }, [cur]);

    // Active Cycle calculations
    const today = new Date();
    const { start: cycleStart, end: cycleEnd } = getActiveCycleDates(today, cycleStartDay);

    // Filter incomes for current workspace
    const wsIncomes = incomes.filter(i => i.workspaceId === activeWorkspaceId);

    // Fixed incomes always apply. Variable incomes apply if their date falls within the cycle.
    const activeIncomes = wsIncomes.filter(i => {
        if (i.type === 'fixed') return true; // Fixed is available every cycle
        return i.date >= cycleStart && i.date <= cycleEnd;
    });

    // Preload exchange rates
    useEffect(() => { preloadRates(); }, []);

    const fixedTotal = activeIncomes.filter(i => i.type === 'fixed').reduce((sum, i) => sum + toBase(i, cur), 0);
    const variableTotal = activeIncomes.filter(i => i.type === 'variable').reduce((sum, i) => sum + toBase(i, cur), 0);
    const totalIncome = fixedTotal + variableTotal;

    // Calculate expenses for this exact cycle
    const cycleExpenses = expenses.filter(e =>
        !e.deleted &&
        e.workspaceId === activeWorkspaceId &&
        e.purchaseAt.slice(0, 10) >= cycleStart &&
        e.purchaseAt.slice(0, 10) <= cycleEnd
    );
    const totalSpent = cycleExpenses.reduce((sum, e) => sum + toBase(e, cur), 0);
    const leftover = totalIncome - totalSpent;

    function handleAddIncome(e: React.FormEvent) {
        e.preventDefault();
        const amount = parseAmount(incAmount);
        if (!incName.trim() || !(amount > 0) || !ws) return;

        addIncome({
            workspaceId: ws.id,
            createdByUid: user?.id || 'sys',
            name: incName.trim(),
            amount,
            currency: incCurrency,
            type: incType,
            date: incType === 'variable' ? (incDate || todayIso()) : new Date().toISOString()
        });

        if (incType === 'fixed') savePayday(payday);
        setShowAdd(false);
        setIncName('');
        setIncAmount('');
        setIncDate(todayIso());
        toast.success(tx('Income saved'));
    }

    return (
        <>
            {showReport && <ReportSheet initial={['income']} onClose={() => setShowReport(false)} />}
            <div className="page animate-fadeIn">
                <header className="page-header" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h1 className="page-title">{t(lang, 'earnings') || tx('Income & Earnings')}</h1>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                            <span className="badge" style={{ background: 'var(--primary-light)', color: '#fff', display: 'flex', gap: 6, alignItems: 'center' }}>
                                <CalendarRange size={14} />
                                {tx('Active Cycle:')}{' '}{format(new Date(cycleStart), 'MMM d')} - {format(new Date(cycleEnd), 'MMM d')}
                            </span>
                            {editPayday && canSetPayday ? (
                                <span className="payday-edit">
                                    <label htmlFor="payday-head" className="sr-only">{tx('Salary day')}</label>
                                    <PaydaySelect id="payday-head" value={cycleStartDay} lang={lang} onChange={d => { savePayday(d); setEditPayday(false); }} />
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditPayday(false)}>{tx('Cancel')}</button>
                                </span>
                            ) : (
                                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                    {tx('Salary day:')} {dayLabel(cycleStartDay, lang)}
                                    {canSetPayday && <button type="button" className="link-btn" onClick={() => setEditPayday(true)} style={{ marginInlineStart: 6 }}>{tx('Change')}</button>}
                                </span>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => setShowReport(true)} aria-label={tx('Create a report')}><FileDown size={16} /><span className="hide-sm">{tx('Report')}</span></button>
                    {!isViewer && (
                        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                            <Plus size={16} />{' '}{tx('Add Income')}
                        </button>
                    )}
                    </div>
                </header>

                <div className="card-grid card-grid-3 mb-6">
                    <div className="card stat-card animate-fadeIn" style={{ background: 'var(--surface)' }}>
                        <div className="stat-label">{tx('Total Income (This Cycle)')}</div>
                        <div className="stat-value"><CurrencyDisplay amount={totalIncome} currency={cur} hideAmounts={hideAmounts} /></div>
                        <TrendingUp size={20} className="stat-icon" style={{ color: 'var(--gain)' }} />
                    </div>
                    <div className="card stat-card animate-fadeIn" style={{ animationDelay: '60ms' }}>
                        <div className="stat-label">{tx('Total Spent')}</div>
                        <div className="stat-value"><CurrencyDisplay amount={totalSpent} currency={cur} hideAmounts={hideAmounts} /></div>
                        <TrendingDown size={20} className="stat-icon" style={{ color: 'var(--danger)' }} />
                    </div>
                    <div className="card stat-card animate-fadeIn" style={{ animationDelay: '120ms', borderColor: leftover >= 0 ? 'var(--gain-soft)' : 'var(--cinnabar-soft)' }}>
                        <div className="stat-label">{tx('Leftover (Expected Savings)')}</div>
                        <div className="stat-value" style={{ color: leftover >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            <CurrencyDisplay amount={leftover} currency={cur} hideAmounts={hideAmounts} />
                        </div>
                        <Briefcase size={20} className="stat-icon" style={{ color: leftover >= 0 ? 'var(--success)' : 'var(--danger)' }} />
                    </div>
                </div>

                {showAdd && (
                    <div ref={formRef} className="card mb-6 animate-fadeIn income-form-card">
                        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{tx('Add Income Source')}</h3>
                        <form onSubmit={handleAddIncome} className="income-form">
                            <div className="form-group income-form-full">
                                <label className="form-label" htmlFor="inc-name">{tx('What is it?')}</label>
                                <input id="inc-name" type="text" className="form-input" value={incName} onChange={e => setIncName(e.target.value)} placeholder={tx('e.g. Salary')} required autoComplete="off" enterKeyHint="next" />
                                <div className="chip-wrap" style={{ marginTop: 8 }}>
                                    {INCOME_SUGGESTIONS.map(s => (
                                        <button key={s.name} type="button" className={`category-chip${incName === tx(s.name) ? ' selected' : ''}`}
                                            onClick={() => { setIncName(tx(s.name)); setIncType(s.type); document.getElementById('inc-amount')?.focus(); }}>
                                            {tx(s.name)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="form-group income-form-full">
                                <label className="form-label" htmlFor="inc-amount">{tx('Amount')}</label>
                                <div className="amount-currency">
                                    <select className="form-select" aria-label={tx('Currency')} value={incCurrency} onChange={e => setIncCurrency(e.target.value)}>
                                        {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                                    </select>
                                    <input id="inc-amount" type="text" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" className="form-input" value={incAmount} onChange={e => setIncAmount(e.target.value)} placeholder="0.00" required enterKeyHint="done" />
                                </div>
                                <ConversionHint amount={incAmount.replace(',', '.')} from={incCurrency} to={cur} />
                            </div>
                            <div className="form-group income-form-full">
                                <label className="form-label" id="inc-type-label">{tx('How often?')}</label>
                                <div className="income-type" role="radiogroup" aria-labelledby="inc-type-label">
                                    <button type="button" role="radio" aria-checked={incType === 'fixed'} className={incType === 'fixed' ? 'active' : ''} onClick={() => setIncType('fixed')}>
                                        <strong>{tx('Every cycle')}</strong><span>{tx('Salary, rent you receive')}</span>
                                    </button>
                                    <button type="button" role="radio" aria-checked={incType === 'variable'} className={incType === 'variable' ? 'active' : ''} onClick={() => setIncType('variable')}>
                                        <strong>{tx('Just once')}</strong><span>{tx('Bonus, gift, a project')}</span>
                                    </button>
                                </div>
                            </div>
                            {incType === 'fixed' && (
                                <div className="form-group income-form-full">
                                    <label className="form-label" htmlFor="inc-payday">{tx('Paid on day')}</label>
                                    <PaydaySelect id="inc-payday" value={payday} lang={lang} disabled={!canSetPayday} onChange={setPayday} />
                                    <div className="form-hint">
                                        {canSetPayday
                                            ? `${tx('Your month in Zaylo will run from')} ${dayLabel(payday, lang)} ${tx('to the day before the next payday.')}`
                                            : tx('Only the workspace owner or an admin can change the salary day.')}
                                    </div>
                                </div>
                            )}
                            {incType === 'variable' && (
                                <div className="form-group income-form-full">
                                    <label className="form-label" htmlFor="inc-date">{tx('Date Received')}</label>
                                    <input id="inc-date" type="date" className="form-input" value={incDate} max={todayIso()} onChange={e => setIncDate(e.target.value)} required />
                                </div>
                            )}
                            <div className="income-form-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>{tx('Cancel')}</button>
                                <button type="submit" className="btn btn-primary" disabled={!incName.trim() || !(parseAmount(incAmount) > 0)}>{tx('Save Income')}</button>
                            </div>
                        </form>
                    </div>
                )}

                <div className="card animate-fadeIn" style={{ animationDelay: '180ms' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <h2 style={{ fontSize: 16, fontWeight: 700 }}>{tx('Active Income Sources')}</h2>
                    </div>

                    {activeIncomes.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-title">{tx('No income sources found')}</div>
                            <div className="empty-desc">{tx('Add your salary or freelance earnings to calculate leftovers.')}</div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {activeIncomes.map(inc => (
                                <div key={inc.id} className="income-row">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                                        <div style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, background: inc.type === 'fixed' ? 'var(--gain-soft)' : 'var(--note-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: inc.type === 'fixed' ? 'var(--gain)' : 'var(--note)' }}>
                                            <Briefcase size={20} />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 15, overflowWrap: 'anywhere' }}>{inc.name}</div>
                                            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                                {inc.type === 'fixed' ? `${tx('Every cycle, paid on')} ${dayLabel(cycleStartDay, lang)}` : `${tx('Received on')} ${format(new Date(inc.date), 'MMM d, yyyy')}`}
                                                {inc.source === 'autotrack' && <span className="at-ledger-badge">{tx('Added by AutoTrack')}</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                        <span style={{ fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>
                                            <CurrencyDisplay amount={inc.amount} currency={inc.currency} entry={inc} showOriginal hideAmounts={hideAmounts} />
                                        </span>
                                        {!isViewer && (
                                            <button className="btn btn-ghost btn-icon" onClick={() => { if (confirm(tx('Delete income source?'))) deleteIncome(inc.id) }} style={{ color: 'var(--danger)' }}>
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
