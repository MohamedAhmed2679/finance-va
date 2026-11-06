import { useEffect, useState } from 'react';
import { X, ShoppingCart, ImageOff, Edit2 } from 'lucide-react';
import { tx } from '../i18n/translations';
import type { Expense } from '../store/useStore';
import { formatMinor, formatQty } from './money';
import { signedUrls } from './cartService';

/** Read-only view of a Smart Cart purchase: the saved snapshot, never the live cart. */
export default function ExpenseItems({ expense, onClose, onEdit }: { expense: Expense; onClose: () => void; onEdit?: () => void }) {
    const d = expense.details!;
    const [urls, setUrls] = useState<Record<string, string>>({});
    useEffect(() => {
        const paths = d.items.flatMap(i => i.imagePaths || []);
        if (paths.length) signedUrls(paths).then(setUrls).catch(() => {});
    }, [d.items]);
    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onClose]);
    const m = (v: number | null) => (v == null ? '—' : `${formatMinor(v)} ${d.currency}`);
    const mode = d.vatMode === 'none' ? tx('No VAT added') : d.vatMode === 'add' ? `${tx('VAT added')} (${d.vatRateBp / 100}%)` : `${tx('VAT included')} (${d.vatRateBp / 100}%)`;

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal sc-sheet animate-slideUp" role="dialog" aria-modal="true" aria-labelledby="sc-exp-title">
                <div className="sheet-grip" aria-hidden />
                <div className="modal-header">
                    <div>
                        <h2 className="modal-title" id="sc-exp-title"><ShoppingCart size={18} /> <span translate="no">{expense.merchant}</span></h2>
                        <div className="sc-muted">{new Date(expense.purchaseAt).toLocaleString()}{d.cartName ? <> · <span translate="no">{d.cartName}</span></> : null}</div>
                    </div>
                    <button className="modal-close" onClick={onClose} aria-label={tx('Close')}><X size={20} /></button>
                </div>
                <dl className="sc-breakdown">
                    <div className="sc-grand"><dt>{tx('Recorded amount')}</dt><dd translate="no">{m(d.recordedMinor)}</dd></div>
                    <div><dt>{tx('Estimated total')}</dt><dd translate="no">{m(d.estimatedTotalMinor)}</dd></div>
                    {d.actualTotalMinor != null && <>
                        <div><dt>{tx('Actual amount paid')}</dt><dd translate="no">{m(d.actualTotalMinor)}</dd></div>
                        <div><dt>{tx('Difference')}</dt><dd translate="no">{m(d.differenceMinor)}</dd></div>
                    </>}
                    <div><dt>{tx('Subtotal')}</dt><dd translate="no">{m(d.subtotalMinor)}</dd></div>
                    <div><dt>{mode}</dt><dd translate="no">{m(d.vatMinor)}</dd></div>
                    {d.vatMode === 'included' && <div><dt>{tx('Before VAT')}</dt><dd translate="no">{m(d.beforeVatMinor)}</dd></div>}
                    {d.exemptMinor > 0 && <div><dt>{tx('Of which no VAT / exempt')}</dt><dd translate="no">{m(d.exemptMinor)}</dd></div>}
                    <div><dt>{tx('Items')}</dt><dd>{d.itemCount} · {tx('qty')} {formatQty(d.totalQtyMilli)}</dd></div>
                </dl>
                <ul className="sc-sum-items sc-exp-items">
                    {d.items.map((i, n) => (
                        <li key={n}>
                            {i.imagePaths?.[0] ? (urls[i.imagePaths[0]] ? <img className="sc-thumb" src={urls[i.imagePaths[0]]} alt="" /> : <span className="sc-thumb sc-thumb-ph" title={tx('Photos are only visible to the person who scanned them.')}><ImageOff size={14} /></span>) : null}
                            <span>
                                <span translate="no">{i.name}</span>
                                <span className="sc-muted"> {formatQty(i.qtyMilli)}{i.unitBasis !== 'each' ? ` ${i.unitBasis}` : ''} × {formatMinor(i.unitPriceMinor)}{i.vatExempt ? ` · ${tx('No VAT')}` : ''}{i.expiryDate ? ` · ${tx('Exp.')} ${i.expiryDate}` : ''}{i.productionDate ? ` · ${tx('Prod.')} ${i.productionDate}` : ''}{i.packSize ? ` · ${i.packSize}` : ''}</span>
                            </span>
                            <b translate="no">{formatMinor(i.lineMinor)}</b>
                        </li>
                    ))}
                </ul>
                <p className="sc-muted">{tx('These items were saved when the purchase was confirmed and don\'t change later.')}</p>
                {onEdit && <div className="sc-sheet-actions"><button className="btn btn-secondary" onClick={onEdit}><Edit2 size={16} />{tx('Edit expense details')}</button></div>}
            </div>
        </div>
    );
}
