import { useState, useEffect } from 'react';
import { useStore, type Expense } from '../store/useStore';
import { t } from '../i18n/translations';
import { formatCurrency, getCategoryInfo, getActiveCycleDates } from '../constants';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Sparkles, RefreshCw, CalendarSync } from 'lucide-react';
import { convertAmountSync, preloadRates } from '../services/exchangeRates';
import CurrencyDisplay from '../components/CurrencyDisplay';

interface OverviewProps { onNavigate: (p: string) => void; onAddExpense: () => void; }



function getSpendByDay(expenses: Expense[], workspaceId: string, startDate: string, endDate: string, baseCur: string) {
    const periodExp = expenses.filter(e => !e.deleted && e.workspaceId === workspaceId && e.purchaseAt.slice(0, 10) >= startDate && e.purchaseAt.slice(0, 10) <= endDate);
    const map: Record<string, number> = {};
    periodExp.forEach(e => {
        const day = e.purchaseAt.slice(0, 10);
        const amt = convertAmountSync(e.amount, e.currency, baseCur) ?? e.amount;
        map[day] = (map[day] || 0) + amt;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([date, amount]) => ({ date: date.slice(5), amount: +amount.toFixed(2) }));
}

function getCategoryData(expenses: Expense[], workspaceId: string, startDate: string, endDate: string, baseCur: string) {
    const map: Record<string, number> = {};
    expenses.filter(e => !e.deleted && e.workspaceId === workspaceId && e.purchaseAt.slice(0, 10) >= startDate && e.purchaseAt.slice(0, 10) <= endDate).forEach(e => {
        const amt = convertAmountSync(e.amount, e.currency, baseCur) ?? e.amount;
        map[e.category] = (map[e.category] || 0) + amt;
    });
    return Object.entries(map).map(([cat, val]) => { const info = getCategoryInfo(cat); return { name: info.label, value: +val.toFixed(2), color: info.color, emoji: info.emoji }; }).sort((a, b) => b.value - a.value).slice(0, 8);
}

export default function OverviewPage({ onNavigate, onAddExpense }: OverviewProps) {
    const { user, expenses, bills, activeWorkspaceId, workspaces, currency, markBillPaid } = useStore();
    const lang = user?.language ?? 'en';
    const ws = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];
    const isOwner = user && ws && (ws.ownerId === user.dbId || ws.ownerId === user.id || ws.ownerId === user.email);
    const userRole = ws?.members.find(m => m.uid === user?.dbId || m.uid === user?.id || (m.email === user?.email && m.email))?.role || (isOwner ? 'owner' : 'viewer');
    const isViewer = workspaces.length > 0 && userRole === 'viewer' && !isOwner;
    const cur = ws?.currency ?? currency;
    const hideAmounts = user?.hideAmounts ?? false;
    const cycleStartDay = ws?.cycleStartDay ?? 1;

    // Preload exchange rates
    useEffect(() => { preloadRates(); }, []);

    const todayDate = new Date();
    const today = todayDate.toISOString().slice(0, 10);
    const { start: cycleStart, end: cycleEnd } = getActiveCycleDates(todayDate, cycleStartDay);

    // Calculate last month's cycle
    const lastMonthDate = new Date(todayDate);
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const { start: lastCycleStart, end: lastCycleEnd } = getActiveCycleDates(lastMonthDate, cycleStartDay);

    const wsExp = expenses.filter(e => !e.deleted && e.workspaceId === activeWorkspaceId);
    const todayTotal = wsExp.filter(e => e.purchaseAt.slice(0, 10) === today).reduce((s, e) => s + (convertAmountSync(e.amount, e.currency, cur) ?? e.amount), 0);

    const monthTotal = wsExp.filter(e => e.purchaseAt.slice(0, 10) >= cycleStart && e.purchaseAt.slice(0, 10) <= cycleEnd).reduce((s, e) => s + (convertAmountSync(e.amount, e.currency, cur) ?? e.amount), 0);
    const lastMonthTotal = wsExp.filter(e => e.purchaseAt.slice(0, 10) >= lastCycleStart && e.purchaseAt.slice(0, 10) <= lastCycleEnd).reduce((s, e) => s + (convertAmountSync(e.amount, e.currency, cur) ?? e.amount), 0);
    const monthChange = lastMonthTotal ? ((monthTotal - lastMonthTotal) / lastMonthTotal * 100) : 0;

    const spendData = getSpendByDay(expenses, activeWorkspaceId, cycleStart, cycleEnd, cur);
    const catData = getCategoryData(expenses, activeWorkspaceId, cycleStart, cycleEnd, cur);
    const recentExp = wsExp.slice(0, 5);

    const currentDay = todayDate.getDate();
    const monthStr = today.slice(0, 7);
    const upcomingBills = bills
        .filter(b => b.workspaceId === activeWorkspaceId && b.lastPaidMonth !== monthStr && (b.dueDate - currentDay) <= 7 && (b.dueDate - currentDay) >= -31)
        .sort((a, b) => a.dueDate - b.dueDate);

    const [aiText, setAiText] = useState<string>('');
    const [aiLoading, setAiLoading] = useState(false);

    async function generateAdvice() {
        setAiLoading(true);
        try {
            const topCats = catData.slice(0, 3).map(c => `${c.name}: ${formatCurrency(c.value, cur)}`).join(', ');
            const prompt = `You are a friendly personal finance advisor. Analyze these monthly expenses: Total this month: ${formatCurrency(monthTotal, cur)}. Top spending categories: ${topCats}. Provide 3 concise, actionable tips to save money and improve financial health. Be encouraging and specific. Max 120 words.`;

            // Try server-side endpoint first (API key stays on server)
            const res = await fetch('/api/ai/advice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });

            if (res.ok) {
                const data = await res.json();
                setAiText(data.text || 'Unable to generate advice at this time.');
            } else {
                // Fallback: use user's personal key if server endpoint fails
                const apiKeyToUse = user?.geminiKey;
                if (!apiKeyToUse) {
                    setAiText('AI advice is temporarily unavailable. Add your Gemini API key in Settings → AI Integrations.');
                    return;
                }
                const fallbackRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKeyToUse}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
                const data = await fallbackRes.json();
                if (data.error) {
                    setAiText(data.error.code === 429 ? 'AI quota exhausted. Please set your personal Gemini API Key in Settings.' : `AI Error: ${data.error.message}`);
                    return;
                }
                setAiText(data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Unable to generate advice at this time.');
            }
        } catch { setAiText('AI advice is temporarily unavailable. Check your internet connection.'); }
        setAiLoading(false);
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'overview')}</h1>
                    <p className="page-subtitle" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                </div>
                {!isViewer && <button className="btn btn-primary" onClick={onAddExpense}>+ {t(lang, 'add_expense')}</button>}
            </div>

            {/* Stat cards */}
            <div className="card-grid card-grid-4 mb-6">
                <div className="card stat-card animate-fadeIn">
                    <div className="stat-label">{t(lang, 'today_spend')}</div>
                    <div className="stat-value animate-countUp"><CurrencyDisplay amount={todayTotal} currency={cur} hideAmounts={hideAmounts} /></div>
                    <TrendingDown size={20} className="stat-icon" />
                </div>
                <div className="card stat-card animate-fadeIn" style={{ animationDelay: '60ms' }}>
                    <div className="stat-label">{t(lang, 'this_month')}</div>
                    <div className="stat-value animate-countUp"><CurrencyDisplay amount={monthTotal} currency={cur} hideAmounts={hideAmounts} /></div>
                    <div className={`stat-change ${monthChange <= 0 ? 'stat-positive' : 'stat-negative'}`}>
                        {monthChange <= 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                        {Math.abs(monthChange).toFixed(1)}% vs last month
                    </div>
                </div>

                {/* AI Summary card */}
                <div className="card animate-fadeIn" style={{ animationDelay: '120ms', gridColumn: 'span 2', background: 'linear-gradient(135deg,rgba(124,58,237,0.15),rgba(168,85,247,0.05))', borderColor: 'rgba(124,58,237,0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Sparkles size={16} style={{ color: 'var(--primary-light)' }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary-light)' }}>{t(lang, 'ai_analysis')}</span>
                        <button onClick={generateAdvice} disabled={aiLoading} className="btn btn-ghost btn-sm btn-icon" style={{ marginLeft: 'auto', padding: 4 }}>
                            <RefreshCw size={14} className={aiLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    {aiLoading ? (
                        <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                            <div className="skeleton" style={{ height: 14, width: '90%' }} />
                            <div className="skeleton" style={{ height: 14, width: '70%' }} />
                            <div className="skeleton" style={{ height: 14, width: '80%' }} />
                        </div>
                    ) : aiText ? (
                        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{aiText}</p>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '16px 0' }}>
                            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>Ready for some personalized financial tips?</p>
                            <button className="btn btn-primary btn-sm" onClick={generateAdvice}>{t(lang, 'generate_advice')}</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Charts */}
            <div className="card-grid card-grid-2 mb-6">
                <div className="card animate-fadeIn" style={{ animationDelay: '180ms' }}>
                    <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 14 }}>{t(lang, 'spend_over_time')}</div>
                    <div className="chart-container" style={{ height: 160 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={spendData}>
                                <defs><linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7c3aed" stopOpacity={0.25} /><stop offset="95%" stopColor="#7c3aed" stopOpacity={0} /></linearGradient></defs>
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={40} />
                                <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                                <Area type="monotone" dataKey="amount" stroke="#7c3aed" strokeWidth={2} fill="url(#grad1)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div className="card animate-fadeIn" style={{ animationDelay: '240ms' }}>
                    <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 14 }}>{t(lang, 'category_breakdown')}</div>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div style={{ width: 140, height: 140 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={catData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value" strokeWidth={0}>
                                        {catData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: number | string | undefined) => formatCurrency(Number(v) || 0, cur)} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {catData.slice(0, 5).map(c => (
                                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                                    <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{c.emoji} {c.name}</span>
                                    <span style={{ fontWeight: 700, fontSize: 11 }}><CurrencyDisplay amount={c.value} currency={cur} hideAmounts={hideAmounts} /></span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Upcoming Bills */}
            {upcomingBills.length > 0 && (
                <div className="card mb-6 animate-fadeIn" style={{ animationDelay: '280ms', borderLeft: '4px solid #f59e0b' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CalendarSync size={18} style={{ color: '#f59e0b' }} />
                            Upcoming & Overdue Bills
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('bills')}>Manage →</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {upcomingBills.map(b => {
                            const days = b.dueDate - currentDay;
                            const statusColor = days < 0 ? 'var(--danger)' : days === 0 ? '#f59e0b' : 'var(--text-muted)';
                            const statusText = days < 0 ? 'Overdue' : days === 0 ? 'Due Today' : `Due in ${days}d`;
                            return (
                                <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-body)', borderRadius: 8 }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</div>
                                        <div style={{ fontSize: 11, color: statusColor, fontWeight: days <= 0 ? 600 : 400 }}>{statusText}</div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                        <span style={{ fontWeight: 700, fontSize: 14 }}><CurrencyDisplay amount={b.amount} currency={b.currency} hideAmounts={hideAmounts} /></span>
                                        {!isViewer && <button className="btn btn-primary btn-sm" onClick={() => markBillPaid(b.id, monthStr)} style={{ padding: '4px 12px', minHeight: 'unset', fontSize: 12 }}>Pay</button>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Recent expenses */}
            <div className="card animate-fadeIn" style={{ animationDelay: '300ms' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{t(lang, 'recent_expenses')}</div>
                    <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('expenses')}>View all →</button>
                </div>
                {recentExp.length === 0 ? (
                    <div className="empty-state"><div className="empty-icon">💸</div><div className="empty-title">No expenses yet</div><div className="empty-desc">Add your first expense to get started</div></div>
                ) : (
                    <table className="data-table">
                        <thead><tr><th>{t(lang, 'merchant')}</th><th>{t(lang, 'category')}</th><th>{t(lang, 'date')}</th><th style={{ textAlign: 'right' }}>{t(lang, 'amount')}</th></tr></thead>
                        <tbody>
                            {recentExp.map(e => {
                                const catInfo = getCategoryInfo(e.category);
                                return (
                                    <tr key={e.id}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${catInfo.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{catInfo.emoji}</div>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: 13 }}>{e.merchant}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.description}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td><span className={`badge badge-${e.category}`}>{catInfo.label}</span></td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{new Date(e.purchaseAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 14 }}><CurrencyDisplay amount={e.amount} currency={e.currency} hideAmounts={hideAmounts} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
