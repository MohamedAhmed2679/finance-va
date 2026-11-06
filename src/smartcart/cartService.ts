/**
 * Smart Cart in the app: the draft lives on this device first (so it survives closing the app or
 * losing signal) and is copied to the database in the background. Calculating, confirming and
 * discarding happen in the database (see v22 migration), which re-checks every number.
 */
import { supabase } from '../lib/supabase';
import { calculate, type CartTotals, type VatMode, DEFAULT_VAT_BP } from './money';
import type { ExtractionResult, UnitBasis } from './extraction';

export type CartStatus = 'draft' | 'calculated' | 'confirmed' | 'discarded';
export interface SmartItem {
    id: string;
    name: string;
    unitMinor: number;
    qtyMilli: number;
    unitBasis: UnitBasis;
    currency: string;
    packSize: string | null;
    barcode: string | null;
    productionDate: string | null;
    expiryDate: string | null;
    notes: string | null;
    vatExempt: boolean;
    source: 'scan' | 'manual';
    imagePaths: string[];
    reviewFlags: string[];
    createdAt: string;
}
export interface SmartCart {
    id: string;
    workspaceId: string;
    currency: string;
    name: string;
    storeName: string;
    status: CartStatus;
    vatMode: VatMode;
    vatRateBp: number;
    createdAt: string;
    updatedAt: string;
    items: SmartItem[];
    calculatedTotalMinor: number | null;
    expenseId: string | null;
    /** what still has to reach the database */
    pending: { cart: boolean; items: string[]; deleted: string[] };
    /** true once the cart row exists in the database */
    remote: boolean;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const KEY = (uid: string) => `zaylo_smart_cart_v1_${uid}`;
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));

// ------------------------------------------------------------------ local draft

export function loadLocalCart(uid: string): SmartCart | null {
    try {
        const c = JSON.parse(localStorage.getItem(KEY(uid)) || 'null') as SmartCart | null;
        return c && c.id && Array.isArray(c.items) ? c : null;
    } catch { return null; }
}
export function saveLocalCart(uid: string, cart: SmartCart | null) {
    try { if (cart) localStorage.setItem(KEY(uid), JSON.stringify(cart)); else localStorage.removeItem(KEY(uid)); } catch { /* storage full or blocked: the database copy still exists */ }
}

export function newCart(workspaceId: string, currency: string, name = '', storeName = ''): SmartCart {
    const now = new Date().toISOString();
    return {
        id: uuid(), workspaceId, currency, name, storeName, status: 'draft', vatMode: 'add', vatRateBp: DEFAULT_VAT_BP,
        createdAt: now, updatedAt: now, items: [], calculatedTotalMinor: null, expenseId: null,
        pending: { cart: true, items: [], deleted: [] }, remote: false,
    };
}

export const cartTotals = (c: SmartCart): CartTotals => calculate(c.items.map(i => ({ unitMinor: i.unitMinor, qtyMilli: i.qtyMilli, vatExempt: i.vatExempt })), c.vatMode, c.vatRateBp);

/** Items whose currency differs from the cart must be fixed before calculating. */
export const currencyProblems = (c: SmartCart) => c.items.filter(i => i.currency !== c.currency);

/** A likely duplicate: same barcode, or same name and price. */
export function findDuplicate(c: SmartCart, item: Pick<SmartItem, 'name' | 'unitMinor' | 'barcode' | 'id'>) {
    const n = item.name.trim().toLowerCase();
    return c.items.find(i => i.id !== item.id && ((item.barcode && i.barcode === item.barcode) || (i.name.trim().toLowerCase() === n && i.unitMinor === item.unitMinor))) || null;
}

// ------------------------------------------------------------------ database

