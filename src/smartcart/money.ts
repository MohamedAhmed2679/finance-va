/**
 * Smart Cart money maths. Every amount is an integer number of minor units (piastres / cents),
 * held in BigInt while multiplying, so nothing goes through binary floating point.
 *
 * Rounding strategy (one rule everywhere, mirrored by public.smart_cart_totals in the database):
 *   1. line amount   = unit price × quantity, rounded half-up to the minor unit (per line)
 *   2. VAT           = computed once on the taxable subtotal, rounded half-up
 *        add      VAT = taxable × rate
 *        included VAT = taxable × rate / (1 + rate)   (already inside the price, never added again)
 *        none     VAT = 0
 *   3. totals are sums of the rounded values, so lines, subtotal, VAT and total always reconcile.
 */

export type VatMode = 'none' | 'add' | 'included';
/** Currency decimals; Zaylo stores money with 2 decimals everywhere (DECIMAL(12,2)). */
export const MINOR_DIGITS = 2;
export const QTY_DIGITS = 3; // weighed items: up to 3 decimals (e.g. 0.725 kg)
export const DEFAULT_VAT_BP = 1400; // 14%, in basis points

export interface CalcItem {
    unitMinor: number;       // integer, ≥ 0
    qtyMilli: number;        // integer quantity × 1000, > 0
    vatExempt?: boolean;
    included?: boolean;      // false = removed from the estimate (kept for undo)
}

export interface CartTotals {
    lines: number[];         // per line, in minor units
    itemCount: number;       // distinct included items
    totalQtyMilli: number;   // sum of quantities × 1000
    subtotal: number;        // sum of line amounts (as entered, before adding any VAT)
    taxable: number;         // part of the subtotal that VAT applies to
    exempt: number;          // part marked No VAT / Exempt
    vat: number;             // added (mode add) or contained (mode included)
    beforeVat: number;       // amount excluding VAT
    total: number;           // estimated payable
    mode: VatMode;
    rateBp: number;
}

/** a / b rounded half-up, for non-negative BigInts. */
const divRound = (a: bigint, b: bigint) => (a * 2n + b) / (b * 2n);

export function lineMinor(unitMinor: number, qtyMilli: number): number {
    return Number(divRound(BigInt(unitMinor) * BigInt(qtyMilli), 1000n));
}

export function calculate(items: CalcItem[], mode: VatMode, rateBp = DEFAULT_VAT_BP): CartTotals {
    const live = items.filter(i => i.included !== false);
    for (const i of live) {
        if (!Number.isSafeInteger(i.unitMinor) || i.unitMinor < 0) throw new Error('invalid_price');
        if (!Number.isSafeInteger(i.qtyMilli) || i.qtyMilli <= 0) throw new Error('invalid_quantity');
    }
    if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) throw new Error('invalid_vat_rate');
    const lines = live.map(i => lineMinor(i.unitMinor, i.qtyMilli));
    let taxable = 0n, exempt = 0n;
    live.forEach((i, n) => { if (i.vatExempt) exempt += BigInt(lines[n]); else taxable += BigInt(lines[n]); });
    const subtotal = taxable + exempt;
    const rate = BigInt(rateBp);
    let vat = 0n, beforeVat = subtotal, total = subtotal;
    if (mode === 'add') { vat = divRound(taxable * rate, 10000n); total = subtotal + vat; beforeVat = subtotal; }
    else if (mode === 'included') { vat = divRound(taxable * rate, 10000n + rate); total = subtotal; beforeVat = subtotal - vat; }
    return {
        lines,
        itemCount: live.length,
        totalQtyMilli: live.reduce((s, i) => s + i.qtyMilli, 0),
        subtotal: Number(subtotal), taxable: Number(taxable), exempt: Number(exempt),
        vat: Number(vat), beforeVat: Number(beforeVat), total: Number(total), mode, rateBp,
    };
}

// ------------------------------------------------------------------ parsing & formatting

const ARABIC_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
export const latinDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, d => ARABIC_DIGITS[d]).replace(/[٫]/g, '.').replace(/[٬]/g, ',');

/**
 * Parses a typed amount into minor units: "12.5", "12,50", "1,234.50", "1.234,50", "١٢٫٥".
 * Returns null for anything that isn't a clean non-negative number with ≤ `digits` decimals.
 */
export function parseDecimal(input: string, digits: number): number | null {
    let s = latinDigits(String(input ?? '')).trim().replace(/\s/g, '');
    if (!s || /[^0-9.,]/.test(s)) return null;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    const sep = Math.max(lastDot, lastComma);
    if (sep >= 0) {
        const decimals = s.length - sep - 1;
        // "1.234" could be 1234 or 1.234 depending on the country: ask instead of guessing
        if (lastComma < 0 && decimals === 3 && digits < 3) return null;
        const isDecimal = (lastDot >= 0 && lastComma >= 0) || decimals !== 3 || digits >= 3;
        if (isDecimal) s = s.slice(0, sep).replace(/[.,]/g, '') + '.' + s.slice(sep + 1);
        else s = s.replace(/[.,]/g, ''); // "1,234" thousands
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const [whole, frac = ''] = s.split('.');
    if (frac.length > digits) return null;
    const v = BigInt(whole + frac.padEnd(digits, '0'));
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(v);
}

export const parseMoney = (s: string) => parseDecimal(s, MINOR_DIGITS);
export const parseQty = (s: string) => parseDecimal(s, QTY_DIGITS);

/** Minor units → "1,234.50" (Latin digits, like the rest of Zaylo). */
export function formatMinor(minor: number): string {
    const neg = minor < 0; const v = Math.abs(minor);
    const whole = Math.floor(v / 100), frac = String(v % 100).padStart(2, '0');
    return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}.${frac}`;
}
export function formatQty(qtyMilli: number): string {
    const whole = Math.floor(qtyMilli / 1000), frac = String(qtyMilli % 1000).padStart(3, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : String(whole);
}
/** Minor units → number with 2 decimals, for storing in DECIMAL(12,2) columns. */
export const minorToDecimal = (minor: number) => Number(formatMinor(minor).replace(/,/g, ''));
