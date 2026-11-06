import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ShoppingCart, Camera, ImageUp, PenLine, Trash2, Edit2, Calculator, CheckCircle2, ArrowLeft, Loader2, Info, CloudOff, Receipt, Plus, Minus, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useStore } from '../store/useStore';
import { tx } from '../i18n/translations';
import { convertAmountSync } from '../services/exchangeRates';
import { formatMinor, formatQty, lineMinor, parseMoney, type VatMode, DEFAULT_VAT_BP } from '../smartcart/money';
import {
    type SmartCart, type SmartItem, cartTotals, calculateOnServer, confirmOnServer, currencyProblems, deleteImages, discardOnServer,
    extractFromImage, ExtractionError, fetchOpenCart, findDuplicate, loadLocalCart, newCart, prepareImage, pushCart, saveLocalCart,
    signedUrls, uploadImage, uuid,
} from '../smartcart/cartService';
import ItemSheet, { type ItemDraftSource } from '../smartcart/ItemSheet';
import type { ExtractionResult } from '../smartcart/extraction';

type View = 'home' | 'cart' | 'summary' | 'success';
const VAT_MODES: { key: VatMode; title: string; help: string }[] = [
    { key: 'none', title: 'Before VAT / No VAT added', help: 'Shows the prices as entered. The total excludes any additional VAT.' },
    { key: 'add', title: 'Add VAT', help: 'Use when shelf prices don\'t include VAT. VAT is added to the taxable items.' },
    { key: 'included', title: 'Prices already include VAT', help: 'Nothing is added. Zaylo shows how much of the price is VAT.' },
];
const ratePct = (bp: number) => (bp / 100).toString();
const vatLabel = (c: Pick<SmartCart, 'vatMode' | 'vatRateBp'>) => c.vatMode === 'none' ? tx('No VAT added') : c.vatMode === 'add' ? `${tx('Add')} ${ratePct(c.vatRateBp)}% ${tx('VAT')}` : `${tx('Includes')} ${ratePct(c.vatRateBp)}% ${tx('VAT')}`;

