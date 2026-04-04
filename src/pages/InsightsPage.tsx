import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { formatCurrency, getCategoryInfo, getPaymentMethodInfo } from '../constants';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export default function InsightsPage() {
    const { user, expenses, activeWorkspaceId, currency } = useStore();
    const lang = user?.language ?? 'en';
    const cur = currency;
    const hideAmounts = user?.hideAmounts ?? false;
    const wsExp = expenses.filter(e => !e.deleted && e.workspaceId === activeWorkspaceId);

    const catData = useMemo(() => {
        const map: Record<string, number> = {};
        wsExp.forEach(e => { map[e.category] = (map[e.category] || 0) + e.amount; });
        return Object.entries(map).map(([cat, val]) => { const info = getCategoryInfo(cat); return { name: info.label, value: +val.toFixed(2), color: info.color, emoji: info.emoji }; }).sort((a, b) => b.value - a.value);
    }, [wsExp]);

    const pmData = useMemo(() => {
        const map: Record<string, number> = {};
        wsExp.forEach(e => { map[e.paymentMethod] = (map[e.paymentMethod] || 0) + e.amount; });
        return Object.entries(map).map(([pm, val]) => { const info = getPaymentMethodInfo(pm); return { name: info.label, value: +val.toFixed(2), emoji: info.emoji }; });
    }, [wsExp]);

    const merchantData = useMemo(() => {
        const map: Record<string, number> = {};
        wsExp.forEach(e => { map[e.merchant] = (map[e.merchant] || 0) + e.amount; });
        return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m, v]) => ({ name: m, value: +v.toFixed(2) }));
    }, [wsExp]);

    const monthlyData = useMemo(() => {
        const map: Record<string, number> = {};
        wsExp.forEach(e => { const month = e.purchaseAt.slice(0, 7); map[month] = (map[month] || 0) + e.amount; });
        return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([m, v]) => ({ month: m.slice(5) + '/' + m.slice(2, 4), amount: +v.toFixed(2) }));
    }, [wsExp]);

    const total = wsExp.reduce((s, e) => s + e.amount, 0);
    const avg = wsExp.length ? total / wsExp.length : 0;
    const maxExpense = wsExp.reduce((m, e) => e.amount > m.amount ? e : m, wsExp[0]);

    const COLORS = ['#7c3aed', '#06d6a0', '#f59e0b', '#3b82f6', '#ec4899', '#ef4444', '#14b8a6', '#84cc16'];

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'insights')}</h1>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Spending analytics for your workspace</p>
                </div>
            </div>

            {/* Summary stats */}
            <div className="card-grid card-grid-3 mb-6">
                {[
                    { label: 'Total Spent', value: formatCurrency(total, cur, hideAmounts) },
                    { label: 'Avg Transaction', value: formatCurrency(avg, cur, hideAmounts) },
                    { label: 'Largest Expense', value: maxExpense ? formatCurrency(maxExpense.amount, cur, hideAmounts) : '-' },
                ].map((stat, i) => (
                    <div key={i} className="card stat-card animate-fadeIn" style={{ animationDelay: `${i * 60}ms` }}>
                        <div className="stat-label">{stat.label}</div>
                        <div className="stat-value" style={{ fontSize: 24 }}>{stat.value}</div>
                    </div>
                ))}
            </div>

            {/* Monthly trend */}
            <div className="card mb-6 animate-fadeIn" style={{ animationDelay: '180ms' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Monthly Spending Trend</div>
                <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyData} barSize={32}>
                            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={50} />
                            <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => formatCurrency(v, cur)} />
                            <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                                {monthlyData.map((_, i) => <Cell key={i} fill={i === monthlyData.length - 1 ? '#7c3aed' : `rgba(124,58,237,${0.4 + i * 0.1})`} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="card-grid card-grid-2 mb-6">
                {/* Category donut */}
                <div className="card animate-fadeIn" style={{ animationDelay: '240ms' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>{t(lang, 'category_breakdown')}</div>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div style={{ width: 160, height: 160, flexShrink: 0 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={catData} cx="50%" cy="50%" innerRadius={50} outerRadius={72} dataKey="value" strokeWidth={0} paddingAngle={2}>
                                        {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => formatCurrency(v, cur)} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: 160 }}>
                            {catData.map(c => {
                                const pct = total > 0 ? Math.round(c.value / total * 100) : 0;
                                return (
                                    <div key={c.name}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>{c.emoji} {c.name}</span>
                                            <span style={{ fontWeight: 700 }}>{pct}%</span>
                                        </div>
                                        <div className="progress" style={{ height: 4 }}>
                                            <div className="progress-bar" style={{ width: `${pct}%`, background: c.color }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Payment method */}
                <div className="card animate-fadeIn" style={{ animationDelay: '300ms' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Payment Methods</div>
                    <div style={{ height: 160 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={pmData} cx="50%" cy="50%" outerRadius={70} dataKey="value" strokeWidth={0} paddingAngle={3} label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false}>
                                    {pmData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                </Pie>
                                <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => formatCurrency(v, cur)} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Top merchants */}
            <div className="card animate-fadeIn" style={{ animationDelay: '360ms' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>{t(lang, 'top_merchants')}</div>
                {merchantData.map((m, i) => {
                    const pct = total > 0 ? m.value / total * 100 : 0;
                    return (
                        <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: 'var(--primary-light)', flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</span>
                                    <span style={{ fontWeight: 700, fontSize: 13 }}>{formatCurrency(m.value, cur, hideAmounts)}</span>
                                </div>
                                <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
