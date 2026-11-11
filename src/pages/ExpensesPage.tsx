import Dialog from '../components/Dialog';
import { useState, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CategoryIcon from '../components/CategoryIcon';
import { useStore, type Expense, type AppFilters, type CategoryKey, type PaymentMethod } from '../store/useStore';

function localDay(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function groupByDay(list: Expense[]): [string, Expense[]][] {
    const map = new Map<string, Expense[]>();
    list.forEach(e => { const k = localDay(e.purchaseAt); map.set(k, [...(map.get(k) || []), e]); });
    return [...map.entries()];
}
function dayLabel(day: string) {
    const today = localDay(new Date().toISOString());
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (day === today) return 'Today';
    if (day === localDay(y.toISOString())) return 'Yesterday';
    return new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: day.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' });
}
import { t, tx } from '../i18n/translations';
import { getCategoryInfo, getPaymentMethodInfo, getActiveCycleDates } from '../constants';
import { Search, Filter, X, Trash2, Plus, Edit2, Target, FileDown, ShoppingCart } from 'lucide-react';
import ExpenseItems from '../smartcart/ExpenseItems';
import ReportSheet from '../components/ReportSheet';
import AddExpenseModal from '../components/AddExpenseModal';
import CurrencyDisplay from '../components/CurrencyDisplay';
import { toBase } from '../utils/money';

export default function ExpensesPage() {
    const { workspaces, activeWorkspaceId, expenses, filters, setFilters, resetFilters, deleteExpense, user, updateUser, categories, paymentMethods } = useStore();
    const lang = user?.language ?? 'en';
    const currency = user?.defaultCurrency ?? 'USD';
    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];
    const isOwner = user && activeWorkspace && (activeWorkspace.ownerId === user.dbId || activeWorkspace.ownerId === user.id || activeWorkspace.ownerId === user.email);
    const userRole = activeWorkspace?.members.find(m => m.uid === user?.dbId || m.uid === user?.id || (m.email === user?.email && m.email))?.role || (isOwner ? 'owner' : 'viewer');
    const isViewer = userRole === 'viewer' && !isOwner;

    // Automatically set default date filters to active cycle if none are set.
    useEffect(() => {
        if (!filters.dateFrom && !filters.dateTo && activeWorkspace) {
            const cycle = getActiveCycleDates(new Date(), activeWorkspace.cycleStartDay ?? 1);
            setFilters({ dateFrom: cycle.start, dateTo: cycle.end });
        }
    }, [activeWorkspace?.cycleStartDay, filters.dateFrom, filters.dateTo, activeWorkspace, setFilters]);

    const [showReport, setShowReport] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [editId, setEditId] = useState<string | undefined>();
    const [showBudget, setShowBudget] = useState(false);
    const [budgetInput, setBudgetInput] = useState((user?.monthlyBudget ?? 0).toString());
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    // Smart Cart purchases open their itemized view (also from /expenses?view=<id>)
    const [viewId, setViewId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('view'));
    const viewing = viewId ? expenses.find(e => e.id === viewId && e.details) : undefined;
    const hideAmounts = user?.hideAmounts ?? false;

    const wsExp = useMemo(() => expenses.filter(e => !e.deleted && e.workspaceId === activeWorkspaceId), [expenses, activeWorkspaceId]);
    const wsCur = activeWorkspace?.currency ?? currency;
    const base = (e: Expense) => toBase(e, wsCur);
    const maxAmt = Math.ceil(Math.max(...wsExp.map(base), 100));

    const filtered = useMemo(() => {
        const base = (e: Expense) => toBase(e, wsCur);
        let result = wsExp;
        if (filters.search) result = result.filter(e => e.merchant.toLowerCase().includes(filters.search.toLowerCase()) || e.description.toLowerCase().includes(filters.search.toLowerCase()));
        if (filters.categories.length) result = result.filter(e => filters.categories.includes(e.category));
        if (filters.paymentMethods.length) result = result.filter(e => filters.paymentMethods.includes(e.paymentMethod));
        if (filters.dateFrom) result = result.filter(e => e.purchaseAt >= filters.dateFrom!);
        if (filters.dateTo) result = result.filter(e => e.purchaseAt <= filters.dateTo! + 'T23:59:59Z');
        if (filters.amountMax != null) result = result.filter(e => base(e) <= filters.amountMax!);
        if (filters.amountMin != null) result = result.filter(e => base(e) >= filters.amountMin!);
        switch (filters.sortBy) {
            case 'date_asc': return [...result].sort((a, b) => a.purchaseAt.localeCompare(b.purchaseAt));
            case 'amount_desc': return [...result].sort((a, b) => base(b) - base(a));
            case 'amount_asc': return [...result].sort((a, b) => base(a) - base(b));
            default: return [...result].sort((a, b) => b.purchaseAt.localeCompare(a.purchaseAt));
        }
    }, [wsExp, filters, wsCur]);

    function toggleCategory(cat: string) {
        const cats = filters.categories.includes(cat) ? filters.categories.filter(c => c !== cat) : [...filters.categories, cat];
        setFilters({ categories: cats });
    }

    const activeFilterCount = (filters.categories.length || 0) + (filters.paymentMethods.length || 0) + (filters.dateFrom ? 1 : 0) + (filters.amountMax != null ? 1 : 0);

    return (
        <div className="page">
            {showReport && <ReportSheet initial={['expenses']} onClose={() => setShowReport(false)} />}
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'expenses')}</h1>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{filtered.length} transactions</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => setShowReport(true)} aria-label={tx('Create a report')}><FileDown size={16} /><span className="hide-sm">{tx('Report')}</span></button>
                    {!isViewer && <button className="btn btn-secondary" onClick={() => setShowBudget(true)}><Target size={16} />{' '}{tx('Budget')}</button>}
                    {!isViewer && <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} />{t(lang, 'add_expense')}</button>}
                </div>
            </div>

            {/* Search + Filter bar */}
            <div className="card mb-4" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
                        <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <input value={filters.search} onChange={e => setFilters({ search: e.target.value })} placeholder={t(lang, 'search_merchant')} />
                        {filters.search && <X size={14} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setFilters({ search: '' })} />}
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowFilters(!showFilters)} style={{ position: 'relative' }}>
                        <Filter size={14} />{t(lang, 'filters')}
                        {activeFilterCount > 0 && <span className="nav-badge" style={{ position: 'absolute', top: -6, right: -6 }}>{activeFilterCount}</span>}
                    </button>
                    <select className="form-input form-select" style={{ width: 'auto', padding: '8px 32px 8px 12px', fontSize: 13 }} value={filters.sortBy} onChange={e => setFilters({ sortBy: e.target.value as AppFilters['sortBy'] })}>
                        <option value="date_desc">{tx('Newest First')}</option>
                        <option value="date_asc">{tx('Oldest First')}</option>
                        <option value="amount_desc">{tx('Highest Amount')}</option>
                        <option value="amount_asc">{tx('Lowest Amount')}</option>
                    </select>
                    {activeFilterCount > 0 && <button className="btn btn-ghost btn-sm" onClick={resetFilters}><X size={14} />{' '}{tx('Clear')}</button>}
                </div>

                {/* Filters panel */}
                {showFilters && (
                    <div className="filter-panel animate-fadeIn">
                        <fieldset className="filter-group filter-group-wide">
                            <legend className="form-label">{tx('Category')}</legend>
                            <div className="chip-wrap">
                                {categories.map(cat => (
                                    <button type="button" key={cat.key} aria-pressed={filters.categories.includes(cat.key as CategoryKey)} className={`category-chip ${filters.categories.includes(cat.key as CategoryKey) ? 'selected' : ''}`} onClick={() => toggleCategory(cat.key)}>
                                        {cat.emoji} {cat.label}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        <fieldset className="filter-group">
                            <legend className="form-label">{tx('Date range')}</legend>
                            <div className="date-pair">
                                <label><span>{tx('From')}</span><input type="date" className="form-input" value={filters.dateFrom ?? ''} onChange={e => setFilters({ dateFrom: e.target.value || undefined })} /></label>
                                <label><span>{tx('To')}</span><input type="date" className="form-input" value={filters.dateTo ?? ''} onChange={e => setFilters({ dateTo: e.target.value || undefined })} /></label>
                            </div>
                        </fieldset>
                        <fieldset className="filter-group">
                            <legend className="form-label">{tx('Up to')}{' '}{wsCur} {(filters.amountMax ?? maxAmt).toLocaleString()}</legend>
                            <input type="range" aria-label={tx('Maximum amount')} min={0} max={maxAmt} value={Math.min(filters.amountMax ?? maxAmt, maxAmt)} onChange={e => setFilters({ amountMax: +e.target.value >= maxAmt ? undefined : +e.target.value })} style={{ width: '100%', accentColor: 'var(--primary)' }} />
                            <div className="form-label" style={{ marginTop: 14 }}>{tx('Payment method')}</div>
                            <div className="chip-wrap">
                                {paymentMethods.map(pm => (
                                    <button type="button" key={pm.key} aria-pressed={filters.paymentMethods.includes(pm.key as PaymentMethod)} className={`category-chip ${filters.paymentMethods.includes(pm.key as PaymentMethod) ? 'selected' : ''}`} onClick={() => { const pms = filters.paymentMethods.includes(pm.key as PaymentMethod) ? filters.paymentMethods.filter(p => p !== pm.key) : [...filters.paymentMethods, pm.key as PaymentMethod]; setFilters({ paymentMethods: pms }); }}>
                                        {pm.emoji} {pm.label}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {filtered.length === 0 ? (
                    <div className="empty-state" style={{ padding: '64px 0' }}>
                        <div className="empty-icon">🔍</div>
                        <div className="empty-title">{tx('No expenses found')}</div>
                        <div className="empty-desc">{tx('Try adjusting your filters or add a new expense')}</div>
                        {!isViewer && <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>{tx('+ Add Expense')}</button>}
                    </div>
                ) : (
                    <div style={{ padding: '6px 20px 10px' }}>
                        {groupByDay(filtered).map(([day, items]) => (
                            <section key={day} aria-label={dayLabel(day)}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '16px 4px 6px', borderBottom: '1px solid var(--line)' }}>
                                    <h3 style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', letterSpacing: 0 }}>{dayLabel(day)}</h3>
                                    <span className="tnum" style={{ fontSize: 13, color: 'var(--ink-3)' }}>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
                                </div>
                                <div className="ledger">
                                    <AnimatePresence initial={false}>
                                        {items.map(e => {
                                            const catInfo = getCategoryInfo(e.category);
                                            const pmInfo = getPaymentMethodInfo(e.paymentMethod);
                                            return (
                                                <motion.div key={e.id} layout className="ledger-row expense-row"
                                                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
                                                    style={{ gridTemplateColumns: isViewer ? '40px minmax(0,1fr) auto' : '40px minmax(0,1fr) auto auto' }}>
                                                    <CategoryIcon category={e.category} />
                                                    <div style={{ minWidth: 0 }}>
                                                        {e.details ? (
                                                            <button type="button" className="ledger-title sc-ledger-link" onClick={() => setViewId(e.id)} aria-label={`${tx('View items')}: ${e.merchant}`}>
                                                                <ShoppingCart size={13} aria-hidden /> <span translate="no">{e.merchant}</span> <span className="sc-badge">{e.details.itemCount} {tx('items')}</span>
                                                            </button>
                                                        ) : <div className="ledger-title" translate={e.merchant ? "no" : undefined}>{e.merchant || catInfo.label}</div>}
                                                        <div className="ledger-sub">
                                                            {catInfo.label} · {pmInfo?.label}{e.last4 ? ` ••${e.last4}` : ''}{e.createdByName ? ` · ${e.createdByName.split(' ')[0]}` : ''}{e.description ? ` · ${e.description}` : ''}
                                                            {e.source === 'autotrack' && <span className="at-ledger-badge">{tx('Added by AutoTrack')}</span>}
                                                        </div>
                                                    </div>
                                                    <div className="ledger-amount"><CurrencyDisplay amount={e.amount} currency={e.currency} entry={e} showOriginal hideAmounts={hideAmounts} /></div>
                                                    {!isViewer && (
                                                        <div className="row-actions" style={{ display: 'flex', gap: 2 }}>
                                                            <button className="icon-btn" aria-label={`Edit ${e.merchant}`} onClick={() => { setEditId(e.id); setShowAdd(true); }}><Edit2 size={15} /></button>
                                                            <button className="icon-btn" aria-label={`Delete ${e.merchant}`} style={{ color: 'var(--cinnabar)' }} onClick={() => setDeleteConfirmId(e.id)}><Trash2 size={15} /></button>
                                                        </div>
                                                    )}
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>

            {showAdd && <AddExpenseModal onClose={() => { setShowAdd(false); setEditId(undefined); }} editId={editId} />}
            {viewing && <ExpenseItems expense={viewing} onClose={() => { setViewId(null); if (window.location.search) window.history.replaceState(null, '', window.location.pathname); }}
                onEdit={isViewer ? undefined : () => { setEditId(viewing.id); setViewId(null); setShowAdd(true); }} />}

            {showBudget && (
                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowBudget(false); }}>
                    <Dialog labelledBy="dlg-budget" onClose={() => setShowBudget(false)} style={{ maxWidth: 420, padding: 24 }}>
                        <h2 id="dlg-budget" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{tx('Set Monthly Budget')}</h2>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{tx('Receive alerts when you approach or exceed this budget.')}</p>

                        <div className="form-group">
                            <label className="form-label" htmlFor="budget-amount">{tx('Monthly Budget (')}{currency})</label>
                            <input id="budget-amount" type="number" inputMode="decimal" min="0" className="form-input" value={budgetInput} onChange={e => setBudgetInput(e.target.value)} placeholder="0.00" data-autofocus />
                        </div>

                        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => { updateUser({ monthlyBudget: parseFloat(budgetInput) || 0, notifyBudget: true }); setShowBudget(false); }}>{tx('Save Budget')}</button>
                            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowBudget(false)}>{tx('Cancel')}</button>
                        </div>
                    </Dialog>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirmId && (() => {
                const expToDelete = expenses.find(ex => ex.id === deleteConfirmId);
                return (
                    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setDeleteConfirmId(null); }}>
                        <Dialog labelledBy="dlg-del-exp" onClose={() => setDeleteConfirmId(null)} style={{ maxWidth: 400, textAlign: 'center' }}>
                            <div style={{ fontSize: 48, marginBottom: 16 }} aria-hidden>🗑️</div>
                            <h3 id="dlg-del-exp" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{tx('Delete Expense?')}</h3>
                            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
                                {tx('Are you sure you want to delete')}{' '}<strong>{expToDelete?.merchant ?? tx('this expense')}</strong>{tx('? This action cannot be undone.')}
                            </p>
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                                <button className="btn btn-secondary" onClick={() => setDeleteConfirmId(null)}>{tx('Cancel')}</button>
                                <button className="btn btn-danger" onClick={() => { deleteExpense(deleteConfirmId); setDeleteConfirmId(null); }}>{tx('Delete')}</button>
                            </div>
                        </Dialog>
                    </div>
                );
            })()}
        </div>
    );
}
