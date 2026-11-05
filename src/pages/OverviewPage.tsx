import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ZayloWave, ZPattern, ZayloMark, useCountUp } from '../components/brand/Brand';
import { useStore, type Expense } from '../store/useStore';
import { t } from '../i18n/translations';
import { formatCurrency, getCategoryInfo, getActiveCycleDates } from '../constants';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, CalendarClock, Plus } from 'lucide-react';
import HealthCard from '../components/HealthCard';
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
    const { user, expenses, bills, activeWorkspaceId, workspaces, currency, markBillPaid, syncStatus } = useStore();
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
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${todayDate.getFullYear()}-${pad(todayDate.getMonth() + 1)}-${pad(todayDate.getDate())}`; // local day, not UTC
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


    // Note figures are shown in the viewer's display currency
    const toDisplay = (v: number) => convertAmountSync(v, cur, currency) ?? v;
    const budget = user?.monthlyBudget ?? 0;
    const spentShown = useCountUp(toDisplay(monthTotal));
    const budgetPct = budget > 0 ? Math.min(100, (toDisplay(monthTotal) / budget) * 100) : 0;
    const fmtDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' });
    const hour = todayDate.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = (user?.name || '').split(' ')[0];
    const loading = syncStatus === 'syncing' && wsExp.length === 0;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
                    <p className="page-subtitle">{todayDate.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {ws?.name ?? 'Personal'}</p>
                </div>
                {!isViewer && <button className="btn btn-primary" onClick={onAddExpense}><Plus size={17} /> {t(lang, 'add_expense')}</button>}
            </div>

            {/* The Zaylo card — signature hero */}
            <motion.section className="note mb-6" aria-label="Spending this cycle"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
                <ZPattern opacity={0.08} />
                <ZayloWave intensity={0.85} />
                <div className="note-top">
                    <span className="note-label">Spent this cycle</span>
                    <span className="note-serial">{fmtDay(cycleStart)} – {fmtDay(cycleEnd)}</span>
                </div>
                <div className="note-amount">
                    {hideAmounts ? '••••' : loading ? <span className="skeleton" style={{ display: 'inline-block', width: 220, height: 52, opacity: 0.25 }} /> : formatCurrency(spentShown, currency)}
                </div>
                <dl className="note-meta">
                    <div><dt>Today</dt><dd>{hideAmounts ? '••••' : formatCurrency(toDisplay(todayTotal), currency)}</dd></div>
                    <div>
                        <dt>Vs last cycle</dt>
                        <dd style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {lastMonthTotal ? <>{monthChange <= 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}{Math.abs(monthChange).toFixed(0)}% {monthChange <= 0 ? 'less' : 'more'}</> : 'No data yet'}
                        </dd>
                    </div>
                    {budget > 0 && <div><dt>Left in budget</dt><dd>{hideAmounts ? '••••' : formatCurrency(Math.max(0, budget - toDisplay(monthTotal)), currency)}</dd></div>}
                </dl>
                {budget > 0 && (
                    <div className="note-budget" data-over={toDisplay(monthTotal) > budget} role="progressbar" aria-valuenow={Math.round(budgetPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
                        <motion.span initial={{ width: 0 }} animate={{ width: `${budgetPct}%` }} transition={{ duration: 1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }} />
                    </div>
                )}
                <div className="note-seal"><ZayloMark size={34} /></div>
            </motion.section>

            {/* Upcoming bills */}
            {upcomingBills.length > 0 && (
                <div className="card mb-6 animate-fadeIn">
                    <div className="card-head">
                        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CalendarClock size={18} style={{ color: 'var(--amber)' }} /> Bills due soon
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('bills')}>Manage bills</button>
                    </div>
                    <div className="ledger">
                        {upcomingBills.map(b => {
                            const days = b.dueDate - currentDay;
                            const status = days < 0 ? `Overdue by ${-days} day${days === -1 ? '' : 's'}` : days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`;
                            const cat = getCategoryInfo(b.category);
                            return (
                                <div key={b.id} className="ledger-row">
                                    <div className="ledger-icon" style={{ background: `${cat.color}1f` }}>{cat.emoji}</div>
                                    <div style={{ minWidth: 0 }}>
                                        <div className="ledger-title">{b.name}</div>
                                        <div className="ledger-sub" style={{ color: days < 0 ? 'var(--cinnabar)' : days === 0 ? 'var(--amber)' : undefined, fontWeight: days <= 0 ? 600 : 400 }}>{status}</div>
                                    </div>
                                    <div className="ledger-side">
                                        <span className="ledger-amount"><CurrencyDisplay amount={b.amount} currency={b.currency} hideAmounts={hideAmounts} /></span>
                                        {!isViewer && <button className="btn btn-secondary btn-sm" onClick={() => markBillPaid(b.id, monthStr)}>Mark paid</button>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Charts */}
            <div className="card-grid card-grid-2 mb-6">
                <div className="card animate-fadeIn" style={{ animationDelay: '80ms' }}>
                    <div className="card-head"><div className="card-title">{t(lang, 'spend_over_time')}</div></div>
                    <div className="chart-container" style={{ height: 180 }}>
                        {spendData.length === 0 ? (
                            <div className="empty-state" style={{ padding: '36px 0' }}><div className="empty-desc">Your daily spending will chart here once you add expenses this cycle.</div></div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={spendData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                                    <defs><linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--note)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--note)" stopOpacity={0} /></linearGradient></defs>
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} minTickGap={16} />
                                    <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={44} />
                                    <Tooltip cursor={{ stroke: 'var(--line-strong)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 13, color: 'var(--ink)' }} formatter={(v: number | string | undefined) => [formatCurrency(Number(v) || 0, cur), 'Spent']} />
                                    <Area type="monotone" dataKey="amount" stroke="var(--note)" strokeWidth={2} fill="url(#spendFill)" animationDuration={900} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
                <div className="card animate-fadeIn" style={{ animationDelay: '140ms' }}>
                    <div className="card-head"><div className="card-title">{t(lang, 'category_breakdown')}</div></div>
                    {catData.length === 0 ? (
                        <div className="empty-state" style={{ padding: '36px 0' }}><div className="empty-desc">Categories appear here after your first expense.</div></div>
                    ) : (
                        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
                            <div style={{ width: 150, height: 150, flexShrink: 0 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={catData} cx="50%" cy="50%" innerRadius={46} outerRadius={70} paddingAngle={2} dataKey="value" strokeWidth={0} animationDuration={900}>
                                            {catData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                        </Pie>
                                        <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 13 }} formatter={(v: number | string | undefined) => formatCurrency(Number(v) || 0, cur)} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                                {catData.slice(0, 5).map(c => (
                                    <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                                        <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                                        <span className="truncate" style={{ flex: 1, color: 'var(--ink-2)' }}>{c.name}</span>
                                        <span className="tnum" style={{ fontWeight: 600 }}><CurrencyDisplay amount={c.value} currency={cur} hideAmounts={hideAmounts} /></span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="card-grid card-grid-2 stack-mobile" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
                {/* Recent expenses */}
                <div className="card animate-fadeIn" style={{ animationDelay: '200ms' }}>
                    <div className="card-head">
                        <div className="card-title">{t(lang, 'recent_expenses')}</div>
                        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('expenses')}>See all</button>
                    </div>
                    {loading ? (
                        <div className="ledger">{[0, 1, 2].map(i => <div key={i} className="ledger-row"><div className="skeleton" style={{ width: 40, height: 40, borderRadius: 12 }} /><div><div className="skeleton" style={{ height: 13, width: '60%', marginBottom: 6 }} /><div className="skeleton" style={{ height: 11, width: '40%' }} /></div><div className="skeleton" style={{ height: 14, width: 64 }} /></div>)}</div>
                    ) : recentExp.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-title">Nothing spent yet</div>
                            <div className="empty-desc">Add an expense by typing it, saying it out loud, or pasting a bank SMS.</div>
                            {!isViewer && <button className="btn btn-primary btn-sm mt-2" onClick={onAddExpense}><Plus size={15} /> Add expense</button>}
                        </div>
                    ) : (
                        <div className="ledger">
                            {recentExp.map((e, i) => {
                                const catInfo = getCategoryInfo(e.category);
                                return (
                                    <motion.div key={e.id} className="ledger-row" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.05 }}>
                                        <div className="ledger-icon" style={{ background: `${catInfo.color}1f` }}>{catInfo.emoji}</div>
                                        <div style={{ minWidth: 0 }}>
                                            <div className="ledger-title">{e.merchant || catInfo.label}</div>
                                            <div className="ledger-sub">{catInfo.label} · {new Date(e.purchaseAt).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })}</div>
                                        </div>
                                        <div className="ledger-amount"><CurrencyDisplay amount={e.amount} currency={e.currency} hideAmounts={hideAmounts} /></div>
                                    </motion.div>
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
