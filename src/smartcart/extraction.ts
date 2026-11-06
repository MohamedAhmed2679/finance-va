/**
 * Turning what the vision model read off a price tag into a reviewable item.
 *
 * The model is asked to copy text exactly as printed (prices, dates, currency marks) and to say
 * what kind of price each one is. Everything numeric is parsed here, deterministically, so:
 *   - nothing missing is invented (unknown → null, shown as "Not available")
 *   - a per-kg / per-litre comparison price is never used as the package price
 *   - promotional / loyalty / multi-buy prices are only offered, never applied automatically
 *   - ambiguous dates (05/06/26) and ambiguous currencies ($, £) are flagged for review
 * The text in the image is data; nothing in it is followed as an instruction.
 */
import { latinDigits, parseMoney } from './money';

export type PriceKind = 'package' | 'unit_comparison' | 'promotional' | 'unknown';
export type UnitBasis = 'each' | 'kg' | 'g' | 'l' | 'ml' | 'm';

/** Shape the model returns (all strings as printed, or null). */
export interface RawPriceTag {
    readable: boolean;
    note?: string | null;
    products: {
        name: string | null;
        prices: { text: string | null; kind: PriceKind; currencyText?: string | null; conditions?: string | null; perUnit?: string | null }[];
        packSize?: string | null;
        barcode?: string | null;
        productionDate?: string | null;
        expiryDate?: string | null;
        expiryLabel?: string | null; // "EXP", "Best before", "انتهاء", ...
        uncertain?: string[] | null;  // fields the model itself marked as hard to read
    }[];
}

export interface PriceOption {
    minor: number;
    kind: PriceKind;
    text: string;
    conditions: string | null;
    perUnit: string | null;
    currency: string | null;
    currencyAmbiguous: boolean;
}
export interface DateField { value: string | null; raw: string | null; ambiguous: boolean }
export interface ProductCandidate {
    name: string | null;
    packageOptions: PriceOption[];      // usable as the item price
    promoOptions: PriceOption[];        // need the user to confirm the conditions
    comparisonPrices: PriceOption[];    // per kg / per litre: information only
    packSize: string | null;
    unitBasis: UnitBasis;
    barcode: string | null;
    productionDate: DateField;
    expiryDate: DateField;
    reviewFlags: string[];
}
export interface ExtractionResult {
    status: 'ok' | 'choose' | 'unreadable';
    message: string | null;
    candidates: ProductCandidate[];
}

const clean = (s: unknown, max: number) => {
    if (typeof s !== 'string') return null;
    const v = [...s].map(ch => { const c = ch.charCodeAt(0); return c < 32 || c === 127 ? ' ' : ch; }).join('').replace(/\s+/g, ' ').trim();
    return v ? v.slice(0, max) : null;
};

// ------------------------------------------------------------------ currency

const CURRENCY_MARKS: [RegExp, string, boolean][] = [
    // [pattern, ISO code, ambiguous]
    [/^(egp|le|l\.e\.?|e£|ج\.?م\.?|جنيه|جم)$/i, 'EGP', false],
    [/^(sar|ر\.?س\.?|ريال)$/i, 'SAR', false],
    [/^(aed|د\.?إ\.?|درهم)$/i, 'AED', false],
    [/^(kwd|د\.?ك\.?)$/i, 'KWD', false],
    [/^(usd|us\$)$/i, 'USD', false],
    [/^(eur|€)$/i, 'EUR', false],
    [/^(gbp)$/i, 'GBP', false],
    [/^\$$/, 'USD', true],          // $ is used by many currencies
    [/^£$/, 'GBP', true],           // £ is also used for Egyptian pounds
];
export function parseCurrency(text: string | null | undefined): { code: string | null; ambiguous: boolean } {
    const t = clean(text, 12);
    if (!t) return { code: null, ambiguous: false };
    if (/^[A-Z]{3}$/.test(t)) return { code: t, ambiguous: false };
    for (const [re, code, ambiguous] of CURRENCY_MARKS) if (re.test(t)) return { code, ambiguous };
    return { code: null, ambiguous: true };
}

