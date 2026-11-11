import { CHART_TOOLTIP } from '../utils/chartStyle';
import { PushPrompt } from '../components/PushSettings';
import { toBase } from '../utils/money';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ZayloWave } from '../components/brand/Brand';
import { useStore, type Expense } from '../store/useStore';
import { t, tx } from '../i18n/translations';
import { formatMoney, getCategoryInfo, getActiveCycleDates } from '../constants';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import { TrendingUp, TrendingDown, Plus } from 'lucide-react';
import HealthCard from '../components/HealthCard';
import { convertAmountSync, preloadRates } from '../services/exchangeRates';
import CurrencyDisplay from '../components/CurrencyDisplay';
import CategoryIcon from '../components/CategoryIcon';

interface OverviewProps { onNavigate: (p: string) => void; onAddExpense: () => void; }



/** One entry per day of the cycle. Days after today have no value (not zero), so the chart shows where you are. */
function getSpendByDay(expenses: Expense[], workspaceId: string, startDate: string, endDate: string, today: string, baseCur: string) {
    const map: Record<string, number> = {};
    expenses.filter(e => !e.deleted && e.workspaceId === workspaceId && e.purchaseAt.slice(0, 10) >= startDate && e.purchaseAt.slice(0, 10) <= endDate).forEach(e => {
        const day = e.purchaseAt.slice(0, 10);
        map[day] = (map[day] || 0) + toBase(e, baseCur);
    });
    const out: { date: string; amount: number | null; today: boolean }[] = [];
    for (let d = new Date(startDate + 'T00:00:00'); ; d.setDate(d.getDate() + 1)) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (iso > endDate || out.length > 62) break;
        out.push({ date: iso, amount: iso <= today ? +(map[iso] || 0).toFixed(2) : null, today: iso === today });
    }
    return out;
}

const dayDiff = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);

function getCategoryData(expenses: Expense[], workspaceId: string, startDate: string, endDate: string, baseCur: string) {
    const map: Record<string, number> = {};
    expenses.filter(e => !e.deleted && e.workspaceId === workspaceId && e.purchaseAt.slice(0, 10) >= startDate && e.purchaseAt.slice(0, 10) <= endDate).forEach(e => {
        const amt = toBase(e, baseCur);
        map[e.category] = (map[e.category] || 0) + amt;
    });
    return Object.entries(map).map(([cat, val]) => { const info = getCategoryInfo(cat); return { name: info.label, value: +val.toFixed(2), color: info.color, emoji: info.emoji }; }).sort((a, b) => b.value - a.value).slice(0, 8);
}

