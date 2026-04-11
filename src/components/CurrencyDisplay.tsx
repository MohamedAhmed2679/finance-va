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
    const primaryAmount = convertAmountSync(amount, baseCurrency, userCurrency) ?? amount;
    
    // Convert to USD specifically for the sub-text (unless USD is the native)
    const usdAmount = convertAmountSync(amount, baseCurrency, 'USD') ?? amount;
    
    const primaryText = formatCurrency(primaryAmount, userCurrency, false);
    const usdText = formatCurrency(usdAmount, 'USD', false);

    if (userCurrency === 'USD') {
        return <span>{primaryText}</span>;
    }

    return (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: '6px', rowGap: '2px' }}>
            <span>{primaryText}</span>
            <span style={{ fontSize: '0.65em', color: 'var(--text-muted)', fontWeight: 'normal', opacity: 0.8, whiteSpace: 'nowrap' }}>
                (~{usdText})
            </span>
        </span>
    );
}