/** Pulls a price out of printed text such as "EGP 34.95", "34,95 ج.م", "٣٤٫٩٥". */
export function parsePriceText(text: string | null | undefined): { minor: number | null; currencyText: string | null } {
    const t = clean(text, 40);
    if (!t) return { minor: null, currencyText: null };
    const s = latinDigits(t);
    const nums = s.match(/\d[\d.,]*/g) || [];
    if (nums.length !== 1) return { minor: null, currencyText: null }; // none, or several numbers in one string: ask the user
    const num = nums[0].replace(/[.,]$/, '');
    const minor = parseMoney(num);
    const rest = s.replace(nums[0], '').replace(/[\s:=/-]+/g, ' ').trim();
    return { minor, currencyText: rest || null };
}

// ------------------------------------------------------------------ dates

/**
 * Parses a printed date. Only unambiguous dates get a value:
 *   2026-05-31, 31/05/2026 (31 can't be a month), 31.05.26, 15 MAY 2026, 2026/05/31
 * "05/06/2026" could be 5 June or 6 May → ambiguous, value null, the user picks.
 * Month-only dates ("05/2026") are kept as text and flagged; no day is guessed.
 */
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, اغسطس: 8, أغسطس: 8, سبتمبر: 9, اكتوبر: 10, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const year4 = (y: number) => (y < 100 ? 2000 + y : y);
function valid(y: number, m: number, d: number) {
    if (m < 1 || m > 12 || d < 1 || y < 1990 || y > 2100) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}
