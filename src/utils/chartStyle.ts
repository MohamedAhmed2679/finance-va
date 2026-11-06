import type { CSSProperties } from 'react';

/** Chart tooltips: a solid card in both themes (the surface colour is see-through in some places). */
export const CHART_TOOLTIP: CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 10, fontSize: 13,
    color: 'var(--ink)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)', padding: '8px 12px', direction: 'inherit',
};
