import { useStore } from '../store/useStore';
import { formatCurrency, formatMoney } from '../constants';
import { convertAmountSync } from '../services/exchangeRates';
import { toBase, type Convertible } from '../utils/money';

interface CurrencyDisplayProps {
    amount: number;
    currency?: string; // The original currency of the amount
    hideAmounts?: boolean;
    /** The full entry, so the rate saved when it was entered is used. */
    entry?: Convertible;
    /** Also show the amount as entered when it was in another currency. */
    showOriginal?: boolean;
    /** Whole amounts without .00 (summaries such as the dashboard). */
    trim?: boolean;
}

export default function CurrencyDisplay({ amount, currency, hideAmounts = false, entry, showOriginal = false, trim = false }: CurrencyDisplayProps) {
    const fmt = trim ? formatMoney : formatCurrency;
    const { currency: userCurrency } = useStore();
    
    // Fallback if not provided, assuming it's recorded in user's default or workspace default
    const baseCurrency = currency || userCurrency || 'USD';

    if (hideAmounts) return <span>••••</span>;

    // Convert amount from the recorded currency to the user's selected global currency preference
    const converted = entry && entry.baseCurrency === userCurrency && entry.baseAmount != null
        ? toBase(entry, userCurrency)
        : convertAmountSync(amount, baseCurrency, userCurrency);
    
    // Convert to USD specifically for the sub-text (unless USD is the native)
    const usdAmount = convertAmountSync(amount, baseCurrency, 'USD') ?? amount;
    
    // Without exchange rates, show the amount in its own currency rather than mislabel it
    const primaryText = converted === null ? fmt(amount, baseCurrency, false) : fmt(converted, userCurrency, false);
    const usdText = formatCurrency(usdAmount, 'USD', false);

    // The USD equivalent stays available on hover/long-press without crowding every row.
    if (showOriginal && baseCurrency !== userCurrency && converted !== null) {
        return (
            <span className="amount-dual" title={entry?.fxRate ? `Converted at 1 ${baseCurrency} = ${entry.fxRate.toFixed(4)} ${entry.baseCurrency}` : undefined}>
                <span>{primaryText}</span>
                <span className="amount-orig">{fmt(amount, baseCurrency, false)}</span>
            </span>
        );
    }
    return <span title={userCurrency === 'USD' ? undefined : `≈ ${usdText}`}>{primaryText}</span>;
}