export function parsePrintedDate(text: string | null | undefined): DateField {
    const raw = clean(text, 40);
    if (!raw) return { value: null, raw: null, ambiguous: false };
    const s = latinDigits(raw).toLowerCase().replace(/(exp(iry)?|best\s*before|bb|use\s*by|prod(uction)?|mfg|mfd|pd|ed|انتهاء|تاريخ|صلاحية|الإنتاج|انتاج|إنتاج)[:.\s]*/gi, ' ').trim();
    let m: RegExpMatchArray | null;
    if ((m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) {
        const v = valid(+m[1], +m[2], +m[3]); return { value: v, raw, ambiguous: !v };
    }
    if ((m = s.match(/(\d{1,2})\s*[-/. ]?\s*([a-z\u0600-\u06ff]{3,9})\.?\s*[-/. ]?\s*(\d{2,4})/i))) {
        const tok = m[2].toLowerCase();
        const mon = MONTHS[/[\u0600-\u06ff]/.test(tok) ? tok : tok.slice(0, 3)];
        if (mon) { const v = valid(year4(+m[3]), mon, +m[1]); return { value: v, raw, ambiguous: !v }; }
    }
    if ((m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) {
        const a = +m[1], b = +m[2], y = year4(+m[3]);
        if (a > 12 && b <= 12) { const v = valid(y, b, a); return { value: v, raw, ambiguous: !v }; }   // day first
        if (b > 12 && a <= 12) { const v = valid(y, a, b); return { value: v, raw, ambiguous: !v }; }   // month first
        if (a === b) { const v = valid(y, a, b); return { value: v, raw, ambiguous: !v }; }
        return { value: null, raw, ambiguous: true };
    }
    // month and year only, or anything else: keep the text, ask the user
    return { value: null, raw, ambiguous: true };
}

// ------------------------------------------------------------------ units

export function unitBasisFrom(packSize: string | null, perUnit: string | null): UnitBasis {
    const s = `${perUnit || ''}`.toLowerCase();
    if (/\b(kg|kilo|كجم|كيلو)\b/.test(s)) return 'kg';
    return packSize && /^\s*(per|\/)\s*(kg|kilo)/i.test(packSize) ? 'kg' : 'each';
}

// ------------------------------------------------------------------ normalize

export function normalizePriceTag(raw: RawPriceTag, cartCurrency: string): ExtractionResult {
    const products = Array.isArray(raw?.products) ? raw.products.slice(0, 6) : [];
    const candidates: ProductCandidate[] = products.map(p => {
        const flags = new Set<string>();
        const name = clean(p.name, 120);
        if (!name) flags.add('name');
        const opts: PriceOption[] = [];
        for (const pr of (p.prices || []).slice(0, 8)) {
            const { minor, currencyText } = parsePriceText(pr.text);
            if (minor === null) { if (pr.text) flags.add('price'); continue; }
            const cur = parseCurrency(pr.currencyText ?? currencyText);
            const kind: PriceKind = ['package', 'unit_comparison', 'promotional', 'unknown'].includes(pr.kind) ? pr.kind : 'unknown';
            opts.push({ minor, kind, text: clean(pr.text, 40) || '', conditions: clean(pr.conditions, 160), perUnit: clean(pr.perUnit, 30), currency: cur.code, currencyAmbiguous: cur.ambiguous });
        }
        // de-duplicate identical readings
        const uniq = opts.filter((o, i) => opts.findIndex(x => x.minor === o.minor && x.kind === o.kind) === i);
        const packageOptions = uniq.filter(o => o.kind === 'package' || o.kind === 'unknown');
        const promoOptions = uniq.filter(o => o.kind === 'promotional');
        const comparisonPrices = uniq.filter(o => o.kind === 'unit_comparison');
        if (packageOptions.length === 0) flags.add('price');
        if (packageOptions.length > 1) flags.add('price_choice');
        if (packageOptions.some(o => o.kind === 'unknown')) flags.add('price');
        if (promoOptions.length) flags.add('promotion');
        const currencies = new Set(packageOptions.map(o => o.currency).filter(Boolean));
        if (packageOptions.some(o => o.currencyAmbiguous)) flags.add('currency');
        if ([...currencies].some(c => c !== cartCurrency)) flags.add('currency_mismatch');
        const productionDate = parsePrintedDate(p.productionDate);
        const expiryDate = parsePrintedDate(p.expiryDate);
        if (productionDate.ambiguous) flags.add('production_date');
        if (expiryDate.ambiguous) flags.add('expiry_date');
        for (const f of (p.uncertain || []).slice(0, 10)) {
            const k = String(f).toLowerCase();
            if (['name', 'price', 'currency', 'pack_size', 'barcode', 'production_date', 'expiry_date'].includes(k)) flags.add(k);
        }
        const packSize = clean(p.packSize, 40);
        const barcodeRaw = clean(p.barcode, 40);
        const barcode = barcodeRaw && /^[0-9A-Za-z-]{4,40}$/.test(latinDigits(barcodeRaw).replace(/\s/g, '')) ? latinDigits(barcodeRaw).replace(/\s/g, '') : null;
        if (barcodeRaw && !barcode) flags.add('barcode');
        return {
            name, packageOptions, promoOptions, comparisonPrices, packSize,
            unitBasis: unitBasisFrom(packSize, comparisonPrices[0]?.perUnit ?? null),
            barcode, productionDate, expiryDate, reviewFlags: [...flags],
        };
    }).filter(c => c.name || c.packageOptions.length || c.promoOptions.length);

    if (!raw?.readable || candidates.length === 0) {
        return { status: 'unreadable', message: clean(raw?.note, 200), candidates: [] };
    }
    const status = candidates.length > 1 || candidates[0].packageOptions.length !== 1 ? 'choose' : 'ok';
    return { status, message: clean(raw?.note, 200), candidates };
}

/** Image checks shared by the browser and the server. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // base64 must stay under the 4.5 MB request limit
export function sniffImageType(bytes: Uint8Array): (typeof IMAGE_TYPES)[number] | null {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
    return null;
}
