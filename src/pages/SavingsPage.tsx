import { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { getActiveCycleDates } from '../constants';
import { Plus, Trash2, DollarSign, PiggyBank } from 'lucide-react';
import CurrencyDisplay from '../components/CurrencyDisplay';

export default function SavingsPage() {
    const { user, workspaces, savingsGoals, activeWorkspaceId, addSavingsGoal, addFundsToGoal, deleteSavingsGoal, incomes, expenses } = useStore();
    const lang = user?.language ?? 'en';
    const ws = workspaces.find(w => w.id === activeWorkspaceId);
    const isOwner = user?.id && (ws?.ownerId === user.id || ws?.ownerId === user.email);
    const userRole = ws?.members.find(m => m.uid === user?.id || (m.email === user?.email && m.email))?.role || (isOwner ? 'owner' : 'viewer');
    const isViewer = userRole === 'viewer' && !isOwner;
    const cur = ws?.currency ?? user?.defaultCurrency ?? 'USD';
    const cycleStartDay = ws?.cycleStartDay ?? 1;
    const wsGoals = savingsGoals.filter(g => g.workspaceId === activeWorkspaceId);
    const hideAmounts = user?.hideAmounts ?? false;

    const [name, setName] = useState('');
    const [reason, setReason] = useState('');
    const [target, setTarget] = useState('');
    const [fundsId, setFundsId] = useState<string | null>(null);
    const [fundsAmt, setFundsAmt] = useState('');

    function handleAdd(e: React.FormEvent) {
        e.preventDefault();
        if (!name || !target) return;
        const colors = ['#7c3aed', '#06d6a0', '#f59e0b', '#3b82f6', '#ec4899', '#ef4444'];
        const icons = ['🎯', '💰', '🏠', '✈️', '💻', '🎓', '🏖️', '🚗'];
        addSavingsGoal({ workspaceId: activeWorkspaceId, name, reason, targetAmount: parseFloat(target), savedAmount: 0, currency: cur, color: colors[Math.floor(Math.random() * colors.length)], icon: icons[Math.floor(Math.random() * icons.length)] });
        setName(''); setReason(''); setTarget('');
    }

    function handleAddFunds(e: React.FormEvent) {
        e.preventDefault();
        if (!fundsId || !fundsAmt) return;
        addFundsToGoal(fundsId, parseFloat(fundsAmt));
        setFundsId(null); setFundsAmt('');
    }

    // Auto-Savings Roll-over calculation (Leftover money from past cycles)
    const rolloverSavings = useMemo(() => {
        let totalRollover = 0;
        const cycleDatesEvaluated = new Set<string>();

        // Go through all incomes and evaluate the cycles they belong to
        const wsIncomes = incomes.filter(inc => inc.workspaceId === activeWorkspaceId);
        const wsExpenses = expenses.filter(e => !e.deleted && e.workspaceId === activeWorkspaceId);

        const todayCycle = getActiveCycleDates(new Date(), cycleStartDay);

        // Find all unique past cycles
        const allDates = [...wsIncomes.map(i => i.date).filter(Boolean), ...wsExpenses.map(e => e.purchaseAt.slice(0, 10))];

        allDates.forEach(dateStr => {
            if (!dateStr) return;
            const cycle = getActiveCycleDates(new Date(dateStr), cycleStartDay);
            // Only care about strictly PAST cycles.
            if (cycle.end < todayCycle.start) {
                cycleDatesEvaluated.add(`${cycle.start}_${cycle.end}`);
            }
        });

        cycleDatesEvaluated.forEach(cycleKey => {
            const [start, end] = cycleKey.split('_');
            const cycleFixedInc = wsIncomes.filter(i => i.type === 'fixed').reduce((s, i) => s + i.amount, 0);
            const cycleVarInc = wsIncomes.filter(i => i.type === 'variable' && i.date! >= start && i.date! <= end).reduce((s, i) => s + i.amount, 0);
            const cycleExp = wsExpenses.filter(e => e.purchaseAt.slice(0, 10) >= start && e.purchaseAt.slice(0, 10) <= end).reduce((s, e) => s + e.amount, 0);

            const leftover = (cycleFixedInc + cycleVarInc) - cycleExp;
            if (leftover > 0) {
                totalRollover += leftover;
            }
        });

        return totalRollover;
    }, [incomes, expenses, activeWorkspaceId, cycleStartDay]);

    const totalManualSaved = wsGoals.reduce((s, g) => s + g.savedAmount, 0);
    const totalSaved = totalManualSaved + rolloverSavings;
    const totalTarget = wsGoals.reduce((s, g) => s + g.targetAmount, 0);

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'savings_goals')}</h1>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{wsGoals.length} active goals · <CurrencyDisplay amount={totalSaved} currency={cur} hideAmounts={hideAmounts} /> saved of <CurrencyDisplay amount={totalTarget} currency={cur} hideAmounts={hideAmounts} /></p>
                </div>
            </div>

            {/* Summary bar */}
            {(wsGoals.length > 0 || rolloverSavings > 0) && (
                <div className="card mb-6 animate-fadeIn" style={{ background: 'linear-gradient(135deg,rgba(124,58,237,0.15),rgba(6,214,160,0.05))', borderColor: 'rgba(124,58,237,0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.8px' }}>Total Progress</div>
                            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-1px', color: 'var(--primary-light)' }}><CurrencyDisplay amount={totalSaved} currency={cur} hideAmounts={hideAmounts} /></div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>of <CurrencyDisplay amount={totalTarget} currency={cur} hideAmounts={hideAmounts} /> target</div>
                            {rolloverSavings > 0 && (
                                <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <PiggyBank size={12} /> <CurrencyDisplay amount={rolloverSavings} currency={cur} hideAmounts={hideAmounts} /> from past cycle rollovers
                                </div>
                            )}
                        </div>
                        <div style={{ flex: 2 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                                <span>Overall Progress</span>
                                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{totalTarget > 0 ? Math.round(totalSaved / totalTarget * 100) : 0}%</span>
                            </div>
                            <div className="progress" style={{ height: 10 }}>
                                <div className="progress-bar success" style={{ width: `${totalTarget > 0 ? Math.min(totalSaved / totalTarget * 100, 100) : 0}%` }} />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: isViewer ? '1fr' : '1fr 2fr', gap: 24, alignItems: 'start' }}>
                {/* Add new goal */}
                {!isViewer && (
                    <div className="card animate-fadeIn" style={{ animationDelay: '60ms' }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t(lang, 'add_goal')}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>What are you saving for?</div>
                        <form onSubmit={handleAdd}>
                            <div className="form-group">
                                <label className="form-label">{t(lang, 'dream_goal')}</label>
                                <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. New Car" required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Reason / Story</label>
                                <textarea className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this important to you?" rows={2} style={{ resize: 'none' }} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">{t(lang, 'target_amount')}</label>
                                <div className="input-with-icon">
                                    <DollarSign size={16} className="input-icon" />
                                    <input type="number" className="form-input" value={target} onChange={e => setTarget(e.target.value)} placeholder="1000.00" step="0.01" min="1" required />
                                </div>
                            </div>
                            <button type="submit" className="btn btn-primary w-full"><Plus size={16} />{t(lang, 'add_goal')}</button>
                        </form>
                    </div>
                )}

                {/* Goals list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {wsGoals.length === 0 ? (
                        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
                            <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>No savings goals yet</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Create your first goal to start tracking your dreams</div>
                        </div>
                    ) : wsGoals.map((goal, i) => {
                        const pct = Math.round(goal.savedAmount / goal.targetAmount * 100);
                        const remaining = goal.targetAmount - goal.savedAmount;
                        return (
                            <div key={goal.id} className="card animate-fadeIn" style={{ animationDelay: `${i * 60}ms` }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: `${goal.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, border: `1px solid ${goal.color}30` }}>{goal.icon}</div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: 15 }}>{goal.name}</div>
                                        {goal.reason && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>"{goal.reason}"</div>}
                                    </div>
                                    <div style={{ fontWeight: 800, fontSize: 16, color: goal.color }}>{pct}%</div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                                    <span><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}><CurrencyDisplay amount={goal.savedAmount} currency={goal.currency} hideAmounts={hideAmounts} /></span> saved</span>
                                    <span>of <span style={{ fontWeight: 600 }}><CurrencyDisplay amount={goal.targetAmount} currency={goal.currency} hideAmounts={hideAmounts} /></span></span>
                                </div>
                                <div className="progress" style={{ height: 8, marginBottom: 12 }}>
                                    <div className="progress-bar" style={{ width: `${Math.min(pct, 100)}%`, background: goal.color }} />
                                </div>
                                {remaining > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', gap: 4 }}>💡 <CurrencyDisplay amount={remaining} currency={goal.currency} hideAmounts={hideAmounts} /> more to reach your goal</div>}

                                {fundsId === goal.id ? (
                                    <form onSubmit={handleAddFunds} style={{ display: 'flex', gap: 8 }} className="animate-fadeIn">
                                        <div className="input-with-icon" style={{ flex: 1 }}>
                                            <DollarSign size={14} className="input-icon" />
                                            <input type="number" className="form-input" value={fundsAmt} onChange={e => setFundsAmt(e.target.value)} placeholder="Amount to add" step="0.01" min="0.01" autoFocus required />
                                        </div>
                                        <button type="submit" className="btn btn-primary btn-sm">Add</button>
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFundsId(null)}>✕</button>
                                    </form>
                                ) : (
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        {!isViewer && <button className="btn btn-secondary btn-sm" onClick={() => { setFundsId(goal.id); setFundsAmt(''); }}><Plus size={14} />{t(lang, 'add_funds')}</button>}
                                        {!isViewer && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => { if (confirm('Delete this goal?')) deleteSavingsGoal(goal.id); }}><Trash2 size={14} />{t(lang, 'delete')}</button>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
