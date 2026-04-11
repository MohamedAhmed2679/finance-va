import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { getCategoryInfo, getPaymentMethodInfo, getActiveCycleDates } from '../constants';
import { Search, Filter, X, Trash2, Plus, Edit2, Target } from 'lucide-react';
import AddExpenseModal from '../components/AddExpenseModal';
import CurrencyDisplay from '../components/CurrencyDisplay';

interface ExpensesProps { }

export default function ExpensesPage({ }: ExpensesProps) {
    const { workspaces, activeWorkspaceId, expenses, filters, setFilters, resetFilters, deleteExpense, user, updateUser, categories, paymentMethods } = useStore();
    const lang = user?.language ?? 'en';
    const currency = user?.defaultCurrency ?? 'USD';
    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
    const isOwner = user?.id && (activeWorkspace?.ownerId === user.id || activeWorkspace?.ownerId === user.email);
    const userRole = activeWorkspace?.members.find(m => m.uid === user?.id || (m.email === user?.email && m.email))?.role || (isOwner ? 'owner' : 'viewer');
    const isViewer = userRole === 'viewer' && !isOwner;

    // Automatically set default date filters to active cycle if none are set.
    useEffect(() => {
        if (!filters.dateFrom && !filters.dateTo && activeWorkspace) {
            const cycle = getActiveCycleDates(new Date(), activeWorkspace.cycleStartDay ?? 1);
            setFilters({ dateFrom: cycle.start, dateTo: cycle.end });
        }
    }, [activeWorkspace?.cycleStartDay, filters.dateFrom, filters.dateTo, activeWorkspace, setFilters]);

    const [showFilters, setShowFilters] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [editId, setEditId] = useState<string | undefined>();
    const [showBudget, setShowBudget] = useState(false);
    const [budgetInput, setBudgetInput] = useState((user?.monthlyBudget ?? 0).toString());
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const hideAmounts = user?.hideAmounts ?? false;

    const wsExp = expenses.filter(e => !e.deleted && e.workspaceId === activeWorkspaceId);
    const maxAmt = Math.max(...wsExp.map(e => e.amount), 100);

    const filtered = useMemo(() => {
        let result = wsExp;
        if (filters.search) result = result.filter(e => e.merchant.toLowerCase().includes(filters.search.toLowerCase()) || e.description.toLowerCase().includes(filters.search.toLowerCase()));
        if (filters.categories.length) result = result.filter(e => filters.categories.includes(e.category));
        if (filters.paymentMethods.length) result = result.filter(e => filters.paymentMethods.includes(e.paymentMethod));
        if (filters.dateFrom) result = result.filter(e => e.purchaseAt >= filters.dateFrom!);
        if (filters.dateTo) result = result.filter(e => e.purchaseAt <= filters.dateTo! + 'T23:59:59Z');
        if (filters.amountMax != null) result = result.filter(e => e.amount <= filters.amountMax!);
        if (filters.amountMin != null) result = result.filter(e => e.amount >= filters.amountMin!);
        switch (filters.sortBy) {
            case 'date_asc': return [...result].sort((a, b) => a.purchaseAt.localeCompare(b.purchaseAt));
            case 'amount_desc': return [...result].sort((a, b) => b.amount - a.amount);
            case 'amount_asc': return [...result].sort((a, b) => a.amount - b.amount);
            default: return [...result].sort((a, b) => b.purchaseAt.localeCompare(a.purchaseAt));
        }
    }, [wsExp, filters]);

    function toggleCategory(cat: string) {
        const cats = filters.categories.includes(cat) ? filters.categories.filter(c => c !== cat) : [...filters.categories, cat];
        setFilters({ categories: cats });
    }

    const activeFilterCount = (filters.categories.length || 0) + (filters.paymentMethods.length || 0) + (filters.dateFrom ? 1 : 0) + (filters.amountMax != null ? 1 : 0);

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'expenses')}</h1>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{filtered.length} transactions</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    {!isViewer && <button className="btn btn-secondary" onClick={() => setShowBudget(true)}><Target size={16} /> Budget</button>}
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
                    <select className="form-input form-select" style={{ width: 'auto', padding: '8px 32px 8px 12px', fontSize: 13 }} value={filters.sortBy} onChange={e => setFilters({ sortBy: e.target.value as any })}>
                        <option value="date_desc">Newest First</option>
                        <option value="date_asc">Oldest First</option>
                        <option value="amount_desc">Highest Amount</option>
                        <option value="amount_asc">Lowest Amount</option>
                    </select>
                    {activeFilterCount > 0 && <button className="btn btn-ghost btn-sm" onClick={resetFilters}><X size={14} /> Clear</button>}
                </div>

                {/* Filters panel */}
                {showFilters && (
                    <div className="animate-fadeIn" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                            <div>
                                <div className="form-label">Category</div>
                                <div className="category-chips">
                                    {categories.map(cat => (
                                        <div key={cat.key} className={`category - chip ${filters.categories.includes(cat.key as any) ? 'selected' : ''} `} onClick={() => toggleCategory(cat.key)}>
                                            {cat.emoji} {cat.label}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="form-label">Date Range</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <input type="date" className="form-input" value={filters.dateFrom ?? ''} onChange={e => setFilters({ dateFrom: e.target.value || undefined })} />
                                    <input type="date" className="form-input" value={filters.dateTo ?? ''} onChange={e => setFilters({ dateTo: e.target.value || undefined })} />
                                </div>
                            </div>
                            <div>
                                <div className="form-label">Max Amount: ${filters.amountMax ?? maxAmt}</div>
                                <input type="range" min={0} max={maxAmt} value={filters.amountMax ?? maxAmt} onChange={e => setFilters({ amountMax: +e.target.value })} style={{ width: '100%', accentColor: 'var(--primary)' }} />
                                <div className="form-label" style={{ marginTop: 12 }}>Payment Method</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {paymentMethods.map(pm => (
                                        <div key={pm.key} className={`category - chip ${filters.paymentMethods.includes(pm.key as any) ? 'selected' : ''} `} onClick={() => { const pms = filters.paymentMethods.includes(pm.key as any) ? filters.paymentMethods.filter(p => p !== pm.key) : [...filters.paymentMethods, pm.key as any]; setFilters({ paymentMethods: pms }); }}>
                                            {pm.emoji} {pm.label}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {filtered.length === 0 ? (
                    <div className="empty-state" style={{ padding: '64px 0' }}>
                        <div className="empty-icon">🔍</div>
                        <div className="empty-title">No expenses found</div>
                        <div className="empty-desc">Try adjusting your filters or add a new expense</div>
                        {!isViewer && <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add Expense</button>}
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>{t(lang, 'merchant')}</th>
                                <th>{t(lang, 'category')}</th>
                                <th>Payment</th>
                                <th>{t(lang, 'date')}</th>
                                <th>{t(lang, 'user')}</th>
                                <th style={{ textAlign: 'right' }}>{t(lang, 'amount')}</th>
                                {!isViewer && <th style={{ width: 80, textAlign: 'center' }}>Actions</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(e => {
                                const catInfo = getCategoryInfo(e.category);
                                const pmInfo = getPaymentMethodInfo(e.paymentMethod);
                                return (
                                    <tr key={e.id} className="animate-fadeIn">
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${catInfo.color} 20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{catInfo.emoji}</div>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: 14 }}>{e.merchant}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.description}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td><span className={`badge badge - ${e.category} `}>{catInfo.label}</span></td>
                                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{pmInfo.emoji} {pmInfo.label}{e.last4 ? ` ••${e.last4} ` : ''}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{new Date(e.purchaseAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,var(--primary),#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>{e.createdByName[0]}</div>
                                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{e.createdByName.split(' ')[0]}</span>
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 15, color: e.amount > 100 ? 'var(--danger)' : e.amount > 50 ? 'var(--warning)' : 'var(--text-primary)' }}><CurrencyDisplay amount={e.amount} currency={e.currency} hideAmounts={hideAmounts} /></td>
                                        {!isViewer && (
                                            <td style={{ width: 80, textAlign: 'center' }}>
                                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                    <button
                                                        className="btn btn-ghost btn-icon btn-sm"
                                                        title="Edit"
                                                        onClick={() => { setEditId(e.id); setShowAdd(true); }}
                                                        style={{ color: 'var(--primary-light)' }}
                                                    >
                                                        <Edit2 size={15} />
                                                    </button>
                                                    <button
                                                        className="btn btn-ghost btn-icon btn-sm"
                                                        title="Delete"
                                                        onClick={() => setDeleteConfirmId(e.id)}
                                                        style={{ color: 'var(--danger)' }}
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {showAdd && <AddExpenseModal onClose={() => { setShowAdd(false); setEditId(undefined); }} editId={editId} />}

            {showBudget && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
                    <div className="card animate-scale-up" style={{ width: 400, maxWidth: '100%', padding: 24 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Set Monthly Budget</h2>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Receive alerts when you approach or exceed this budget.</p>

                        <div className="form-group">
                            <label className="form-label">Monthly Budget ({currency})</label>
                            <input type="number" className="form-input" value={budgetInput} onChange={e => setBudgetInput(e.target.value)} placeholder="0.00" autoFocus />
                        </div>

                        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => { updateUser({ monthlyBudget: parseFloat(budgetInput) || 0, notifyBudget: true }); setShowBudget(false); }}>Save Budget</button>
                            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowBudget(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirmId && (() => {
                const expToDelete = expenses.find(ex => ex.id === deleteConfirmId);
                return (
                    <div className="modal-overlay" onClick={() => setDeleteConfirmId(null)}>
                        <div className="modal" onClick={ev => ev.stopPropagation()} style={{ maxWidth: 400, textAlign: 'center' }}>
                            <div style={{ fontSize: 48, marginBottom: 16 }}>🗑️</div>
                            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Delete Expense?</h3>
                            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
                                Are you sure you want to delete <strong>{expToDelete?.merchant ?? 'this expense'}</strong>?
                                This action cannot be undone.
                            </p>
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                                <button className="btn btn-secondary" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
                                <button className="btn btn-danger" onClick={() => { deleteExpense(deleteConfirmId); setDeleteConfirmId(null); }}>Delete</button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
