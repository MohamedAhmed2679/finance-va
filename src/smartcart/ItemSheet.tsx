import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Camera, ImagePlus, Minus, Plus, AlertTriangle, Loader2, RotateCcw, Package } from 'lucide-react';
import { tx } from '../i18n/translations';
import { formatMinor, formatQty, lineMinor, parseMoney, parseQty } from './money';
import type { ExtractionResult, PriceOption, ProductCandidate, UnitBasis } from './extraction';
import type { SmartItem } from './cartService';

/** What the sheet starts from: an empty manual item, an existing item, or a scan result. */
export interface ItemDraftSource {
    item?: SmartItem;                     // editing
    scan?: ExtractionResult;              // fresh scan
    imagePaths?: string[];                // photos already uploaded for this item
    previews?: Record<string, string>;    // path → display URL
}

interface Props {
    cartCurrency: string;
    cartVatLabel: string;
    source: ItemDraftSource;
    busy?: string | null;                 // "Reading the photo…" while a packaging photo is processed
    onSave: (item: Omit<SmartItem, 'id' | 'createdAt'> & { id?: string }) => void;
    onCancel: () => void;
    onRetake?: () => void;
    onAddPackagingPhoto?: (file: File) => Promise<{ path: string; preview: string; scan: ExtractionResult | null } | null>;
    onRemovePhoto?: (path: string) => void;
}

const BASES: { key: UnitBasis; label: string }[] = [
    { key: 'each', label: 'Each' }, { key: 'kg', label: 'per kg' }, { key: 'g', label: 'per g' },
    { key: 'l', label: 'per litre' }, { key: 'ml', label: 'per ml' }, { key: 'm', label: 'per metre' },
];
const minorToInput = (m: number | null | undefined) => (m == null ? '' : formatMinor(m).replace(/,/g, ''));

