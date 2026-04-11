import { useState } from 'react';
import { useStore, type MonthlyBill } from '../store/useStore';
import { t } from '../i18n/translations';
import { CalendarSync, Plus, CheckCircle, Circle, Trash2, CalendarDays, Edit2 } from 'lucide-react';
import { format } from 'date-fns';

export default function BillsPage() {
    const { user, bills, workspaces, activeWorkspaceId, categories, addBill, updateBill, deleteBill, markBillPaid } = useStore();
    const lang = user?.language ?? 'en';

    const [showAdd, setShowAdd] = useState(false);
    const [billName, setBillName] = useState('');
    const [billAmount, setBillAmount] = useState('');
    const [billCategory, setBillCategory] = useState(categories[0]?.key || 'housing');
    const [billDueDay, setBillDueDay] = useState<number>(1);

    // Edit state
    const [editingBillId, setEditingBillId] = useState<string | null>(null);
    const [editBillName, setEditBillName] = useState('');
    const [editBillAmount, setEditBillAmount] = useState('');
    const [editBillCategory, setEditBillCategory] = useState('');
    const [editBillDueDay, setEditBillDueDay] = useState<number>(1);

    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
    const userRole = activeWorkspace?.members.find(m => m.uid === user?.id)?.role || 'viewer';
    const isViewer = userRole === 'viewer';
    const currentMonth = format(new Date(), 'yyyy-MM');

    // Filter bills for current workspace
    const wsBills = bills.filter(b => b.workspaceId === activeWorkspaceId);

    // Split bills into "Due This Month" and "Paid"
    const dueBills = wsBills.filter(b => b.lastPaidMonth !== currentMonth).sort((a, b) => a.dueDate - b.dueDate);
    const paidBills = wsBills.filter(b => b.lastPaidMonth === currentMonth).sort((a, b) => a.dueDate - b.dueDate);

    function handleAddBill(e: React.FormEvent) {
        e.preventDefault();
        if (!billName || !billAmount || !activeWorkspace) return;

        addBill({
            workspaceId: activeWorkspace.id,
            createdByUid: user?.id || 'sys',
            name: billName,
            amount: parseFloat(billAmount),
            currency: activeWorkspace.currency,
            category: billCategory,
            dueDate: billDueDay
        });

        setShowAdd(false);
        setBillName('');
        setBillAmount('');
        setBillDueDay(1);
    }

    function startEdit(bill: MonthlyBill) {
        setEditingBillId(bill.id);
        setEditBillName(bill.name);
        setEditBillAmount(bill.amount.toString());
        setEditBillCategory(bill.category);
        setEditBillDueDay(bill.dueDate);
    }

    function handleEditBill(e: React.FormEvent) {
        e.preventDefault();
        if (!editingBillId || !editBillName || !editBillAmount) return;

        updateBill(editingBillId, {
            name: editBillName,
            amount: parseFloat(editBillAmount),
            category: editBillCategory,
            dueDate: editBillDueDay
        });
        setEditingBillId(null);
    }

    function renderBillCard(bill: MonthlyBill, isPaid: boolean) {
        const cat = categories.find(c => c.key === bill.category);
        const daySuffix = (d: number) => {
            if (d > 3 && d < 21) return 'th';
            switch (d % 10) {
                case 1: return "st";
                case 2: return "nd";
                case 3: return "rd";
                default: return "th";
            }
        };

        return (
            <div key={bill.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', opacity: isPaid ? 0.6 : 1, transition: 'all 0.2s ease-in-out' }}>
                <div onClick={() => !isPaid && !isViewer && markBillPaid(bill.id, currentMonth)} style={{ cursor: isPaid || isViewer ? 'default' : 'pointer' }}>
                    {isPaid ? (
                        <CheckCircle size={28} style={{ color: 'var(--success)' }} />
                    ) : (
                        <Circle size={28} style={{ color: 'var(--text-muted)' }} />
                    )}
                </div>

                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 16, fontWeight: 700 }}>{bill.name}</span>
                        {cat && <span className="badge" style={{ background: `${cat.color}20`, color: cat.color }}>{cat.emoji} {cat.label}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CalendarDays size={14} /> Due on the {bill.dueDate}{daySuffix(bill.dueDate)} of every month
                    </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: isPaid ? 'var(--text-muted)' : 'var(--text)' }}>
                        {bill.amount.toLocaleString(lang, { style: 'currency', currency: bill.currency })}
                    </div>
                    {isPaid && (() => {
                        const nextMonth = new Date();
                        nextMonth.setMonth(nextMonth.getMonth() + 1);
                        nextMonth.setDate(bill.dueDate);
                        // zero out time for accurate day calc
                        nextMonth.setHours(0, 0, 0, 0);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const diffTime = nextMonth.getTime() - today.getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                        return (
                            <div style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>
                                Next payment in {diffDays} days
                            </div>
                        );
                    })()}
                </div>

                 {!isViewer && (
                    <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); startEdit(bill); }}>
                            <Edit2 size={16} />
                        </button>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this commitment?')) deleteBill(bill.id); }}>
                            <Trash2 size={16} style={{ color: 'var(--danger)' }} />
                        </button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <>
            <div className="page animate-fadeIn">
                <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 className="page-title">{t(lang, 'bills_commitments')}</h1>
                        <p className="page-subtitle">Track recurring payments and automatically log expenses</p>
                    </div>
                    {!isViewer && (
                        <button className="btn btn-primary" onClick={() => setShowAdd(true)} title={t(lang, 'add_bill') || 'Add Bill'}>
                            <Plus size={16} /> Add Bill
                        </button>
                    )}
                </header>

                {showAdd && (
                    <div className="card mb-6 animate-fadeIn" style={{ borderLeft: '4px solid var(--accent)' }}>
                        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Add New Monthly Commitment</h3>
                        <form onSubmit={handleAddBill} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Bill Name (e.g. Rent, Netflix)</label>
                                <input type="text" className="form-input" value={billName} onChange={e => setBillName(e.target.value)} required placeholder="Netflix" autoFocus />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Amount ({activeWorkspace?.currency})</label>
                                <input type="number" step="0.01" className="form-input" value={billAmount} onChange={e => setBillAmount(e.target.value)} required placeholder="15.00" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Category</label>
                                <select className="form-input form-select" value={billCategory} onChange={e => setBillCategory(e.target.value)}>
                                    {categories.map(c => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Due Day (1-31)</label>
                                <input type="number" min="1" max="31" className="form-input" value={billDueDay} onChange={e => setBillDueDay(parseInt(e.target.value))} required />
                            </div>
                            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
                                <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save Commitment</button>
                            </div>
                        </form>
                    </div>
                )}

                {editingBillId && (
                    <div className="card mb-6 animate-fadeIn" style={{ borderLeft: '4px solid var(--accent)' }}>
                        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Edit Commitment</h3>
                        <form onSubmit={handleEditBill} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div className="form-group">
                                <label className="form-label">Bill Name (e.g. Rent, Netflix)</label>
                                <input type="text" className="form-input" value={editBillName} onChange={e => setEditBillName(e.target.value)} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Amount ({activeWorkspace?.currency})</label>
                                <input type="number" step="0.01" className="form-input" value={editBillAmount} onChange={e => setEditBillAmount(e.target.value)} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Category</label>
                                <select className="form-input form-select" value={editBillCategory} onChange={e => setEditBillCategory(e.target.value)}>
                                    {categories.map(c => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Due Day (1-31)</label>
                                <input type="number" min="1" max="31" className="form-input" value={editBillDueDay} onChange={e => setEditBillDueDay(parseInt(e.target.value))} required />
                            </div>
                            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
                                <button type="button" className="btn btn-secondary" onClick={() => setEditingBillId(null)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save Changes</button>
                            </div>
                        </form>
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                    <div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CalendarSync size={20} style={{ color: 'var(--accent)' }} />
                            {t(lang, 'due_this_month')} ({dueBills.length})
                        </h2>
                        {dueBills.length === 0 ? (
                            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                                No bills due! You're all caught up for {format(new Date(), 'MMMM')}.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {dueBills.map(b => renderBillCard(b, false))}
                            </div>
                        )}
                    </div>

                    {paidBills.length > 0 && (
                        <div>
                            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                                <CheckCircle size={20} style={{ color: 'var(--success)' }} />
                                {t(lang, 'pending_next_month') || 'Pending for next month'} ({paidBills.length})
                            </h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {paidBills.map(b => renderBillCard(b, true))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
