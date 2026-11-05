import { tx } from '../i18n/translations';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Mic, MessageSquareText, PenLine, TrendingUp, ScanLine } from 'lucide-react';

interface QuickAddMenuProps {
    onManualAdd: () => void;
    onVoiceAdd: () => void;
    onScanAdd: () => void;
    onPasteAdd: () => void;
    onAddIncome: () => void;
}

export default function QuickAddMenu({ onManualAdd, onVoiceAdd, onScanAdd, onPasteAdd, onAddIncome }: QuickAddMenuProps) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [open]);

    const actions = [
        { label: tx('Add income'), icon: TrendingUp, tint: 'var(--gain)', bg: 'var(--gain-soft)', run: onAddIncome },
        { label: tx('Paste bank SMS'), icon: MessageSquareText, tint: 'var(--sky)', bg: 'var(--sky-soft)', run: onPasteAdd },
        { label: tx('Scan or upload receipt'), icon: ScanLine, tint: 'var(--gain)', bg: 'var(--gain-soft)', run: onScanAdd },
        { label: tx('Say an expense'), icon: Mic, tint: 'var(--brass)', bg: 'var(--brass-soft)', run: onVoiceAdd },
        { label: tx('Add expense'), icon: PenLine, tint: 'var(--note)', bg: 'var(--note-soft)', run: onManualAdd },
    ];

    return (
        <>
            <AnimatePresence>
                {open && (
                    <motion.div className="fab-scrim" onClick={() => setOpen(false)}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
                )}
            </AnimatePresence>
            <div className="quick-add-container">
                <AnimatePresence>
                    {open && (
                        <div className="fab-menu" role="menu">
                            {actions.map((a, i) => (
                                <motion.button key={a.label} role="menuitem" className="fab-action"
                                    initial={{ opacity: 0, y: 14, scale: 0.92 }}
                                    animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: (actions.length - 1 - i) * 0.04, type: 'spring', stiffness: 480, damping: 30 } }}
                                    exit={{ opacity: 0, y: 10, scale: 0.94, transition: { duration: 0.12 } }}
                                    onClick={() => { setOpen(false); a.run(); }}>
                                    {a.label}
                                    <i style={{ background: a.bg, color: a.tint }}><a.icon size={18} /></i>
                                </motion.button>
                            ))}
                        </div>
                    )}
                </AnimatePresence>
                <motion.button className="fab" onClick={() => setOpen(o => !o)}
                    aria-label={open ? tx('Close add menu') : tx('Add')} aria-expanded={open}
                    whileTap={{ scale: 0.92 }} animate={{ rotate: open ? 45 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 24 }}>
                    <Plus size={26} strokeWidth={2.4} />
                </motion.button>
            </div>
        </>
    );
}
