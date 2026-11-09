import type { CategoryKey } from '../store/useStore';
import { CURRENCIES } from '../constants';

export interface ParsedExpense {
    amount: number;
    currency: string;
    merchant: string;
    category: CategoryKey;
    description: string;
    confidence: number;
    date?: string;          // YYYY-MM-DD, from the receipt or what was said
    paymentMethod?: string;
}

/**
 * Free text → expenses. Uses Zaylo AI (server, Gemini) and falls back to on-device rules,
 * so pasting an SMS still works offline or when AI isn't configured.
 */
export async function parseExpensesText(text: string, baseCurrency: string): Promise<ParsedExpense[]> {
    try {
        const { extractExpenses } = await import('./zayloAI');
        const r = await extractExpenses({ source: 'text', text });
        if (r.expenses.length) return normalise(r.expenses, baseCurrency);
    } catch { /* fall through to local rules */ }
    return parseLocally(text, baseCurrency);
}

function normalise(list: ReadonlyArray<Partial<Record<keyof ParsedExpense, unknown>>>, baseCurrency: string): ParsedExpense[] {
    return list
        .filter(e => Number(e.amount) > 0)
        .map(e => ({
            amount: Math.round(Number(e.amount) * 100) / 100,
            currency: CURRENCIES.some(c => c.code === String(e.currency).toUpperCase()) ? String(e.currency).toUpperCase() : baseCurrency,
            merchant: String(e.merchant || 'Unknown'),
            category: String(e.category || 'other'),
            description: String(e.description || ''),
            confidence: Number(e.confidence) || 0.6,
        }));
}

// ─── On-device rules ─────────────────────────────────────────────

const CURRENCY_WORDS: Record<string, string> = {
    'egp': 'EGP', 'le': 'EGP', 'l.e': 'EGP', 'جنيه': 'EGP', 'ج.م': 'EGP', 'pound': 'EGP', 'pounds': 'EGP',
    'usd': 'USD', '$': 'USD', 'dollar': 'USD', 'dollars': 'USD', 'دولار': 'USD',
    'eur': 'EUR', '€': 'EUR', 'euro': 'EUR', 'euros': 'EUR', 'gbp': 'GBP', '£': 'GBP',
    'sar': 'SAR', 'riyal': 'SAR', 'ريال': 'SAR', 'aed': 'AED', 'dirham': 'AED', 'درهم': 'AED',
    'kwd': 'KWD', 'qar': 'QAR', 'bhd': 'BHD', 'omr': 'OMR', 'jod': 'JOD',
};

const CATEGORY_HINTS: [CategoryKey, RegExp][] = [
    ['groceries', /carrefour|seoudi|spinneys|hyper|market|grocer|kazyon|metro|بقال|سوبر/i],
    ['dining', /restaurant|cafe|café|coffee|starbucks|costa|kfc|mcdonald|pizza|burger|talabat|elmenus|zooba|مطعم|قهوة/i],
    ['transport', /uber|careem|didi|indrive|taxi|metro ticket|fuel|petrol|gas station|benzin|بنزين|مواصلات/i],
    ['utilities', /vodafone|orange|etisalat|\bwe\b|electric|water|internet|bill|كهرباء|فاتورة/i],
    ['healthcare', /pharma|pharmacy|clinic|hospital|doctor|lab|صيدلية|دكتور/i],
    ['shopping', /amazon|noon|jumia|zara|h&m|ikea|mall|store|shop/i],
    ['entertainment', /netflix|spotify|cinema|movie|shahid|playstation|steam/i],
    ['travel', /hotel|airbnb|booking|egyptair|flight|airline|emirates/i],
    ['education', /course|udemy|school|tuition|book/i],
];

export function parseLocally(text: string, baseCurrency: string): ParsedExpense[] {
    const out: ParsedExpense[] = [];
    // Split on sentence breaks / "and" so "50 for coffee and 120 uber" gives two expenses
    const parts = text.split(/\n|;|\.\s|\band\b|\bو\b/i).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
        if (/balance|رصيد|otp|code is|available/i.test(part) && !/purchase|paid|spent|debited|خصم|شراء/i.test(part)) continue;
        const m = part.match(/(?:([$€£])\s*)?(\d{1,3}(?:[,\s]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*([A-Za-z.؀-ۿ$€£]{1,8})?/);
        if (!m) continue;
        const amount = parseFloat(`${m[2].replace(/[,\s]/g, '')}.${m[3] || '0'}`);
        if (!(amount > 0)) continue;
        const curToken = (m[1] || m[4] || '').toLowerCase().replace(/\.$/, '');
        const currency = CURRENCY_WORDS[curToken] || (CURRENCIES.some(c => c.code === curToken.toUpperCase()) ? curToken.toUpperCase() : baseCurrency);
        const merchantMatch = part.match(/(?:\bat|@|عند|لدى)\s+([A-Za-z0-9&'؀-ۿ][\w&' ؀-ۿ-]{1,30})/i)
            || part.match(/(?:\bfrom|\bto|في|من)\s+([A-Za-z0-9&'؀-ۿ][\w&' ؀-ۿ-]{1,30})/i)
            || part.match(/(?:for|on)\s+([A-Za-z؀-ۿ][\w&' ؀-ۿ-]{1,30})/i);
        const merchant = (merchantMatch?.[1] || '').replace(/\s+(on|at|for|with|using|card).*$/i, '').trim();
        const category = CATEGORY_HINTS.find(([, re]) => re.test(part))?.[0] || 'other';
        out.push({
            amount,
            currency,
            merchant: merchant ? merchant[0].toUpperCase() + merchant.slice(1) : 'Unknown',
            category,
            description: part.slice(0, 80),
            confidence: merchant ? 0.55 : 0.35,
        });
    }
    return out;
}
