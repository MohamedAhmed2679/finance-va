import { useState } from 'react';
import { useStore } from '../store/useStore';
import { X, MessageSquare, RefreshCw } from 'lucide-react';
import { parseExpensesText } from '../services/aiExpenseParser';
import type { ParsedExpense } from '../services/aiExpenseParser';

interface SMSParserProps {
    onClose: () => void;
    onAdd: (expenses: ParsedExpense[]) => void;
}

export default function SMSParser({ onClose, onAdd }: SMSParserProps) {
    const { currency } = useStore();
    const [text, setText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');

    const handleExtract = async () => {
        if (!text.trim()) return;
        setIsProcessing(true);
        setError('');
        
        try {
            // Reusing the same AI parser designed to extract expenses from raw text
            const expenses = await parseExpensesText(text, currency);
            if (expenses.length === 0) {
                throw new Error("No expenses could be detected in the provided text. Please try again.");
            }
            onAdd(expenses);
        } catch (err: any) {
            setError(err.message || "Failed to process SMS messages. Please check the text and try again.");
            setIsProcessing(false);
        }
    };

    return (
        <div className="sheet-overlay">
            <div className="animate-slideUp" style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'var(--bg-surface)', borderTopLeftRadius: 'var(--radius-xl)', borderTopRightRadius: 'var(--radius-xl)',
                padding: '32px 24px', boxShadow: 'var(--shadow-lg)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <h3 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <MessageSquare size={20} style={{ color: 'var(--info)' }} />
                        SMS Scanning
                    </h3>
                    <button onClick={onClose} className="btn-ghost btn-icon"><X size={20} /></button>
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                    Paste your bank or credit card SMS messages below. You can paste multiple messages at once. Our AI will automatically extract the merchant, amount, category, and date.
                </div>

                {error && (
                    <div style={{ background: 'var(--warning-soft)', color: 'var(--warning)', padding: '12px 16px', borderRadius: 'var(--radius-md)', marginBottom: 20, fontSize: 13, fontWeight: 500 }}>
                        {error}
                    </div>
                )}

                <div className="form-group">
                    <textarea 
                        className="form-input" 
                        rows={6}
                        placeholder="e.g. Purchase of USD 12.50 at STARBUCKS on 24-03-2026 from Card ending in 4242..."
                        value={text}
                        onChange={e => setText(e.target.value)}
                        style={{ resize: 'vertical' }}
                        disabled={isProcessing}
                    />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button 
                        className="btn btn-primary w-full" 
                        onClick={handleExtract} 
                        disabled={isProcessing || !text.trim()}
                        style={{ height: 48 }}
                    >
                        {isProcessing ? (
                            <><RefreshCw size={18} className="animate-spin" /> Extracting...</>
                        ) : (
                            "Extract Expenses"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
