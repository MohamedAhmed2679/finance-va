import type { CSSProperties, ReactNode } from 'react';
import { useDialog } from '../hooks/useDialog';

/** A modal panel with focus handling and Escape to close. Put it inside a .modal-overlay. */
export default function Dialog({ children, onClose, labelledBy, className = 'modal', style }: {
    children: ReactNode; onClose: () => void; labelledBy?: string; className?: string; style?: CSSProperties;
}) {
    const ref = useDialog<HTMLDivElement>(onClose);
    return <div ref={ref} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={style}>{children}</div>;
}
