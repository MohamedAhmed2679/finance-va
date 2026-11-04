import { useStore } from '../store/useStore';
import type { CategoryKey } from '../store/useStore';
import { CURRENCIES } from '../constants';

export interface ParsedExpense {
    amount: number;
    currency: string;
    merchant: string;
    category: CategoryKey;
    description: string;
    confidence: number;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/**
 * Turns free text (bank SMS, voice transcript) into expenses.
 * Order: server AI endpoint → the user's own Gemini key (Settings) → on-device rules.
 * The on-device rules mean the feature still works with no AI configured.
 */
export async function parseExpensesText(text: string, baseCurrency: string): Promise<ParsedExpense[]> {
    const today = new Date().toISOString().slice(0, 10);
    try {
        const res = await fetch(`${API_BASE}/api/ai/parse-expenses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, baseCurrency, dateContext: today }),
        });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.expenses) && data.expenses.length) return normalise(data.expenses, baseCurrency);
        }
    } catch { /* fall through */ }

    const personalKey = useStore.getState().user?.geminiKey;
    if (personalKey) {
        try {
            const prompt = `Extract expenses from this text. Default currency ${baseCurrency}. Reply with JSON only: {"expenses":[{"amount":number,"currency":"ISO code","merchant":string,"category":"groceries|dining|transport|shopping|entertainment|utilities|healthcare|travel|education|other","description":string,"confidence":number}]}. Text: """${text.slice(0, 2000)}"""`;
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${personalKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
            });
            const data = await res.json();
            const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
            if (Array.isArray(parsed.expenses) && parsed.expenses.length) return normalise(parsed.expenses, baseCurrency);
        } catch { /* fall through */ }
    }

    return parseLocally(text, baseCurrency);
}

function normalise(list: any[], baseCurrency: string): ParsedExpense[] {
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