// user_id is filled in by the database from the session (never trusted from the app)
const toCartRow = (c: SmartCart) => ({
    id: c.id, workspace_id: c.workspaceId, currency: c.currency,
    name: c.name.trim() || null, store_name: c.storeName.trim() || null, vat_mode: c.vatMode, vat_rate_bp: c.vatRateBp,
});
const toItemRow = (c: SmartCart, i: SmartItem, position: number) => ({
    id: i.id, cart_id: c.id, position, name: i.name.trim(), unit_price_minor: i.unitMinor, currency: i.currency, qty_milli: i.qtyMilli,
    unit_basis: i.unitBasis, pack_size: i.packSize, barcode: i.barcode, production_date: i.productionDate, expiry_date: i.expiryDate,
    notes: i.notes, vat_exempt: i.vatExempt, source: i.source, image_paths: i.imagePaths, review_flags: i.reviewFlags,
});

/** Copies pending changes to the database. Returns the cart with `pending` cleared for what was saved. */
export async function pushCart(c: SmartCart): Promise<SmartCart> {
    if (!supabase) return c;
    if (c.status === 'confirmed' || c.status === 'discarded') return { ...c, pending: { cart: false, items: [], deleted: [] } };
    let next = c;
    if (c.pending.cart || !c.remote) {
        const { error } = await supabase.from('smart_carts').upsert(toCartRow(c), { onConflict: 'id' });
        if (error) throw error;
        next = { ...next, remote: true, pending: { ...next.pending, cart: false } };
    }
    const ids = new Set(next.pending.items);
    const rows = next.items.map((i, n) => toItemRow(next, i, n)).filter(r => ids.has(r.id));
    if (rows.length) {
        const { error } = await supabase.from('smart_cart_items').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
    }
    if (next.pending.deleted.length) {
        const { error } = await supabase.from('smart_cart_items').delete().in('id', next.pending.deleted);
        if (error) throw error;
    }
    return { ...next, pending: { cart: false, items: [], deleted: [] } };
}

/** The newest unfinished cart in the database (for resuming on another device). */
export async function fetchOpenCart(): Promise<SmartCart | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.from('smart_carts').select('*, smart_cart_items(*)')
        .in('status', ['draft', 'calculated']).order('updated_at', { ascending: false }).limit(1);
    if (error || !data?.length) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- database row shapes, mapped field by field below
    type DbRow = Record<string, any>;
    const r = data[0] as DbRow;
    const items = ((r.smart_cart_items || []) as DbRow[]).sort((a, b) => a.position - b.position).map((i): SmartItem => ({
        id: i.id, name: i.name, unitMinor: Number(i.unit_price_minor), qtyMilli: Number(i.qty_milli), unitBasis: i.unit_basis, currency: i.currency,
        packSize: i.pack_size, barcode: i.barcode, productionDate: i.production_date, expiryDate: i.expiry_date, notes: i.notes,
        vatExempt: i.vat_exempt, source: i.source, imagePaths: i.image_paths || [], reviewFlags: i.review_flags || [], createdAt: i.created_at,
    }));
    return {
        id: r.id, workspaceId: r.workspace_id, currency: r.currency, name: r.name || '', storeName: r.store_name || '', status: r.status,
        vatMode: r.vat_mode, vatRateBp: r.vat_rate_bp, createdAt: r.created_at, updatedAt: r.updated_at, items,
        calculatedTotalMinor: r.calculated_total_minor == null ? null : Number(r.calculated_total_minor), expenseId: r.expense_id,
        pending: { cart: false, items: [], deleted: [] }, remote: true,
    };
}

const dbError = (e: { message?: string } | null) => {
    const m = String(e?.message || 'Something went wrong').replace(/^smart_cart:\s*/, '');
    return Object.assign(new Error(m), { code: /totals_changed/.test(m) ? 'totals_changed' : /Failed to fetch|NetworkError|Load failed|ERR_INTERNET|ERR_NETWORK/i.test(m) ? 'offline' : 'error' });
};

const db = () => { if (!supabase) throw Object.assign(new Error('Zaylo isn\'t connected to the server.'), { code: 'offline' }); return supabase; };

export async function calculateOnServer(cartId: string): Promise<CartTotals & { currency: string }> {
    const { data, error } = await db().rpc('calculate_smart_cart', { p_cart_id: cartId });
    if (error) throw dbError(error);
    const t = data as Record<string, number | string>;
    return {
        lines: [], itemCount: Number(t.itemCount), totalQtyMilli: Number(t.totalQtyMilli), subtotal: Number(t.subtotal), taxable: Number(t.taxable),
        exempt: Number(t.exempt), vat: Number(t.vat), beforeVat: Number(t.beforeVat), total: Number(t.total), mode: t.mode as VatMode, rateBp: Number(t.rateBp), currency: String(t.currency),
    };
}

