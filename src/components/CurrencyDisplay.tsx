import { useStore } from '../store/useStore';
import { formatCurrency } from '../constants';
import { convertAmountSync } from '../services/exchangeRates';

interface CurrencyDisplayProps {
    amount: number;
    currency?: string; // The original currency of the amount
    hideAmounts?: boolean;
}

export default function CurrencyDisplay({ amount, currency, hideAmounts = false }: CurrencyDisplayProps) {
    const { currency: userCurrency } = useStore();
    
    // Fallback if not provided, assuming it's recorded in user's default or workspace default
    const baseCurrency = currency || userCurrency || 'USD';

    if (hideAmounts) return <span>••••</span>;

    // Convert amount from the recorded currency to the user's selected global currency preference
    const converted = convertAmountSync(amount, baseCurrency, userCurrency);
    
    // Convert to USD specifically for the sub-text (unless USD is the native)
    const usdAmount = convertAmountSync(amount, baseCurrency, 'USD') ?? amount;
    
    // Without exchange rates, show the amount in its own currency rather than mislabel it
    const primaryText = converted === null ? formatCurrency(amount, baseCurrency, false) : formatCurrency(converted, userCurrency, false);
    const usdText = formatCurrency(usdAmount, 'USD', false);

    // The USD equivalent stays available on hover/long-press without crowding every row.
    return <span title={userCurrency === 'USD' ? undefined : `≈ ${usdText}`}>{primaryText}</span>;
}