export default function SmartCartPage() {
    const navigate = useNavigate();
    const user = useStore(s => s.user);
    const activeWorkspaceId = useStore(s => s.activeWorkspaceId);
    const workspaces = useStore(s => s.workspaces);
    const categories = useStore(s => s.categories);
    const paymentMethods = useStore(s => s.paymentMethods);
    const loadWorkspaceData = useStore(s => s.loadWorkspaceData);
    const ws = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];
    const uid = user?.id || 'local';
    const isViewer = ws?.members?.find(m => m.uid === user?.id)?.role === 'viewer';

    const [cart, setCartState] = useState<SmartCart | null>(() => loadLocalCart(uid));
    const [view, setView] = useState<View>('home');
    const [syncState, setSyncState] = useState<'saved' | 'saving' | 'offline'>('saved');
    const [sheet, setSheet] = useState<ItemDraftSource | null>(null);
    const [scanning, setScanning] = useState<string | null>(null);
    const [scanError, setScanError] = useState<{ message: string; kind: string } | null>(null);
    const [packBusy, setPackBusy] = useState<string | null>(null);
    const [dup, setDup] = useState<{ item: SmartItem; existing: SmartItem } | null>(null);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const [previews, setPreviews] = useState<Record<string, string>>({});
    const [cameraBlocked, setCameraBlocked] = useState(false);
    const [success, setSuccess] = useState<{ expenseId: string; amount: number; currency: string } | null>(null);
    const [startName, setStartName] = useState('');
    const [startStore, setStartStore] = useState('');
    const cameraRef = useRef<HTMLInputElement>(null);
    const uploadRef = useRef<HTMLInputElement>(null);
    const pushTimer = useRef<number | undefined>(undefined);
    const removedTimers = useRef<Map<string, number>>(new Map());

    // ---------------------------------------------------------------- persistence
    const setCart = useCallback((updater: SmartCart | null | ((c: SmartCart) => SmartCart)) => {
        setCartState(prev => {
            const next = typeof updater === 'function' ? (prev ? updater(prev) : prev) : updater;
            saveLocalCart(uid, next && (next.status === 'draft' || next.status === 'calculated') ? next : null);
            return next;
        });
    }, [uid]);

    const flush = useCallback(async () => {
        const c = cartRef.current;
        if (!c || (!c.pending.cart && !c.pending.items.length && !c.pending.deleted.length && c.remote)) { setSyncState('saved'); return; }
        setSyncState('saving');
        try {
            const saved = await pushCart(c);
            // keep anything changed while saving
            setCart(cur => (cur.id !== saved.id ? cur : {
                ...cur, remote: true,
                pending: {
                    cart: cur.pending.cart && cur.updatedAt !== c.updatedAt,
                    items: cur.pending.items.filter(id => !c.pending.items.includes(id) || cur.updatedAt !== c.updatedAt),
                    deleted: cur.pending.deleted.filter(id => !c.pending.deleted.includes(id)),
                },
            }));
            setSyncState('saved');
        } catch (e) {
            console.warn('[smart-cart] save failed', (e as Error).message);
            setSyncState('offline');
        }
    }, [setCart]);
    const cartRef = useRef(cart);
    useEffect(() => { cartRef.current = cart; }, [cart]);
    const schedulePush = useCallback(() => { window.clearTimeout(pushTimer.current); pushTimer.current = window.setTimeout(flush, 700); }, [flush]);
    useEffect(() => {
        const online = () => flush();
        window.addEventListener('online', online);
        const iv = window.setInterval(() => { if (cartRef.current && syncStateRef.current === 'offline') flush(); }, 20_000);
        return () => { window.removeEventListener('online', online); window.clearInterval(iv); window.clearTimeout(pushTimer.current); };
    }, [flush]);
    const syncStateRef = useRef(syncState);
    useEffect(() => { syncStateRef.current = syncState; }, [syncState]);

    // On open: local draft, else an unfinished cart from another device
    useEffect(() => {
        if (cart) { if (cart.pending.cart || cart.pending.items.length || cart.pending.deleted.length) schedulePush(); return; }
        fetchOpenCart().then(c => { if (c && !cartRef.current) setCart(c); }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Thumbnails for saved photos
    useEffect(() => {
        const missing = (cart?.items || []).flatMap(i => i.imagePaths).filter(p => !previews[p]);
        if (missing.length) signedUrls(missing).then(m => setPreviews(p => ({ ...m, ...p }))).catch(() => {});
    }, [cart?.items, previews]);

    function mutate(fn: (c: SmartCart) => SmartCart, touched: { cart?: boolean; items?: string[]; deleted?: string[] }) {
        setCart(c => {
            const n = fn(c);
            return {
                ...n,
                status: n.status === 'calculated' ? 'draft' : n.status,
                calculatedTotalMinor: null,
                updatedAt: new Date().toISOString(),
                pending: {
                    cart: n.pending.cart || !!touched.cart,
                    items: [...new Set([...n.pending.items, ...(touched.items || [])])],
                    deleted: [...new Set([...n.pending.deleted, ...(touched.deleted || [])])],
                },
            };
        });
        schedulePush();
    }

    const totals = useMemo(() => (cart ? cartTotals(cart) : null), [cart]);
    const mismatched = cart ? currencyProblems(cart) : [];
    const canCalculate = !!cart && cart.items.length > 0 && mismatched.length === 0;

    // ---------------------------------------------------------------- actions
    function start() {
        if (!ws) { toast.error(tx('Create a workspace first.')); return; }
        const c = newCart(ws.id, user?.defaultCurrency || ws.currency || 'EGP', startName.trim(), startStore.trim());
        setCart(c); setStartName(''); setStartStore(''); setView('cart'); schedulePush();
    }

    async function openCamera() {
        try {
            const st = await navigator.permissions?.query({ name: 'camera' as PermissionName });
            if (st?.state === 'denied') { setCameraBlocked(true); return; }
        } catch { /* not supported: the system picker handles it */ }
        cameraRef.current?.click();
    }

    async function handlePhoto(file: File | undefined) {
        if (!file || !cart) return;
        setScanError(null);
        setScanning(tx('Reading the price tag…'));
        let prepared: Awaited<ReturnType<typeof prepareImage>>;
        try { prepared = await prepareImage(file); }
        catch (e) { setScanning(null); setScanError({ message: (e as Error).message, kind: 'image' }); return; }
        const upload = uploadImage(cart.id, prepared.blob).then(path => { setPreviews(p => ({ ...p, [path]: prepared.previewUrl })); return path; }).catch(() => null);
        try {
            const result = await extractFromImage(prepared.base64, cart.currency, 'tag');
            const path = await upload;
            setScanning(null);
            if (result.status === 'unreadable') {
                if (path) deleteImages([path]);
                setScanError({ message: result.message || tx('No price could be read from this photo.'), kind: 'unreadable' });
                return;
            }
            setSheet({ scan: result, imagePaths: path ? [path] : [], previews: path ? { [path]: prepared.previewUrl } : {} });
        } catch (e) {
            setScanning(null);
            const path = await upload; if (path) deleteImages([path]);
            setScanError({ message: (e as Error).message, kind: e instanceof ExtractionError ? e.kind : 'service' });
        }
    }

    async function packagingPhoto(file: File): Promise<{ path: string; preview: string; scan: ExtractionResult | null } | null> {
        if (!cart) return null;
        setPackBusy(tx('Reading the packaging…'));
        try {
            const prepared = await prepareImage(file);
            const [path, scan] = await Promise.all([
                uploadImage(cart.id, prepared.blob),
                extractFromImage(prepared.base64, cart.currency, 'packaging').catch(e => { toast.error((e as Error).message); return null; }),
            ]);
            if (scan && scan.status === 'unreadable') toast(tx('No dates could be read. You can type them in.'));
            return { path, preview: prepared.previewUrl, scan };
        } catch (e) { toast.error((e as Error).message); return null; }
        finally { setPackBusy(null); }
    }

    function saveItem(data: Omit<SmartItem, 'id' | 'createdAt'> & { id?: string }) {
        if (!cart) return;
        if (data.id) {
            const id = data.id;
            const before = cart.items.find(i => i.id === id);
            const dropped = (before?.imagePaths || []).filter(p => !data.imagePaths.includes(p));
            if (dropped.length) deleteImages(dropped);
            mutate(c => ({ ...c, items: c.items.map(i => (i.id === id ? { ...i, ...data, id } : i)) }), { items: [id] });
            setSheet(null);
            return;
        }
        const item: SmartItem = { ...data, id: uuid(), createdAt: new Date().toISOString() };
        const existing = findDuplicate(cart, item);
        setSheet(null);
        if (existing) { setDup({ item, existing }); return; }
        addItem(item);
    }
    function addItem(item: SmartItem) {
        mutate(c => ({ ...c, items: [...c.items, item] }), { items: [item.id] });
        toast.success(tx('Added to cart'), { id: 'sc-added' });
    }
    function changeQty(item: SmartItem, dir: 1 | -1) {
        const step = item.unitBasis === 'each' ? 1000 : 100;
        const q = item.qtyMilli + dir * step;
        if (q <= 0) return;
        mutate(c => ({ ...c, items: c.items.map(i => (i.id === item.id ? { ...i, qtyMilli: q } : i)) }), { items: [item.id] });
    }
    function removeItem(item: SmartItem) {
        const index = cart?.items.findIndex(i => i.id === item.id) ?? -1;
        mutate(c => ({ ...c, items: c.items.filter(i => i.id !== item.id) }), { deleted: [item.id] });
        // photos are deleted only once the undo window has passed
        const timer = window.setTimeout(() => { deleteImages(item.imagePaths); removedTimers.current.delete(item.id); }, 6500);
        removedTimers.current.set(item.id, timer);
        toast(tt => (
            <span className="sc-undo-toast">
                {tx('Removed')} <b translate="no">{item.name}</b>
                <button className="btn btn-ghost btn-sm" onClick={() => {
                    window.clearTimeout(removedTimers.current.get(item.id)); removedTimers.current.delete(item.id);
                    mutate(c => { const items = [...c.items]; items.splice(Math.max(0, Math.min(index, items.length)), 0, item); return { ...c, items, pending: { ...c.pending, deleted: c.pending.deleted.filter(d => d !== item.id) } }; }, { items: [item.id] });
                    toast.dismiss(tt.id);
                }}>{tx('Undo')}</button>
            </span>
        ), { duration: 6000, id: `rm-${item.id}` });
    }

    async function goToSummary() {
        if (!cart || !canCalculate) return;
        setView('summary');
        await flush();
        try {
            const server = await calculateOnServer(cart.id);
            setCart(c => ({ ...c, status: 'calculated', calculatedTotalMinor: server.total }));
            if (totals && server.total !== totals.total) console.warn('[smart-cart] server total differs from the app; showing the server total');
        } catch (e) {
            const err = e as Error & { code?: string };
            if (err.code !== 'offline') toast.error(err.message);
        }
    }

    async function discard() {
        if (!cart) return;
        const c = cart;
        setConfirmDiscard(false);
        try {
            let paths = c.items.flatMap(i => i.imagePaths);
            if (c.remote) paths = [...new Set([...paths, ...(await discardOnServer(c.id))])];
            deleteImages(paths);
            setCart(null); setView('home');
            toast.success(tx('Cart discarded. No expense was created.'));
        } catch (e) {
            toast.error(`${tx('Couldn\'t discard the cart.')} ${(e as Error).message}`);
        }
    }

    // ---------------------------------------------------------------- render helpers
    const cur = cart?.currency || '';
    const money = (m: number) => <span className="sc-money"><span translate="no">{formatMinor(m)}</span> <small>{cur}</small></span>;
    const syncBadge = syncState === 'offline'
        ? <span className="sc-sync off"><CloudOff size={13} />{tx('Saved on this device')}</span>
        : <span className="sc-sync">{syncState === 'saving' ? tx('Saving…') : tx('Draft saved')}</span>;

    if (isViewer) {
        return (
            <div className="page animate-fadeIn sc-page">
                <div className="sc-empty card"><ShieldAlert size={28} /><p>{tx('Viewers can\'t add purchases to this workspace. Switch to a workspace where you can add expenses.')}</p></div>
            </div>
        );
    }

    // ---------------------------------------------------------------- success (checked first: the cart is gone by now)
    if (view === 'success' && success) {
        return (
            <div className="page animate-fadeIn sc-page">
                <div className="card sc-success" role="status">
                    <CheckCircle2 size={44} />
                    <h1 className="sc-h1">{tx('Purchase saved')}</h1>
                    <p>{tx('Recorded as one expense')}: <b translate="no">{formatMinor(success.amount)} {success.currency}</b></p>
                    <div className="sc-actions">
                        <button className="btn btn-primary" onClick={() => navigate(`/expenses?view=${success.expenseId}`)}><Receipt size={18} />{tx('View expense')}</button>
                        <button className="btn btn-secondary" onClick={() => { setSuccess(null); setView('home'); }}><ShoppingCart size={18} />{tx('Start new cart')}</button>
                    </div>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------------- home
    if (view === 'home' || !cart) {
        const resumable = cart && (cart.status === 'draft' || cart.status === 'calculated');
        return (
            <div className="page animate-fadeIn sc-page">
                <div className="page-header">
                    <div>
                        <h1 className="page-title">{tx('Smart Cart')}</h1>
                        <p className="page-subtitle">{tx('Know your total before checkout.')}</p>
                    </div>
                </div>
                {resumable && (
                    <div className="card sc-resume">
                        <div>
                            <div className="sc-resume-title">{tx('Unfinished cart')}{cart!.storeName ? <> · <span translate="no">{cart!.storeName}</span></> : null}</div>
                            <div className="sc-muted">{cart!.items.length} {tx('items')} · {tx('Started')} {new Date(cart!.createdAt).toLocaleString()}</div>
                        </div>
                        <button className="btn btn-primary" onClick={() => setView('cart')}>{tx('Resume draft')}</button>
                    </div>
                )}
                <div className="card sc-start">
                    <h2 className="sc-h2">{tx('Start shopping')}</h2>
                    <div className="sc-row">
                        <div className="sc-col">
                            <label className="sc-label" htmlFor="sc-start-store">{tx('Store')} <span className="sc-muted">({tx('optional')})</span></label>
                            <input id="sc-start-store" className="form-input" maxLength={80} value={startStore} onChange={e => setStartStore(e.target.value)} placeholder={tx('e.g. Carrefour')} />
                        </div>
                        <div className="sc-col">
                            <label className="sc-label" htmlFor="sc-start-name">{tx('Cart name')} <span className="sc-muted">({tx('optional')})</span></label>
                            <input id="sc-start-name" className="form-input" maxLength={80} value={startName} onChange={e => setStartName(e.target.value)} placeholder={tx('e.g. Weekly groceries')} />
                        </div>
                    </div>
                    <p className="sc-muted">{tx('Prices are in')} {user?.defaultCurrency || ws?.currency}. {tx('Nothing is recorded as spending until you confirm the purchase.')}</p>
                    <button className="btn btn-primary sc-big" onClick={() => { if (resumable && !window.confirm(tx('Start a new cart? Your unfinished cart stays saved until you discard it.'))) return; start(); }}>
                        <ShoppingCart size={20} />{tx('Start shopping')}
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------------- summary
    if (view === 'summary') {
        return (
            <SummaryView
                cart={cart} totals={totals!} categories={categories} paymentMethods={paymentMethods} wsCurrency={ws?.currency || cart.currency}
                onBack={() => setView('cart')} onDiscard={() => setConfirmDiscard(true)} confirmDiscard={confirmDiscard} onDiscardConfirmed={discard} onDiscardCancel={() => setConfirmDiscard(false)}
                onFlush={flush}
                onConfirmed={async (r, amount) => {
                    setCart(c => ({ ...c, status: 'confirmed', expenseId: r.expenseId }));
                    saveLocalCart(uid, null);
                    setCart(null);
                    setSuccess({ expenseId: r.expenseId, amount, currency: cart.currency });
                    setView('success');
                    if (activeWorkspaceId) loadWorkspaceData(activeWorkspaceId).catch(() => {});
                }}
                onStale={async () => { await goToSummary(); }}
            />
        );
    }

    // ---------------------------------------------------------------- cart
    const t = totals!;
    return (
        <div className="page animate-fadeIn sc-page">
            <div className="sc-top">
                <button className="icon-btn" onClick={() => setView('home')} aria-label={tx('Back')}><ArrowLeft size={18} className="sc-flip" /></button>
                <div className="sc-top-fields">
                    <input className="sc-title-input" aria-label={tx('Store')} placeholder={tx('Store (optional)')} maxLength={80} value={cart.storeName}
                        onChange={e => { const v = e.target.value; mutate(c => ({ ...c, storeName: v }), { cart: true }); }} />
                    <input className="sc-sub-input" aria-label={tx('Cart name')} placeholder={tx('Cart name (optional)')} maxLength={80} value={cart.name}
                        onChange={e => { const v = e.target.value; mutate(c => ({ ...c, name: v }), { cart: true }); }} />
                </div>
                {syncBadge}
            </div>

            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { handlePhoto(e.target.files?.[0]); e.target.value = ''; }} />
            <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={e => { handlePhoto(e.target.files?.[0]); e.target.value = ''; }} />

            <div className="sc-capture">
                <button className="sc-capture-btn primary" onClick={openCamera} disabled={!!scanning}><Camera size={26} /><span>{tx('Take photo')}</span></button>
                <button className="sc-capture-btn" onClick={() => uploadRef.current?.click()} disabled={!!scanning}><ImageUp size={24} /><span>{tx('Upload image')}</span></button>
                <button className="sc-capture-btn" onClick={() => setSheet({})} disabled={!!scanning}><PenLine size={24} /><span>{tx('Add manually')}</span></button>
            </div>
            {!navigator.onLine && <div className="sc-note"><CloudOff size={15} /> {tx('You\'re offline. Reading photos needs a connection; you can still add items by hand. Your cart is saved on this device.')}</div>}

            {scanning && <div className="sc-scanning" role="status" aria-live="polite"><Loader2 size={18} className="animate-spin" />{scanning}</div>}
            {cameraBlocked && (
                <div className="sc-warn" role="alert">
                    <AlertTriangle size={16} />
                    <div>
                        {tx('Camera access is turned off for Zaylo. You can upload a photo you took with the camera app, or add the item by hand. To use the camera here, allow camera access in your browser or phone settings.')}
                        <div className="sc-actions-inline">
                            <button className="btn btn-secondary btn-sm" onClick={() => { setCameraBlocked(false); uploadRef.current?.click(); }}>{tx('Upload image')}</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => { setCameraBlocked(false); setSheet({}); }}>{tx('Add manually')}</button>
                        </div>
                    </div>
                </div>
            )}
            {scanError && (
                <div className="sc-warn" role="alert">
                    <AlertTriangle size={16} />
                    <div>
                        {scanError.message}
                        <div className="sc-actions-inline">
                            {scanError.kind !== 'offline' && scanError.kind !== 'limit' && <button className="btn btn-secondary btn-sm" onClick={() => { setScanError(null); openCamera(); }}>{tx('Try another photo')}</button>}
                            <button className="btn btn-secondary btn-sm" onClick={() => { setScanError(null); setSheet({}); }}>{tx('Add manually')}</button>
                        </div>
                    </div>
                </div>
            )}

            <section className="card sc-vat" aria-labelledby="sc-vat-title">
                <div className="sc-vat-head">
                    <h2 className="sc-h3" id="sc-vat-title">{tx('VAT')}</h2>
                    {cart.vatMode !== 'none' && (
                        <label className="sc-rate">
                            <span>{tx('Rate')}</span>
                            <input className="form-input sc-num" inputMode="decimal" aria-label={tx('VAT rate in percent')} value={ratePct(cart.vatRateBp)}
                                onChange={e => { const v = Math.round(parseFloat(e.target.value.replace(',', '.')) * 100); if (Number.isFinite(v) && v >= 0 && v <= 10000) mutate(c => ({ ...c, vatRateBp: v }), { cart: true }); }} />
                            <span>%</span>
                        </label>
                    )}
                </div>
                <div className="sc-modes" role="radiogroup" aria-label={tx('How are prices shown in this store?')}>
                    {VAT_MODES.map(m => (
                        <button key={m.key} type="button" role="radio" aria-checked={cart.vatMode === m.key} className={cart.vatMode === m.key ? 'on' : ''}
                            onClick={() => mutate(c => ({ ...c, vatMode: m.key }), { cart: true })}>
                            {m.key === 'add' ? `${tx('Add')} ${ratePct(cart.vatRateBp || DEFAULT_VAT_BP)}% ${tx('VAT')}` : tx(m.title)}
                        </button>
                    ))}
                </div>
                <p className="sc-muted"><Info size={13} /> {tx(VAT_MODES.find(m => m.key === cart.vatMode)!.help)} {tx('The rate is an estimate setting; it may not apply to every product. Mark items as No VAT / Exempt where needed.')}</p>
            </section>

            {cart.items.length === 0 ? (
                <div className="sc-empty">
                    <ShoppingCart size={34} />
                    <p>{tx('Know your total before checkout. Scan a price tag to start your Smart Cart.')}</p>
                </div>
            ) : (
                <ul className="sc-items" aria-label={tx('Items in the cart')}>
                    {cart.items.map(i => (
                        <li key={i.id} className={`sc-item card${i.currency !== cart.currency ? ' bad' : ''}`}>
                            {i.imagePaths[0] && previews[i.imagePaths[0]] ? <img className="sc-thumb" src={previews[i.imagePaths[0]]} alt="" /> : <div className="sc-thumb sc-thumb-ph" aria-hidden><Receipt size={18} /></div>}
                            <div className="sc-item-body">
                                <div className="sc-item-name" translate="no">{i.name}</div>
                                <div className="sc-muted">
                                    {formatMinor(i.unitMinor)} {i.currency}{i.unitBasis !== 'each' ? ` / ${i.unitBasis}` : ''}
                                    {i.vatExempt && <> · {tx('No VAT')}</>}
                                    {i.expiryDate && <> · {tx('Exp.')} {i.expiryDate}</>}
                                </div>
                                {i.currency !== cart.currency && <div className="sc-field-error">{tx('Different currency: edit this item to fix it.')}</div>}
                                <div className="sc-item-qty">
                                    <button className="sc-step sm" aria-label={`${tx('Less')} ${i.name}`} onClick={() => changeQty(i, -1)} disabled={i.qtyMilli <= (i.unitBasis === 'each' ? 1000 : 100)}><Minus size={15} /></button>
                                    <span aria-label={tx('Quantity')}>{formatQty(i.qtyMilli)}{i.unitBasis !== 'each' ? ` ${i.unitBasis}` : ''}</span>
                                    <button className="sc-step sm" aria-label={`${tx('More')} ${i.name}`} onClick={() => changeQty(i, 1)}><Plus size={15} /></button>
                                </div>
                            </div>
                            <div className="sc-item-side">
                                <div className="sc-item-total">{money(lineMinor(i.unitMinor, i.qtyMilli))}</div>
                                <div className="sc-item-actions">
                                    <button className="icon-btn" aria-label={`${tx('Edit')} ${i.name}`} onClick={() => setSheet({ item: i, imagePaths: i.imagePaths, previews })}><Edit2 size={16} /></button>
                                    <button className="icon-btn" style={{ color: 'var(--cinnabar)' }} aria-label={`${tx('Remove')} ${i.name}`} onClick={() => removeItem(i)}><Trash2 size={16} /></button>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <div className="sc-discard-row">
                <button className="btn btn-ghost sc-danger" onClick={() => setConfirmDiscard(true)}><Trash2 size={16} />{tx('Discard cart')}</button>
            </div>

            <div className="sc-bar" aria-live="polite">
                <div className="sc-bar-info">
                    <div className="sc-bar-total">{money(t.total)}</div>
                    <div className="sc-muted">{tx('Estimate')} · {t.itemCount} {tx('items')} · {tx('qty')} {formatQty(t.totalQtyMilli)} · {vatLabel(cart)}</div>
                </div>
                <button className="btn btn-primary" onClick={goToSummary} disabled={!canCalculate} aria-describedby={!canCalculate ? 'sc-calc-why' : undefined}>
                    <Calculator size={18} />{tx('Calculate total')}
                </button>
                {!canCalculate && <span id="sc-calc-why" className="sr-only">{cart.items.length === 0 ? tx('Add at least one item first.') : tx('Fix the items with a different currency first.')}</span>}
            </div>

            {sheet && (
                <ItemSheet cartCurrency={cart.currency} cartVatLabel={vatLabel(cart)} source={{ ...sheet, previews: { ...previews, ...(sheet.previews || {}) } }} busy={packBusy}
                    onSave={saveItem}
                    onCancel={() => {
                        // a fresh scan that wasn't added: its photos aren't needed
                        if (!sheet.item && sheet.imagePaths?.length) deleteImages(sheet.imagePaths);
                        setSheet(null);
                    }}
                    onRetake={sheet.item ? undefined : () => { if (sheet.imagePaths?.length) deleteImages(sheet.imagePaths); setSheet(null); openCamera(); }}
                    onAddPackagingPhoto={packagingPhoto}
                    onRemovePhoto={p => { if (!sheet.item) deleteImages([p]); }}
                />
            )}

            {dup && (
                <Dialog title={tx('Already in your cart?')} onClose={() => setDup(null)}>
                    <p><b translate="no">{dup.existing.name}</b> {tx('at')} {formatMinor(dup.existing.unitMinor)} {cart.currency} {tx('is already in the cart. Did you scan it twice?')}</p>
                    <div className="sc-dialog-actions">
                        <button className="btn btn-primary" onClick={() => { const e = dup.existing; mutate(c => ({ ...c, items: c.items.map(i => (i.id === e.id ? { ...i, qtyMilli: i.qtyMilli + dup.item.qtyMilli } : i)) }), { items: [e.id] }); if (dup.item.imagePaths.length) deleteImages(dup.item.imagePaths); setDup(null); toast.success(tx('Quantity increased')); }}>
                            {tx('Increase quantity')}
                        </button>
                        <button className="btn btn-secondary" onClick={() => { addItem(dup.item); setDup(null); }}>{tx('Keep as separate item')}</button>
                        <button className="btn btn-ghost" onClick={() => { if (dup.item.imagePaths.length) deleteImages(dup.item.imagePaths); setDup(null); }}>{tx('Cancel')}</button>
                    </div>
                </Dialog>
            )}
            {confirmDiscard && <DiscardDialog onCancel={() => setConfirmDiscard(false)} onConfirm={discard} />}
        </div>
    );
}

// =================================================================== summary + confirm

function SummaryView({ cart, totals, categories, paymentMethods, wsCurrency, onBack, onDiscard, confirmDiscard, onDiscardConfirmed, onDiscardCancel, onConfirmed, onStale, onFlush }: {
    cart: SmartCart; totals: ReturnType<typeof cartTotals>; categories: { key: string; label: string; emoji: string }[]; paymentMethods: { key: string; label: string; emoji: string }[]; wsCurrency: string;
    onBack: () => void; onDiscard: () => void; confirmDiscard: boolean; onDiscardConfirmed: () => void; onDiscardCancel: () => void;
    onConfirmed: (r: { expenseId: string }, amount: number) => void; onStale: () => Promise<void>; onFlush: () => Promise<void>;
}) {
    const now = new Date(); now.setSeconds(0, 0);
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const [actual, setActual] = useState('');
    const [category, setCategory] = useState(categories.some(c => c.key === 'groceries') ? 'groceries' : categories[0]?.key || 'other');
    const [method, setMethod] = useState(paymentMethods.some(p => p.key === 'card') ? 'card' : paymentMethods[0]?.key || 'cash');
    const [when, setWhen] = useState(local);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const savingRef = useRef(false);
    const parsedActual = actual.trim() ? parseMoney(actual) : null;
    const actualBad = actual.trim() !== '' && parsedActual === null;
    const actualMinor = actualBad ? null : parsedActual;
    const recorded = actualMinor ?? totals.total;
    const serverMatches = cart.calculatedTotalMinor === null || cart.calculatedTotalMinor === totals.total;
    const fx = cart.currency !== wsCurrency ? convertAmountSync(1, cart.currency, wsCurrency) : null;

    async function confirm() {
        if (savingRef.current || actualBad) return;
        savingRef.current = true; setSaving(true); setError(null);
        try {
            await onFlush();
            const r = await confirmOnServer(cart.id, {
                expectedTotalMinor: totals.total, category, paymentMethod: method, purchasedAt: new Date(when).toISOString(),
                notes, actualMinor, fxRate: fx && Number.isFinite(fx) && fx > 0 ? fx : null,
            });
            onConfirmed(r, recorded);
        } catch (e) {
            const err = e as Error & { code?: string };
            if (err.code === 'totals_changed') { setError(tx('The cart changed. Check the updated total, then confirm again.')); await onStale(); }
            else if (err.code === 'offline') setError(tx('You\'re offline. Your cart is safe; confirm again when you\'re connected.'));
            else setError(`${tx('Couldn\'t save the purchase. Your cart is safe; try again.')} (${err.message})`);
        } finally { savingRef.current = false; setSaving(false); }
    }

    const m = (v: number) => <span translate="no">{formatMinor(v)} {cart.currency}</span>;
    return (
        <div className="page animate-fadeIn sc-page">
            <div className="sc-top">
                <button className="icon-btn" onClick={onBack} aria-label={tx('Continue shopping')}><ArrowLeft size={18} className="sc-flip" /></button>
                <div className="sc-top-fields">
                    <h1 className="sc-h1">{tx('Purchase summary')}</h1>
                    <div className="sc-muted">{cart.storeName ? <span translate="no">{cart.storeName}</span> : tx('No store')}{cart.name ? <> · <span translate="no">{cart.name}</span></> : null}</div>
                </div>
            </div>

            <section className="card">
                <ul className="sc-sum-items">
                    {cart.items.map(i => (
                        <li key={i.id}>
                            <span translate="no">{i.name}</span>
                            <span className="sc-muted">{formatQty(i.qtyMilli)}{i.unitBasis !== 'each' ? ` ${i.unitBasis}` : ''} × {formatMinor(i.unitMinor)}{i.vatExempt ? ` · ${tx('No VAT')}` : ''}</span>
                            <b>{formatMinor(lineMinor(i.unitMinor, i.qtyMilli))}</b>
                        </li>
                    ))}
                </ul>
                <dl className="sc-breakdown">
                    <div><dt>{tx('Items')}</dt><dd>{totals.itemCount} · {tx('qty')} {formatQty(totals.totalQtyMilli)}</dd></div>
                    <div><dt>{tx('Subtotal')}</dt><dd>{m(totals.subtotal)}</dd></div>
                    {totals.exempt > 0 && <div><dt>{tx('Of which no VAT / exempt')}</dt><dd>{m(totals.exempt)}</dd></div>}
                    {cart.vatMode === 'add' && <div><dt>{tx('VAT added')} ({ratePct(cart.vatRateBp)}%)</dt><dd>{m(totals.vat)}</dd></div>}
                    {cart.vatMode === 'included' && <>
                        <div><dt>{tx('Before VAT')}</dt><dd>{m(totals.beforeVat)}</dd></div>
                        <div><dt>{tx('VAT included')} ({ratePct(cart.vatRateBp)}%)</dt><dd>{m(totals.vat)}</dd></div>
                    </>}
                    <div className="sc-grand"><dt>{tx('Estimated total')}</dt><dd>{m(totals.total)}</dd></div>
                </dl>
                <p className="sc-muted">{vatLabel(cart)}. {cart.vatMode === 'none' ? tx('The total excludes any additional VAT.') + ' ' : ''}{tx('Estimated total. Your final checkout amount may vary.')} {tx('Store prices, offers and tax treatment can change what you pay.')}</p>
                {!serverMatches && <div className="sc-warn"><AlertTriangle size={16} /><div>{tx('Updating the total…')}</div></div>}
            </section>

            <section className="card sc-confirm" aria-labelledby="sc-confirm-title">
                <h2 className="sc-h3" id="sc-confirm-title">{tx('Save as an expense')}</h2>
                <label className="sc-label" htmlFor="sc-actual">{tx('Actual amount paid')} <span className="sc-muted">({tx('optional')})</span></label>
                <input id="sc-actual" className="form-input sc-num" inputMode="decimal" placeholder={formatMinor(totals.total)} value={actual} onChange={e => setActual(e.target.value)} aria-invalid={actualBad} aria-describedby="sc-actual-help" />
                <div id="sc-actual-help" className={actualBad ? 'sc-field-error' : 'sc-hint'}>
                    {actualBad ? tx('Enter an amount like 245.50.') : actualMinor !== null ? <>{tx('Difference from the estimate')}: <b>{formatMinor(actualMinor - totals.total)}</b>. {tx('Item prices stay as scanned.')}</> : tx('Leave empty to save the estimate.')}
                </div>
                <div className="sc-row">
                    <div className="sc-col">
                        <label className="sc-label" htmlFor="sc-cat">{tx('Category')}</label>
                        <select id="sc-cat" className="form-input form-select" value={category} onChange={e => setCategory(e.target.value)}>
                            {categories.map(c => <option key={c.key} value={c.key}>{c.emoji} {tx(c.label)}</option>)}
                        </select>
                    </div>
                    <div className="sc-col">
                        <label className="sc-label" htmlFor="sc-pm">{tx('Payment method')}</label>
                        <select id="sc-pm" className="form-input form-select" value={method} onChange={e => setMethod(e.target.value)}>
                            {paymentMethods.map(p => <option key={p.key} value={p.key}>{p.emoji} {tx(p.label)}</option>)}
                        </select>
                    </div>
                </div>
                <label className="sc-label" htmlFor="sc-when">{tx('Purchase date')}</label>
                <input id="sc-when" type="datetime-local" className="form-input" value={when} max={local} onChange={e => setWhen(e.target.value)} />
                <label className="sc-label" htmlFor="sc-notes2">{tx('Notes')}</label>
                <textarea id="sc-notes2" className="form-input" rows={2} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} />
                {error && <div className="sc-warn" role="alert"><AlertTriangle size={16} /><div>{error}</div></div>}
                <div className="sc-recorded">{tx('Will be recorded as')} <b translate="no">{formatMinor(recorded)} {cart.currency}</b></div>
                <div className="sc-actions">
                    <button className="btn btn-primary sc-big" onClick={confirm} disabled={saving || actualBad || !serverMatches} aria-busy={saving}>
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}{saving ? tx('Saving…') : tx('Confirm purchase')}
                    </button>
                    <button className="btn btn-secondary" onClick={onBack} disabled={saving}>{tx('Continue shopping')}</button>
                    <button className="btn btn-ghost sc-danger" onClick={onDiscard} disabled={saving}><Trash2 size={16} />{tx('Discard cart')}</button>
                </div>
                <p className="sc-muted">{tx('Confirming records one expense in Zaylo. It doesn\'t make a payment.')}</p>
            </section>
            {confirmDiscard && <DiscardDialog onCancel={onDiscardCancel} onConfirm={onDiscardConfirmed} />}
        </div>
    );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const prev = document.activeElement as HTMLElement | null;
        ref.current?.querySelector<HTMLElement>('button')?.focus();
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', esc);
        return () => { window.removeEventListener('keydown', esc); prev?.focus?.(); };
    }, [onClose]);
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal sc-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sc-dialog-title" ref={ref}>
                <h2 className="modal-title" id="sc-dialog-title">{title}</h2>
                {children}
            </div>
        </div>
    );
}

function DiscardDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
    return (
        <Dialog title={tx('Discard this cart?')} onClose={onCancel}>
            <p>{tx('All items and photos in this cart will be removed. No expense will be created.')}</p>
            <div className="sc-dialog-actions">
                <button className="btn btn-secondary" onClick={onCancel}>{tx('Keep cart')}</button>
                <button className="btn btn-danger" onClick={onConfirm}>{tx('Discard cart')}</button>
            </div>
        </Dialog>
    );
}