export interface ConfirmInput {
    expectedTotalMinor: number; category: string; paymentMethod: string; purchasedAt: string; notes: string; actualMinor: number | null; fxRate: number | null;
}
export async function confirmOnServer(cartId: string, i: ConfirmInput): Promise<{ expenseId: string; alreadyConfirmed: boolean }> {
    const { data, error } = await db().rpc('confirm_smart_cart', {
        p_cart_id: cartId, p_expected_total_minor: i.expectedTotalMinor, p_category: i.category, p_payment_method: i.paymentMethod,
        p_purchased_at: i.purchasedAt, p_notes: i.notes || null, p_actual_minor: i.actualMinor, p_fx_rate: i.fxRate,
    });
    if (error) throw dbError(error);
    return data as { expenseId: string; alreadyConfirmed: boolean };
}

export async function discardOnServer(cartId: string): Promise<string[]> {
    const { data, error } = await db().rpc('discard_smart_cart', { p_cart_id: cartId });
    if (error) throw dbError(error);
    return ((data as { imagePaths?: string[] })?.imagePaths) || [];
}

// ------------------------------------------------------------------ images

const BUCKET = 'smart-cart';
export const MAX_PICK_BYTES = 20 * 1024 * 1024;

/** Shrinks a photo to ≤1600 px JPEG (smaller uploads, no location metadata). */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; base64: string; previewUrl: string }> {
    if (!/^image\//.test(file.type)) throw new Error('Choose a photo (JPEG, PNG or WebP).');
    if (file.size > MAX_PICK_BYTES) throw new Error('That photo is too large.');
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(file); } catch { throw new Error('This photo format can\'t be opened here. Try a JPEG or PNG.'); }
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not read the photo.'))), 'image/jpeg', 0.82));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { blob, base64: btoa(bin), previewUrl: URL.createObjectURL(blob) };
}

export async function uploadImage(cartId: string, blob: Blob): Promise<string> {
    if (!supabase) throw new Error('Not connected');
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) throw new Error('Sign in again to save photos.');
    const path = `${uid}/${cartId}/${uuid()}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    return path;
}
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
    if (!supabase || !paths.length) return {};
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
    return Object.fromEntries((data || []).flatMap(d => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as [string, string]] : [])));
}
export async function deleteImages(paths: string[]) {
    if (!supabase || !paths.length) return;
    await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
}

// ------------------------------------------------------------------ extraction

export class ExtractionError extends Error {
    kind: 'offline' | 'limit' | 'image' | 'service';
    constructor(msg: string, kind: 'offline' | 'limit' | 'image' | 'service') { super(msg); this.kind = kind; }
}

export async function extractFromImage(base64: string, cartCurrency: string, purpose: 'tag' | 'packaging'): Promise<ExtractionResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ExtractionError('Reading a photo needs an internet connection. You can add the item by hand now.', 'offline');
    const { data } = (await supabase?.auth.getSession()) || { data: { session: null } };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55_000);
    try {
        const res = await fetch(`${API_BASE}/api/ai/zaylo`, {
            method: 'POST', signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json', ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
            body: JSON.stringify({ action: 'price_tag', image: { mime: 'image/jpeg', data: base64 }, cartCurrency, purpose }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new ExtractionError(out.error || 'The photo could not be read.', res.status === 429 ? 'limit' : res.status === 413 || res.status === 415 ? 'image' : 'service');
        return out as ExtractionResult;
    } catch (e) {
        if (e instanceof ExtractionError) throw e;
        throw new ExtractionError((e as Error).name === 'AbortError' ? 'Reading the photo took too long. Try again or add the item by hand.' : 'Reading a photo needs an internet connection. You can add the item by hand now.', 'offline');
    } finally { clearTimeout(timer); }
}