export default function ItemSheet({ cartCurrency, cartVatLabel, source, busy, onSave, onCancel, onRetake, onAddPackagingPhoto, onRemovePhoto }: Props) {
    const it = source.item;
    const candidates = source.scan?.candidates ?? [];
    const [pick, setPick] = useState<number | null>(candidates.length === 1 ? 0 : null);
    const cand: ProductCandidate | null = pick === null ? null : candidates[pick] ?? null;

    // a single scanned product fills the form straight away (only what was actually read)
    const seed: ProductCandidate | null = !it && candidates.length === 1 ? candidates[0] : null;
    const seedPrice = seed?.packageOptions.length === 1 ? seed.packageOptions[0] : null;
    const [name, setName] = useState(it?.name ?? seed?.name ?? '');
    const [price, setPrice] = useState(it ? minorToInput(it.unitMinor) : minorToInput(seedPrice?.minor));
    const [priceChoice, setPriceChoice] = useState<string>(seedPrice ? 'pkg:0' : seed && !seed.packageOptions.length ? 'own' : ''); // "pkg:i" | "promo:i" | "own"
    const [promoOk, setPromoOk] = useState(false);
    const [qty, setQty] = useState(it ? formatQty(it.qtyMilli) : '1');
    const [basis, setBasis] = useState<UnitBasis>(it?.unitBasis ?? seed?.unitBasis ?? 'each');
    const [currency, setCurrency] = useState(it?.currency ?? seedPrice?.currency ?? cartCurrency);
    const [packSize, setPackSize] = useState(it?.packSize ?? seed?.packSize ?? '');
    const [barcode, setBarcode] = useState(it?.barcode ?? seed?.barcode ?? '');
    const [prod, setProd] = useState(it?.productionDate ?? seed?.productionDate.value ?? '');
    const [exp, setExp] = useState(it?.expiryDate ?? seed?.expiryDate.value ?? '');
    const [notes, setNotes] = useState(it?.notes ?? '');
    const [exempt, setExempt] = useState(it?.vatExempt ?? false);
    const [flags, setFlags] = useState<string[]>(it?.reviewFlags ?? seed?.reviewFlags ?? []);
    const [rawDates, setRawDates] = useState<{ production?: string | null; expiry?: string | null }>(seed ? { production: seed.productionDate.raw, expiry: seed.expiryDate.raw } : {});
    const [comparison, setComparison] = useState<PriceOption[]>(seed?.comparisonPrices ?? []);
    const [paths, setPaths] = useState<string[]>(source.imagePaths ?? it?.imagePaths ?? []);
    const [previews, setPreviews] = useState<Record<string, string>>(source.previews ?? {});
    const [touched, setTouched] = useState(false);
    const packRef = useRef<HTMLInputElement>(null);
    const firstField = useRef<HTMLInputElement>(null);

    // Fill the form from the chosen scanned product (only what was actually read)
    function fillFrom(c: ProductCandidate) {
        setName(c.name ?? '');
        setPackSize(c.packSize ?? '');
        setBarcode(c.barcode ?? '');
        setProd(c.productionDate.value ?? '');
        setExp(c.expiryDate.value ?? '');
        setRawDates({ production: c.productionDate.raw, expiry: c.expiryDate.raw });
        setBasis(c.unitBasis);
        setComparison(c.comparisonPrices);
        setFlags(c.reviewFlags);
        if (c.packageOptions.length === 1) {
            setPriceChoice('pkg:0'); setPrice(minorToInput(c.packageOptions[0].minor));
            setCurrency(c.packageOptions[0].currency ?? cartCurrency);
        } else { setPriceChoice(c.packageOptions.length ? '' : 'own'); setPrice(''); setCurrency(cartCurrency); }
        setPromoOk(false);
    }
    function choose(n: number) { setPick(n); fillFrom(candidates[n]); }
    useEffect(() => { firstField.current?.focus(); }, [pick]);
    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onCancel]);

    function choosePrice(key: string) {
        setPriceChoice(key);
        if (!cand) return;
        const [kind, n] = key.split(':');
        const opt = kind === 'pkg' ? cand.packageOptions[+n] : kind === 'promo' ? cand.promoOptions[+n] : null;
        if (opt) { setPrice(minorToInput(opt.minor)); setCurrency(opt.currency ?? cartCurrency); }
        if (kind !== 'promo') setPromoOk(false);
    }

    const unitMinor = parseMoney(price);
    const qtyMilli = parseQty(qty);
    const line = unitMinor !== null && qtyMilli ? lineMinor(unitMinor, qtyMilli) : null;
    const usingPromo = priceChoice.startsWith('promo:');
    const errors = {
        name: !name.trim() ? tx('Enter the product name.') : null,
        price: price.trim() === '' ? tx('Enter the price.') : unitMinor === null ? tx('Enter a valid price, like 12.50.') : null,
        qty: !qtyMilli ? tx('Quantity must be more than 0.') : null,
        currency: currency !== cartCurrency ? tx('This price is in a different currency than the cart.') : null,
        promo: usingPromo && !promoOk ? tx('Confirm you meet the offer conditions, or choose the regular price.') : null,
        dates: prod && exp && exp < prod ? tx('The expiry date is before the production date.') : null,
        choice: cand && cand.packageOptions.length > 1 && !priceChoice ? tx('Choose which price is this item\'s price.') : null,
    };
    const valid = !Object.values(errors).some(Boolean);
    const review = (f: string) => flags.includes(f);
    const reviewBadge = (f: string) => (review(f) ? <span className="sc-review" role="note">{tx('Please review')}</span> : null);

    function submit() {
        setTouched(true);
        if (!valid || unitMinor === null || !qtyMilli) return;
        onSave({
            id: it?.id, name: name.trim().slice(0, 120), unitMinor, qtyMilli, unitBasis: basis, currency,
            packSize: packSize.trim() || null, barcode: barcode.trim() || null, productionDate: prod || null, expiryDate: exp || null,
            notes: notes.trim() || null, vatExempt: exempt, source: it?.source ?? (source.scan ? 'scan' : 'manual'),
            imagePaths: paths, reviewFlags: [],
        });
    }

    async function packagingPhoto(f: File | undefined) {
        if (!f || !onAddPackagingPhoto) return;
        const r = await onAddPackagingPhoto(f);
        if (!r) return;
        setPaths(p => [...p, r.path]);
        setPreviews(p => ({ ...p, [r.path]: r.preview }));
        const c = r.scan?.candidates[0];
        if (c) { // only fill empty fields; never overwrite what the user typed
            if (!prod && c.productionDate.value) setProd(c.productionDate.value);
            if (!exp && c.expiryDate.value) setExp(c.expiryDate.value);
            if (!packSize && c.packSize) setPackSize(c.packSize);
            if (!barcode && c.barcode) setBarcode(c.barcode);
            setRawDates(d => ({ production: d.production ?? c.productionDate.raw, expiry: d.expiry ?? c.expiryDate.raw }));
            const nf = [...(c.productionDate.ambiguous ? ['production_date'] : []), ...(c.expiryDate.ambiguous ? ['expiry_date'] : [])];
            if (nf.length) setFlags(f0 => [...new Set([...f0, ...nf])]);
        }
    }

    const fieldErr = (k: keyof typeof errors, id: string) => (touched && errors[k] ? <div className="sc-field-error" id={id}>{errors[k]}</div> : null);
    const title = it ? tx('Edit item') : source.scan ? tx('Check the scanned item') : tx('Add an item');
    const multi = useMemo(() => candidates.length > 1, [candidates.length]);

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
            <div className="modal sc-sheet animate-slideUp" role="dialog" aria-modal="true" aria-labelledby="sc-item-title">
                <div className="sheet-grip" aria-hidden />
                <div className="modal-header">
                    <h2 className="modal-title" id="sc-item-title">{title}</h2>
                    <button className="modal-close" onClick={onCancel} aria-label={tx('Close')}><X size={20} /></button>
                </div>

                {source.scan?.message && <div className="sc-note">{source.scan.message}</div>}

                {multi && (
                    <fieldset className="sc-choice">
                        <legend>{tx('Several products were found. Which one are you adding?')}</legend>
                        {candidates.map((c, n) => (
                            <label key={n} className={`sc-choice-row${pick === n ? ' on' : ''}`}>
                                <input type="radio" name="sc-product" checked={pick === n} onChange={() => choose(n)} />
                                <span translate="no">{c.name || tx('Name not available')}</span>
                                <span className="sc-choice-price">{c.packageOptions[0] ? formatMinor(c.packageOptions[0].minor) : tx('Price not available')}</span>
                            </label>
                        ))}
                    </fieldset>
                )}

                {(!multi || cand) && (
                    <form className="sc-form" onSubmit={e => { e.preventDefault(); submit(); }} noValidate>
                        {paths.length > 0 && (
                            <div className="sc-photos">
                                {paths.map(p => (
                                    <div className="sc-photo" key={p}>
                                        {previews[p] ? <img src={previews[p]} alt={tx('Item photo')} /> : <div className="sc-photo-ph"><Package size={20} /></div>}
                                        {onRemovePhoto && <button type="button" className="sc-photo-x" aria-label={tx('Remove photo')} onClick={() => { setPaths(x => x.filter(y => y !== p)); onRemovePhoto(p); }}><X size={12} /></button>}
                                    </div>
                                ))}
                            </div>
                        )}

                        <label className="sc-label" htmlFor="sc-name">{tx('Product name')} {reviewBadge('name')}</label>
                        <input ref={firstField} id="sc-name" className="form-input" value={name} maxLength={120} onChange={e => setName(e.target.value)}
                            aria-invalid={touched && !!errors.name} aria-describedby={errors.name ? 'sc-name-err' : undefined} placeholder={tx('e.g. Milk 1 L')} />
                        {fieldErr('name', 'sc-name-err')}

                        {cand && (cand.packageOptions.length > 1 || cand.promoOptions.length > 0) && (
                            <fieldset className="sc-choice">
                                <legend>{tx('Which price applies?')} {reviewBadge('price_choice')}</legend>
                                {cand.packageOptions.map((o, n) => (
                                    <label key={`p${n}`} className={`sc-choice-row${priceChoice === `pkg:${n}` ? ' on' : ''}`}>
                                        <input type="radio" name="sc-price" checked={priceChoice === `pkg:${n}`} onChange={() => choosePrice(`pkg:${n}`)} />
                                        <span>{o.kind === 'unknown' ? tx('Price (type not clear)') : tx('Regular price')}</span>
                                        <span className="sc-choice-price">{formatMinor(o.minor)}{o.currency ? ` ${o.currency}` : ''}</span>
                                    </label>
                                ))}
                                {cand.promoOptions.map((o, n) => (
                                    <label key={`o${n}`} className={`sc-choice-row${priceChoice === `promo:${n}` ? ' on' : ''}`}>
                                        <input type="radio" name="sc-price" checked={priceChoice === `promo:${n}`} onChange={() => choosePrice(`promo:${n}`)} />
                                        <span>{tx('Offer price')}{o.conditions ? <> · <span translate="no">{o.conditions}</span></> : ''}</span>
                                        <span className="sc-choice-price">{formatMinor(o.minor)}</span>
                                    </label>
                                ))}
                                <label className={`sc-choice-row${priceChoice === 'own' ? ' on' : ''}`}>
                                    <input type="radio" name="sc-price" checked={priceChoice === 'own'} onChange={() => { setPriceChoice('own'); setPromoOk(false); }} />
                                    <span>{tx('Type the price myself')}</span>
                                </label>
                                {usingPromo && (
                                    <label className="sc-check">
                                        <input type="checkbox" checked={promoOk} onChange={e => setPromoOk(e.target.checked)} />
                                        <span>{tx('I meet the offer conditions')}</span>
                                    </label>
                                )}
                                {fieldErr('promo', 'sc-promo-err')}
                                {fieldErr('choice', 'sc-choice-err')}
                            </fieldset>
                        )}
                        {comparison.length > 0 && (
                            <div className="sc-hint">{tx('Comparison price on the tag')}: {comparison.map(c => `${formatMinor(c.minor)}${c.perUnit ? ` ${c.perUnit}` : ''}`).join(' · ')}. {tx('Not used as the item price.')}</div>
                        )}

                        <div className="sc-row">
                            <div className="sc-col">
                                <label className="sc-label" htmlFor="sc-price">{tx('Unit price')} ({cartCurrency}) {reviewBadge('price')}</label>
                                <input id="sc-price" className="form-input sc-num" inputMode="decimal" autoComplete="off" value={price}
                                    onChange={e => { setPrice(e.target.value); if (priceChoice && priceChoice !== 'own') setPriceChoice('own'); }}
                                    aria-invalid={touched && !!errors.price} aria-describedby={errors.price ? 'sc-price-err' : undefined} placeholder="0.00" />
                                {fieldErr('price', 'sc-price-err')}
                            </div>
                            <div className="sc-col">
                                <label className="sc-label" htmlFor="sc-basis">{tx('Sold')}</label>
                                <select id="sc-basis" className="form-input form-select" value={basis} onChange={e => setBasis(e.target.value as UnitBasis)}>
                                    {BASES.map(b => <option key={b.key} value={b.key}>{tx(b.label)}</option>)}
                                </select>
                            </div>
                        </div>

                        {currency !== cartCurrency && (
                            <div className="sc-warn" role="alert">
                                <AlertTriangle size={16} />
                                <div>
                                    <div>{tx('The tag shows')} <b>{currency}</b>, {tx('but this cart is in')} <b>{cartCurrency}</b>. {tx('Zaylo won\'t convert it for you.')}</div>
                                    <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setCurrency(cartCurrency)}>
                                        {tx('The price is in')} {cartCurrency}
                                    </button>
                                </div>
                            </div>
                        )}

                        <label className="sc-label" htmlFor="sc-qty">{basis === 'each' ? tx('Quantity') : `${tx('Amount')} (${BASES.find(b => b.key === basis)?.label.replace('per ', '')})`}</label>
                        <div className="sc-stepper">
                            <button type="button" className="sc-step" aria-label={tx('Less')} onClick={() => { const q = parseQty(qty) ?? 1000; const step = basis === 'each' ? 1000 : 100; setQty(formatQty(Math.max(step, q - step))); }}><Minus size={18} /></button>
                            <input id="sc-qty" className="form-input sc-num" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)}
                                aria-invalid={touched && !!errors.qty} aria-describedby={errors.qty ? 'sc-qty-err' : undefined} />
                            <button type="button" className="sc-step" aria-label={tx('More')} onClick={() => { const q = parseQty(qty) ?? 0; setQty(formatQty(q + (basis === 'each' ? 1000 : 100))); }}><Plus size={18} /></button>
                        </div>
                        {fieldErr('qty', 'sc-qty-err')}

                        <div className="sc-line" aria-live="polite">
                            <span>{tx('Line total')}</span>
                            <b>{line === null ? '—' : `${formatMinor(line)} ${cartCurrency}`}</b>
                        </div>

                        <label className="sc-check sc-vat">
                            <input type="checkbox" checked={exempt} onChange={e => setExempt(e.target.checked)} />
                            <span>{tx('No VAT / Exempt')}<small>{exempt ? tx('This item is left out of VAT.') : `${tx('Uses the cart setting')}: ${cartVatLabel}`}</small></span>
                        </label>

                        <details className="sc-more" open={Boolean(prod || exp || packSize || barcode || notes || review('expiry_date') || review('production_date'))}>
                            <summary>{tx('Dates, pack size and notes')}</summary>
                            <div className="sc-row">
                                <div className="sc-col">
                                    <label className="sc-label" htmlFor="sc-prod">{tx('Production date')} {reviewBadge('production_date')}</label>
                                    <input id="sc-prod" type="date" className="form-input" value={prod} onChange={e => setProd(e.target.value)} />
                                    {rawDates.production && !prod && <div className="sc-hint">{tx('Printed as')} “<span translate="no">{rawDates.production}</span>”. {tx('Pick the date if you can tell.')}</div>}
                                </div>
                                <div className="sc-col">
                                    <label className="sc-label" htmlFor="sc-exp">{tx('Expiry / best before')} {reviewBadge('expiry_date')}</label>
                                    <input id="sc-exp" type="date" className="form-input" value={exp} onChange={e => setExp(e.target.value)} aria-describedby={errors.dates ? 'sc-date-err' : undefined} />
                                    {rawDates.expiry && !exp && <div className="sc-hint">{tx('Printed as')} “<span translate="no">{rawDates.expiry}</span>”. {tx('Pick the date if you can tell.')}</div>}
                                </div>
                            </div>
                            {fieldErr('dates', 'sc-date-err')}
                            <div className="sc-row">
                                <div className="sc-col">
                                    <label className="sc-label" htmlFor="sc-pack">{tx('Pack size')} {reviewBadge('pack_size')}</label>
                                    <input id="sc-pack" className="form-input" value={packSize} maxLength={40} onChange={e => setPackSize(e.target.value)} placeholder={tx('Not available')} />
                                </div>
                                <div className="sc-col">
                                    <label className="sc-label" htmlFor="sc-barcode">{tx('Barcode')} {reviewBadge('barcode')}</label>
                                    <input id="sc-barcode" className="form-input" value={barcode} maxLength={40} inputMode="numeric" onChange={e => setBarcode(e.target.value)} placeholder={tx('Not available')} />
                                </div>
                            </div>
                            <label className="sc-label" htmlFor="sc-notes">{tx('Notes')}</label>
                            <textarea id="sc-notes" className="form-input" rows={2} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} />
                        </details>

                        <div className="sc-photo-actions">
                            {onAddPackagingPhoto && (
                                <>
                                    <input ref={packRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { packagingPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => packRef.current?.click()} disabled={!!busy}>
                                        {busy ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}{busy || tx('Add packaging photo for dates')}
                                    </button>
                                </>
                            )}
                            {onRetake && <button type="button" className="btn btn-ghost btn-sm" onClick={onRetake}><RotateCcw size={15} />{tx('Retake photo')}</button>}
                        </div>

                        {touched && !valid && <div className="sc-field-error" role="alert">{tx('Check the highlighted fields.')}</div>}
                        <div className="sc-sheet-actions">
                            <button type="button" className="btn btn-secondary" onClick={onCancel}>{tx('Cancel')}</button>
                            <button type="submit" className="btn btn-primary">{it ? tx('Save item') : tx('Add to cart')}</button>
                        </div>
                    </form>
                )}
                {multi && !cand && (
                    <div className="sc-sheet-actions">
                        <button type="button" className="btn btn-secondary" onClick={onCancel}>{tx('Cancel')}</button>
                        {onRetake && <button type="button" className="btn btn-ghost" onClick={onRetake}><Camera size={16} />{tx('Retake photo')}</button>}
                    </div>
                )}
            </div>
        </div>
    );
}
