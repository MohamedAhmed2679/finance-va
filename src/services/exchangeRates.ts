/**
 * Exchange Rate Service
 * Fetches, caches (1-hour TTL), and provides currency conversion.
 */

const API_URL = 'https://api.exchangerate-api.com/v4/latest/USD';
const CACHE_KEY = 'fva_exchange_rates';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedRates {
    rates: Record<string, number>;
    fetchedAt: number;
}

// Hardcoded fallback rates (USD-based) — used when API is unreachable
const FALLBACK_RATES: Record<string, number> = {
    USD: 1, EUR: 0.92, GBP: 0.79, JPY: 149.5, CAD: 1.36, AUD: 1.53,
    CHF: 0.88, CNY: 7.24, INR: 83.1, MXN: 17.1, BRL: 4.97, KRW: 1320,
    SGD: 1.34, HKD: 7.82, NOK: 10.5, SEK: 10.3, DKK: 6.87, NZD: 1.63,
    ZAR: 18.6, RUB: 92.5, TRY: 30.2, AED: 3.67, SAR: 3.75, EGP: 48.5,
    KWD: 0.31, QAR: 3.64, BHD: 0.38, OMR: 0.38, JOD: 0.71, LBP: 89500,
    MAD: 10.0, TND: 3.13, DZD: 134.5, SDG: 601, LYD: 4.85, IQD: 1310,
    SYP: 13000, YER: 250, PKR: 278, BDT: 110, LKR: 320, THB: 35.2,
    IDR: 15600, MYR: 4.72, PHP: 56.2, VND: 24500, NGN: 1550, GHS: 12.5,
    KES: 153, ETB: 56.8, PLN: 4.02, CZK: 22.8, HUF: 355, RON: 4.58,
    UAH: 37.5, ARS: 870, CLP: 920, COP: 3950, PEN: 3.72,
};

let ratesCache: CachedRates | null = null;
let fetchPromise: Promise<Record<string, number>> | null = null;
let isStale = false;

function loadFromStorage(): CachedRates | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as CachedRates;
    } catch {
        return null;
    }
}

function saveToStorage(data: CachedRates) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch { /* quota exceeded, ignore */ }
}

/**
 * Returns exchange rates (USD-based). Uses cache if fresh, otherwise fetches.
 */
export async function getRates(): Promise<Record<string, number>> {
    // Return from memory cache if fresh
    if (ratesCache && Date.now() - ratesCache.fetchedAt < CACHE_TTL_MS) {
        isStale = false;
        return ratesCache.rates;
    }

    // Check localStorage
    const stored = loadFromStorage();
    if (stored && Date.now() - stored.fetchedAt < CACHE_TTL_MS) {
        ratesCache = stored;
        isStale = false;
        return stored.rates;
    }

    // Deduplicate concurrent fetches
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        try {
            const res = await fetch(API_URL);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.rates) {
                const cached: CachedRates = { rates: data.rates, fetchedAt: Date.now() };
                ratesCache = cached;
                saveToStorage(cached);
                isStale = false;
                return data.rates as Record<string, number>;
            }
            throw new Error('No rates in response');
        } catch {
            // Use stale cache if available
            if (stored) {
                ratesCache = stored;
                isStale = true;
                return stored.rates;
            }
            // Ultimate fallback
            ratesCache = { rates: FALLBACK_RATES, fetchedAt: 0 };
            isStale = true;
            return FALLBACK_RATES;
        } finally {
            fetchPromise = null;
        }
    })();

    return fetchPromise;
}

/**
 * Convert an amount from one currency to another.
 */
export async function convertAmount(
    amount: number,
    fromCurrency: string,
    toCurrency: string
): Promise<number> {
    if (fromCurrency === toCurrency) return amount;
    const rates = await getRates();
    const fromRate = rates[fromCurrency] ?? 1;
    const toRate = rates[toCurrency] ?? 1;
    return (amount / fromRate) * toRate;
}

/**
 * Synchronous conversion using cached rates (returns null if no cache).
 */
export function convertAmountSync(
    amount: number,
    fromCurrency: string,
    toCurrency: string
): number | null {
    if (fromCurrency === toCurrency) return amount;
    const cached = ratesCache ?? loadFromStorage();
    if (!cached) return null;
    const fromRate = cached.rates[fromCurrency] ?? 1;
    const toRate = cached.rates[toCurrency] ?? 1;
    return (amount / fromRate) * toRate;
}

/**
 * Whether the current rates are stale (from cache, API was unreachable).
 */
export function areRatesStale(): boolean {
    return isStale;
}

/**
 * Preload rates into cache (call on app mount).
 */
export function preloadRates(): void {
    getRates().catch(() => {});
}
