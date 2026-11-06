import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog behaviour for the element the returned ref is attached to:
 *  - focus moves into the dialog when it opens (an element marked data-autofocus first)
 *  - Tab and Shift+Tab stay inside it
 *  - Escape closes it (only the top-most dialog reacts)
 *  - focus returns to whatever was focused before, when it closes
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void, enabled = true) {
    const ref = useRef<T>(null);
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; });

    useEffect(() => {
        const el = ref.current;
        if (!enabled || !el) return;
        el.setAttribute('data-dialog', '');
        const before = document.activeElement as HTMLElement | null;
        const items = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.getClientRects().length > 0);
        if (!el.contains(document.activeElement)) {
            const first = el.querySelector<HTMLElement>('[data-autofocus]') || items()[0];
            if (first) first.focus({ preventScroll: true });
            else { el.tabIndex = -1; el.focus({ preventScroll: true }); }
        }
        const topmost = () => { const all = document.querySelectorAll('[data-dialog]'); return all[all.length - 1] === el; };
        const onKey = (e: KeyboardEvent) => {
            if (!topmost()) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); return; }
            if (e.key !== 'Tab') return;
            const list = items();
            if (!list.length) { e.preventDefault(); return; }
            const first = list[0], last = list[list.length - 1];
            const active = document.activeElement as HTMLElement | null;
            if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            el.removeAttribute('data-dialog');
            if (before && document.contains(before)) before.focus({ preventScroll: true });
        };
    }, [enabled]);

    return ref;
}
