import { useState } from 'react';
import { Plus, Mic, ReceiptText, PenLine, TrendingUp } from 'lucide-react';


interface QuickAddMenuProps {
    onManualAdd: () => void;
    onVoiceAdd: () => void;
    onScanAdd: () => void;
    onAddIncome: () => void;
}

export default function QuickAddMenu({ onManualAdd, onVoiceAdd, onScanAdd, onAddIncome }: QuickAddMenuProps) {
    const [open, setOpen] = useState(false);

    return (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
            {/* Expanded Menu Options */}
            <div style={{
                position: 'absolute', bottom: 70, right: 0,
                display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end',
                pointerEvents: open ? 'auto' : 'none'
            }}>
                <button 
                    onClick={() => { setOpen(false); onAddIncome(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                        background: 'var(--bg-surface)', border: '1px solid var(--border-default)', 
                        borderRadius: 'var(--radius-full)', color: 'var(--text-primary)',
                        cursor: 'pointer', transform: `scale(${open ? 1 : 0})`, opacity: open ? 1 : 0,
                        transition: 'all 200ms cubic-bezier(0.34, 1.56, 0.64, 1) 0ms'
                    }}
                >
                    <span style={{ fontSize: 14, fontWeight: 500 }}>Add Income</span>
                    <div style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--success-muted)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <TrendingUp size={18} />
                    </div>
                </button>
                <button 
                    onClick={() => { setOpen(false); onScanAdd(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                        background: 'var(--bg-surface)', border: '1px solid var(--border-default)', 
                        borderRadius: 'var(--radius-full)', color: 'var(--text-primary)',
                        cursor: 'pointer', transform: `scale(${open ? 1 : 0})`, opacity: open ? 1 : 0,
                        transition: 'all 200ms cubic-bezier(0.34, 1.56, 0.64, 1) 40ms'
                    }}
                >
                    <span style={{ fontSize: 14, fontWeight: 500 }}>Scan receipt</span>
                    <div style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--info-muted)', color: 'var(--info)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ReceiptText size={18} />
                    </div>
                </button>
                <button 
                    onClick={() => { setOpen(false); onVoiceAdd(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                        background: 'var(--bg-surface)', border: '1px solid var(--border-default)', 
                        borderRadius: 'var(--radius-full)', color: 'var(--text-primary)',
                        cursor: 'pointer', transform: `scale(${open ? 1 : 0})`, opacity: open ? 1 : 0,
                        transition: 'all 200ms cubic-bezier(0.34, 1.56, 0.64, 1) 80ms'
                    }}
                >
                    <span style={{ fontSize: 14, fontWeight: 500 }}>Voice entry</span>
                    <div style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--accent-muted)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Mic size={18} />
                    </div>
                </button>
                <button 
                    onClick={() => { setOpen(false); onManualAdd(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                        background: 'var(--bg-surface)', border: '1px solid var(--border-default)', 
                        borderRadius: 'var(--radius-full)', color: 'var(--text-primary)',
                        cursor: 'pointer', transform: `scale(${open ? 1 : 0})`, opacity: open ? 1 : 0,
                        transition: 'all 200ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms'
                    }}
                >
                    <span style={{ fontSize: 14, fontWeight: 500 }}>Add Expense</span>
                    <div style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--warning-muted)', color: 'var(--warning)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <PenLine size={18} />
                    </div>
                </button>
            </div>

            {/* Main FAB */}
            <button 
                onClick={() => setOpen(!open)}
                style={{
                    width: 56, height: 56, borderRadius: 28, background: 'var(--accent)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    border: 'none', outline: 'none', transition: 'all 200ms ease',
                    transform: open ? 'rotate(45deg)' : 'none'
                }}
            >
                <Plus size={24} strokeWidth={2.5} />
            </button>
        </div>
    );
}