export default function OverviewPage({ onNavigate, onAddExpense }: OverviewProps) {
    const { user, expenses, bills, activeWorkspaceId, workspaces, currency, markBillPaid, syncStatus } = useStore();
    const lang = user?.language ?? 'en';
    const locale = lang === 'ar' ? 'ar-EG' : 'en-GB';
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
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${todayDate.getFullYear()}-${pad(todayDate.getMonth() + 1)}-${pad(todayDate.getDate())}`; // local day, not UTC
    const { start: cycleStart, end: cycleEnd } = getActiveCycleDates(todayDate, cycleStartDay);
    const cycleDay = dayDiff(cycleStart, today) + 1;
    const cycleDays = dayDiff(cycleStart, cycleEnd) + 1;
    const cyclePct = Math.min(100, Math.max(0, (cycleDay / cycleDays) * 100));

    // Calculate last month's cycle
    const lastMonthDate = new Date(todayDate);
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const { start: lastCycleStart, end: lastCycleEnd } = getActiveCycleDates(lastMonthDate, cycleStartDay);

    const wsExp = expenses.filter(e => !e.deleted && e.workspaceId === activeWorkspaceId);
    const todayTotal = wsExp.filter(e => e.purchaseAt.slice(0, 10) === today).reduce((s, e) => s + toBase(e, cur), 0);

    const monthTotal = wsExp.filter(e => e.purchaseAt.slice(0, 10) >= cycleStart && e.purchaseAt.slice(0, 10) <= cycleEnd).reduce((s, e) => s + toBase(e, cur), 0);
    const lastMonthTotal = wsExp.filter(e => e.purchaseAt.slice(0, 10) >= lastCycleStart && e.purchaseAt.slice(0, 10) <= lastCycleEnd).reduce((s, e) => s + toBase(e, cur), 0);
    const monthChange = lastMonthTotal ? ((monthTotal - lastMonthTotal) / lastMonthTotal * 100) : 0;

    const spendData = getSpendByDay(expenses, activeWorkspaceId, cycleStart, cycleEnd, today, cur);
    const hasSpend = spendData.some(d => (d.amount ?? 0) > 0);
    const catData = getCategoryData(expenses, activeWorkspaceId, cycleStart, cycleEnd, cur);
    const catTop = catData.slice(0, 6);
    const catTotal = catData.reduce((a, x) => a + x.value, 0);
    const catMax = catTop[0]?.value || 1;
    const recentExp = wsExp.slice(0, 5);

    const currentDay = todayDate.getDate();
    const monthStr = today.slice(0, 7);
    const upcomingBills = bills
        .filter(b => b.workspaceId === activeWorkspaceId && b.lastPaidMonth !== monthStr && (b.dueDate - currentDay) <= 7 && (b.dueDate - currentDay) >= -31)
        .sort((a, b) => a.dueDate - b.dueDate);

    // Note figures are shown in the viewer's display currency
    const toDisplay = (v: number) => convertAmountSync(v, cur, currency) ?? v;
    const money = (v: number) => formatMoney(v, currency, hideAmounts);
    const budget = user?.monthlyBudget ?? 0;
    const spent = toDisplay(monthTotal);
    const budgetPct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
    const fmtDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    const loading = syncStatus === 'syncing' && wsExp.length === 0;
    // First day, then every 7th; the last day only when it isn't crowding the previous label
    const tickDays = spendData.filter((_, i) => i === 0 || (i + 1) % 7 === 0 || (i === spendData.length - 1 && (i + 1) % 7 >= 4)).map(d => d.date);
    const compact = (n: number) => n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(Math.round(n));

    return (
        <div className="page overview">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{todayDate.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
                    <p className="page-subtitle">{ws?.name ?? tx('Personal')} · {tx('Day')} {cycleDay} {tx('of')} {cycleDays} {tx('in this cycle')}</p>
                </div>
                {!isViewer && <button className="btn btn-primary" onClick={onAddExpense}><Plus size={16} /> {t(lang, 'add_expense')}</button>}
            </div>

            <PushPrompt />

            {/* The cycle card: what has gone out since payday, against the budget and the calendar */}
            <motion.section className="note mb-6" aria-label={tx('Spending this cycle')}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
                <ZayloWave intensity={0.45} still />
                <div className="note-top">
                    <span className="note-label">{tx('Spent this cycle')}</span>
                    <span className="note-serial">{fmtDay(cycleStart)} – {fmtDay(cycleEnd)}</span>
                </div>
                <div className="note-amount">
                    {hideAmounts ? '••••' : loading ? <span className="skeleton" style={{ display: 'inline-block', width: 220, height: 52, opacity: 0.25 }} /> : money(spent)}
                </div>
                <dl className="note-meta">
                    <div><dt>{tx('Today')}</dt><dd>{money(toDisplay(todayTotal))}</dd></div>
                    <div>
                        <dt>{tx('Vs last cycle')}</dt>
                        <dd className="note-change">
                            {lastMonthTotal ? <>{monthChange <= 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}{Math.abs(monthChange).toFixed(0)}% {tx(monthChange <= 0 ? 'less' : 'more')}</> : tx('No data yet')}
                        </dd>
                    </div>
                    {budget > 0 && <div><dt>{tx('Left in budget')}</dt><dd>{money(Math.max(0, budget - spent))}</dd></div>}
                    {budget > 0 && <div><dt>{tx('Budget')}</dt><dd>{money(budget)}</dd></div>}
                </dl>
                {budget > 0 && (
                    <div className="note-track">
                        <div className="note-budget" data-over={spent > budget} role="progressbar" aria-valuenow={Math.round(budgetPct)} aria-valuemin={0} aria-valuemax={100}
                            aria-label={`${tx('Budget used')}: ${Math.round(budgetPct)}%. ${tx('Day')} ${cycleDay} ${tx('of')} ${cycleDays}`}>
                            <span style={{ transform: `scaleX(${budgetPct / 100})` }} />
                        </div>
                        {/* Signature: where today falls in the cycle. Spending left of it is on pace, right of it is ahead. */}
                        <span className="cycle-tick" style={{ insetInlineStart: `${cyclePct}%` }} aria-hidden="true"><i />{tx('Today')}</span>
                    </div>
                )}
            </motion.section>

            {/* Upcoming bills */}
            {upcomingBills.length > 0 && (
                <div className="card mb-6">
                    <div className="card-head">
                        <div className="card-title">{tx('Bills due soon')}</div>
                        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('bills')}>{tx('Manage bills')}</button>
                    </div>
                    <div className="ledger">
                        {upcomingBills.map(b => {
                            const days = b.dueDate - currentDay;
                            const status = days < 0 ? `${tx('Overdue by')} ${-days} ${tx(days === -1 ? 'day' : 'days')}` : days === 0 ? tx('Due today') : `${tx('Due in')} ${days} ${tx(days === 1 ? 'day' : 'days')}`;
                            return (
                                <div key={b.id} className="ledger-row">
                                    <CategoryIcon category={b.category} />
                                    <div style={{ minWidth: 0 }}>
                                        <div className="ledger-title">{b.name}</div>
                                        <div className={`ledger-sub ${days < 0 ? 'is-overdue' : days === 0 ? 'is-due' : ''}`}>{status}</div>
                                    </div>
                                    <div className="ledger-side">
                                        <span className="ledger-amount"><CurrencyDisplay amount={b.amount} currency={b.currency} hideAmounts={hideAmounts} trim /></span>
                                        {!isViewer && <button className="btn btn-secondary btn-sm" onClick={() => markBillPaid(b.id, monthStr)}>{tx('Mark paid')}</button>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* The main chart, and where the money went beside it */}
            <div className="card-grid overview-charts mb-6">
                <div className="card">
                    <div className="card-head">
                        <div className="card-title">{tx('Daily spending')}</div>
                        {hasSpend && <span className="card-meta">{tx('Today in blue')}</span>}
                    </div>
                    <div className="chart-container" style={{ height: 248 }}>
                        {!hasSpend ? (
                            <div className="empty-state" style={{ padding: '40px 0' }}><div className="empty-desc">{tx('Your daily spending will chart here once you add expenses this cycle.')}</div></div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={spendData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }} barCategoryGap="22%">
                                    <CartesianGrid vertical={false} stroke="var(--line)" />
                                    <XAxis dataKey="date" ticks={tickDays} tickFormatter={fmtDay} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} interval={0} />
                                    <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={36} />
                                    <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={CHART_TOOLTIP} itemStyle={{ color: 'var(--ink)' }} labelStyle={{ color: 'var(--ink-3)' }}
                                        labelFormatter={(d) => fmtDay(String(d))} formatter={(v: number | string | undefined) => [money(Number(v) || 0), tx('Spent')]} />
                                    <Bar dataKey="amount" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                                        {spendData.map(d => <Cell key={d.date} fill={d.today ? 'var(--note)' : 'var(--bar-muted)'} />)}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
                <div className="card">
                    <div className="card-head"><div className="card-title">{tx('Where it went')}</div></div>
                    {catTop.length === 0 ? (
                        <div className="empty-state" style={{ padding: '40px 0' }}><div className="empty-desc">{tx('Categories appear here after your first expense.')}</div></div>
                    ) : (
                        <ol className="cat-rank">
                            {catTop.map((c, i) => (
                                <li key={c.name}>
                                    <div className="cat-rank-row">
                                        <span className="truncate">{c.name}</span>
                                        <span className="cat-rank-amount">{money(toDisplay(c.value))}</span>
                                        <span className="cat-rank-share">{Math.round((c.value / (catTotal || 1)) * 100)}%</span>
                                    </div>
                                    <div className="cat-rank-bar"><span className={i === 0 ? 'lead' : ''} style={{ transform: `scaleX(${c.value / catMax})` }} /></div>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </div>

            <div className="card-grid card-grid-2 stack-mobile overview-bottom" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
                {/* Recent expenses */}
                <div className="card">
                    <div className="card-head">
                        <div className="card-title">{t(lang, 'recent_expenses')}</div>
                        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('expenses')}>{tx('See all')}</button>
                    </div>
                    {loading ? (
                        <div className="ledger">{[0, 1, 2].map(i => <div key={i} className="ledger-row"><div className="skeleton" style={{ width: 40, height: 40, borderRadius: 10 }} /><div><div className="skeleton" style={{ height: 12, width: '60%', marginBottom: 8 }} /><div className="skeleton" style={{ height: 12, width: '40%' }} /></div><div className="skeleton" style={{ height: 16, width: 64 }} /></div>)}</div>
                    ) : recentExp.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-title">{tx('Nothing spent yet')}</div>
                            <div className="empty-desc">{tx('Add an expense by typing it, saying it out loud, or pasting a bank SMS.')}</div>
                            {!isViewer && <button className="btn btn-primary btn-sm mt-2" onClick={onAddExpense}><Plus size={16} />{' '}{tx('Add expense')}</button>}
                        </div>
                    ) : (
                        <div className="ledger">
                            {recentExp.map(e => {
                                const catInfo = getCategoryInfo(e.category);
                                return (
                                    <div key={e.id} className="ledger-row">
                                        <CategoryIcon category={e.category} />
                                        <div style={{ minWidth: 0 }}>
                                            <div className="ledger-title" translate={e.merchant ? "no" : undefined}>{e.merchant || catInfo.label}</div>
                                            <div className="ledger-sub">{catInfo.label} · {new Date(e.purchaseAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</div>
                                        </div>
                                        <div className="ledger-amount"><CurrencyDisplay amount={e.amount} currency={e.currency} entry={e} showOriginal hideAmounts={hideAmounts} trim /></div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Zaylo AI money health */}
                <HealthCard onAsk={() => onNavigate('assistant')} />
            </div>
        </div>
    );
}
