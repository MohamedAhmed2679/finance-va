import { useState } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { formatCurrency, getActiveCycleDates } from '../constants';
import { Briefcase, Plus, Trash2, CalendarRange, TrendingUp, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';

export default function EarningsPage() {
    const { user, incomes, expenses, workspaces, activeWorkspaceId, addIncome, deleteIncome } = useStore();
    const lang = user?.language ?? 'en';

    const ws = workspaces.find(w => w.id === activeWorkspaceId);
    const cycleStartDay = ws?.cycleStartDay ?? 1;
    const cur = ws?.currency ?? 'USD';
    const hideAmounts = user?.hideAmounts ?? false;

    const [showAdd, setShowAdd] = useState(false);
    const [incName, setIncName] = useState('');
    const [incAmount, setIncAmount] = useState('');
    const [incType, setIncType] = useState<'fixed' | 'variable'>('fixed');
    const [incDate, setIncDate] = useState('');

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

    const fixedTotal = activeIncomes.filter(i => i.type === 'fixed').reduce((sum, i) => sum + i.amount, 0);
    const variableTotal = activeIncomes.filter(i => i.type === 'variable').reduce((sum, i) => sum + i.amount, 0);
    const totalIncome = fixedTotal + variableTotal;

    // Calculate expenses for this exact cycle
    const cycleExpenses = expenses.filter(e =>
        !e.deleted &&
        e.workspaceId === activeWorkspaceId &&
        e.purchaseAt.slice(0, 10) >= cycleStart &&
        e.purchaseAt.slice(0, 10) <= cycleEnd
    );
    const totalSpent = cycleExpenses.reduce((sum, e) => sum + e.amount, 0);
    const leftover = totalIncome - totalSpent;

    function handleAddIncome(e: React.FormEvent) {
        e.preventDefault();
        if (!incName || !incAmount || !ws) return;

        addIncome({
            workspaceId: ws.id,
            createdByUid: user?.id || 'sys',
            name: incName,
            amount: parseFloat(incAmount),
            currency: cur,
            type: incType,
            date: incType === 'variable' ? incDate : new Date().toISOString()
        });

        setShowAdd(false);
        setIncName('');
        setIncAmount('');
    }

    return (
        <>
            <div className="page animate-fadeIn">
                <header className="page-header" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h1 className="page-title">{t(lang, 'earnings') || 'Income & Earnings'}</h1>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <span className="badge" style={{ background: 'var(--primary-light)', color: '#fff', display: 'flex', gap: 6, alignItems: 'center' }}>
                                <CalendarRange size={14} />
                                Active Cycle: {format(new Date(cycleStart), 'MMM d')} - {format(new Date(cycleEnd), 'MMM d')}
                            </span>
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>(Starts on the {cycleStartDay}{cycleStartDay === 1 || cycleStartDay === 21 || cycleStartDay === 31 ? 'st' : cycleStartDay === 2 || cycleStartDay === 22 ? 'nd' : cycleStartDay === 3 || cycleStartDay === 23 ? 'rd' : 'th'})</span>
                        </div>
                    </div>
                </header>

                <div className="card-grid card-grid-3 mb-6">
                    <div className="card stat-card animate-fadeIn" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.1), transparent)' }}>
                        <div className="stat-label">Total Income (This Cycle)</div>
                        <div className="stat-value">{formatCurrency(totalIncome, cur, hideAmounts)}</div>
                        <TrendingUp size={20} className="stat-icon" style={{ color: '#22c55e' }} />
                    </div>
                    <div className="card stat-card animate-fadeIn" style={{ animationDelay: '60ms' }}>
                        <div className="stat-label">Total Spent</div>
                        <div className="stat-value">{formatCurrency(totalSpent, cur, hideAmounts)}</div>
                        <TrendingDown size={20} className="stat-icon" style={{ color: 'var(--danger)' }} />
                    </div>
                    <div className="card stat-card animate-fadeIn" style={{ animationDelay: '120ms', borderColor: leftover >= 0 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' }}>
                        <div className="stat-label">Leftover (Expected Savings)</div>
                        <div className="stat-value" style={{ color: leftover >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {formatCurrency(leftover, cur, hideAmounts)}
                        </div>
                        <Briefcase size={20} className="stat-icon" style={{ color: leftover >= 0 ? 'var(--success)' : 'var(--danger)' }} />
                    </div>
                </div>

                {showAdd && (
                    <div className="card mb-6 animate-fadeIn" style={{ borderLeft: '4px solid var(--primary)' }}>
                        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Add Income Source</h3>
                        <form onSubmit={handleAddIncome} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Income Type</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button type="button" className={`btn ${incType === 'fixed' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setIncType('fixed')} style={{ flex: 1 }}>Fixed / Salary</button>
                                    <button type="button" className={`btn ${incType === 'variable' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setIncType('variable')} style={{ flex: 1 }}>Variable / One-off</button>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Name (e.g. Salary, Freelance project)</label>
                                <input type="text" className="form-input" value={incName} onChange={e => setIncName(e.target.value)} required autoFocus />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Amount ({cur})</label>
                                <input type="number" step="0.01" className="form-input" value={incAmount} onChange={e => setIncAmount(e.target.value)} required />
                            </div>
                            {incType === 'variable' && (
                                <div className="form-group">
                                    <label className="form-label">Date Received</label>
                                    <input type="date" className="form-input" value={incDate} onChange={e => setIncDate(e.target.value)} required />
                                </div>
                            )}
                            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
                                <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save Income</button>
                            </div>
                        </form>
                    </div>
                )}

                <div className="card animate-fadeIn" style={{ animationDelay: '180ms' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Active Income Sources</h2>
                    </div>

                    {activeIncomes.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-title">No income sources found</div>
                            <div className="empty-desc">Add your salary or freelance earnings to calculate leftovers.</div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {activeIncomes.map(inc => (
                                <div key={inc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bg-body)', borderRadius: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                        <div style={{ width: 44, height: 44, borderRadius: 12, background: inc.type === 'fixed' ? 'rgba(34,197,94,0.1)' : 'rgba(124,58,237,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: inc.type === 'fixed' ? '#22c55e' : '#7c3aed' }}>
                                            <Briefcase size={20} />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 15 }}>{inc.name}</div>
                                            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                                {inc.type === 'fixed' ? 'Recurring per cycle' : `Received on ${format(new Date(inc.date), 'MMM d, yyyy')}`}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                                        <span style={{ fontWeight: 700, fontSize: 16 }}>
                                            {formatCurrency(inc.amount, inc.currency, hideAmounts)}
                                        </span>
                                        <button className="btn btn-ghost btn-icon" onClick={() => { if (confirm('Delete income source?')) deleteIncome(inc.id) }} style={{ color: 'var(--danger)' }}>
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <button className="fab animate-slideUp" onClick={() => setShowAdd(true)} title="Add Income" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                <Plus size={24} />
            </button>
        </>
    );
}
