/**
 * Multi-currency helpers.
 *
 * An entry keeps the amount and currency it was entered in (10 USD stays 10 USD).
 * At entry time we also store its value in the workspace currency (`baseAmount`)
 * and the rate used (`fxRate`), so totals don't drift when rates move later.
 */
import { convertAmountSync } from '../services/exchangeRates';

export interface Convertible {
    amount: number;
    currency: string;
    baseAmount?: number;
    baseCurrency?: string;
    fxRate?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Adds baseAmount / baseCurrency / fxRate for the workspace currency. */
export function withBase<T extends Convertible>(entry: T, wsCurrency: string | undefined): T {
    if (!wsCurrency) return entry;
    if (entry.currency === wsCurrency) {
        return { ...entry, baseAmount: entry.amount, baseCurrency: wsCurrency, fxRate: 1 };
    }
    const one = convertAmountSync(1, entry.currency, wsCurrency);
    if (one == null || !isFinite(one)) return { ...entry, baseAmount: undefined, baseCurrency: undefined, fxRate: undefined };
    return { ...entry, baseAmount: round2(entry.amount * one), baseCurrency: wsCurrency, fxRate: one };
}

/** The entry's value in `cur`: the rate saved at entry time, else today's rate. */
export function toBase(entry: Convertible, cur: string): number {
    if (entry.currency === cur) return entry.amount;
    if (entry.baseCurrency === cur && entry.baseAmount != null) return entry.baseAmount;
    return convertAmountSync(entry.amount, entry.currency, cur) ?? entry.amount;
}

export const sumBase = (list: Convertible[], cur: string) => list.reduce((s, e) => s + toBase(e, cur), 0);

/** "1 USD = 48.52 EGP" */
export function rateLabel(from: string, to: string, rate?: number | null) {
    if (rate == null) return '';
    const digits = rate >= 100 ? 2 : rate >= 1 ? 3 : 5;
    return `1 ${from} = ${rate.toFixed(digits).replace(/\.?0+$/, '')} ${to}`;
}
