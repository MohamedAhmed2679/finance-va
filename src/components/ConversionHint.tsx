import { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { convertAmount, areRatesStale } from '../services/exchangeRates';
import { rateLabel } from '../utils/money';

/** "≈ EGP 485.20 · 1 USD = 48.52 EGP" under an amount entered in another currency. */
export default function ConversionHint({ amount, from, to }: { amount: number | string; from: string; to?: string }) {
    const [rate, setRate] = useState<number | null>(null);
    const [stale, setStale] = useState(false);
    useEffect(() => {
        let alive = true;
        if (!to || from === to) { setRate(null); return; }
        convertAmount(1, from, to).then(r => { if (alive) { setRate(r); setStale(areRatesStale()); } }).catch(() => alive && setRate(null));
        return () => { alive = false; };
    }, [from, to]);
    const n = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (!to || from === to || rate == null) return null;
    const value = isFinite(n) ? n * rate : 0;
    return (
        <div className="fx-hint" role="status">
            <ArrowRightLeft size={13} aria-hidden />
            <span>≈ <strong>{to} {value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
            <span className="fx-rate">{rateLabel(from, to, rate)}{stale ? ' · offline rate' : ''}</span>
        </div>
    );
}
