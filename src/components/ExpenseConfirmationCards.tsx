import { useState } from 'react';

import type { ParsedExpense } from '../services/aiExpenseParser';
import { CATEGORIES } from '../constants';
import { Trash2, AlertTriangle, Check } from 'lucide-react';
import CurrencySelect from './CurrencySelect';

interface ExpenseConfirmationCardsProps {
    expenses: ParsedExpense[];
    onConfirm: (expenses: ParsedExpense[]) => void;
    onCancel: () => void;
}

export default function ExpenseConfirmationCards({ expenses: initialExpenses, onConfirm, onCancel }: ExpenseConfirmationCardsProps) {
    const [expenses, setExpenses] = useState<ParsedExpense[]>(initialExpenses);

    const handleUpdate = (index: number, updates: Partial<ParsedExpense>) => {
        const newExpenses = [...expenses];
        newExpenses[index] = { ...newExpenses[index], ...updates };
        setExpenses(newExpenses);
    };

    const handleRemove = (index: number) => {
        setExpenses(expenses.filter((_, i) => i !== index));
    };

    if (expenses.length === 0) {
        return (
            <div className="sheet-overlay">
                <div className="animate-slideUp" style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'var(--bg-surface)', borderTopLeftRadius: 'var(--radius-xl)', borderTopRightRadius: 'var(--radius-xl)',
                    padding: '32px 24px', boxShadow: 'var(--shadow-lg)', textAlign: 'center'
                }}>
                    <div style={{ marginBottom: 16 }}>No items detected or all items removed.</div>
                    <button className="btn btn-primary" onClick={onCancel}>Close</button>
                </div>
            </div>
        );
    }

    return (
        <div className="sheet-overlay">
            <div className="animate-slideUp" style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, top: 40,
                background: 'var(--bg-base)', borderTopLeftRadius: 'var(--radius-xl)', borderTopRightRadius: 'var(--radius-xl)',
                padding: '24px', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div>
                        <h3 style={{ fontSize: 20, fontWeight: 700 }}>Review Expenses</h3>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{expenses.length} item{expenses.length > 1 ? 's' : ''} extracted</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => onConfirm(expenses)}>
                        <Check size={16} /> Confirm All
                    </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
                    {expenses.map((exp, i) => {
                        const isLowConfidence = exp.confidence < 0.7;
                        return (
                            <div key={i} className="card" style={{ 
                                border: isLowConfidence ? '1px solid var(--warning)' : '1px solid var(--border-default)',
                                padding: 16
                            }}>
                                {isLowConfidence && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warning)', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
                                        <AlertTriangle size={14} /> Please verify details
                                    </div>
                                )}
                                
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, marginBottom: 12 }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Merchant / Description</label>
                                        <input className="form-input" value={exp.merchant || exp.description} onChange={e => handleUpdate(i, { merchant: e.target.value })} />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Amount</label>
                                        <input type="number" className="form-input" value={exp.amount || ''} onChange={e => handleUpdate(i, { amount: parseFloat(e.target.value) || 0 })} />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Category</label>
                                        <select className="form-input form-select" value={exp.category} onChange={e => handleUpdate(i, { category: e.target.value })}>
                                            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <CurrencySelect value={exp.currency} onChange={(c) => handleUpdate(i, { currency: c })} label="Currency" />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                                    <button className="btn btn-ghost btn-sm" onClick={() => handleRemove(i)} style={{ color: 'var(--danger)' }}>
                                        <Trash2 size={14} /> Remove
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
                
                <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 16, display: 'flex', gap: 12 }}>
                    <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
                    <button className="btn btn-primary" style={{ flex: 2 }} onClick={() => onConfirm(expenses)}>
                        Confirm & Save
                    </button>
                </div>
            </div>
        </div>
    );
}
