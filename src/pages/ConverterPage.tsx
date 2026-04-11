import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { CURRENCIES } from '../constants';
import { ArrowLeftRight, RefreshCw, TrendingUp } from 'lucide-react';
import CurrencySelect from '../components/CurrencySelect';

const OPEN_EXCHANGE_URL = 'https://api.exchangerate-api.com/v4/latest/';

export default function ConverterPage() {
    const { user } = useStore();
    const lang = user?.language ?? 'en';
    const [amount, setAmount] = useState('1');
    const [fromCur, setFromCur] = useState(user?.defaultCurrency ?? 'USD');
    const [toCur, setToCur] = useState('EUR');
    const [result, setResult] = useState<number | null>(null);
    const [rate, setRate] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [lastUpdate, setLastUpdate] = useState('');
    const [allRates, setAllRates] = useState<Record<string, number>>({});

    async function fetchRates(base: string) {
        try {
            const res = await fetch(`${OPEN_EXCHANGE_URL}${base}`);
            const data = await res.json();
            if (data.rates) { setAllRates(data.rates); setLastUpdate(new Date().toLocaleTimeString()); return data.rates; }
        } catch {
            // fallback mock rates
            const fallback: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 149.5, CAD: 1.36, AUD: 1.53, CNY: 7.24, INR: 83.1, EGP: 48.5, AED: 3.67, SAR: 3.75, KWD: 0.31, QAR: 3.64, BHD: 0.38, OMR: 0.38, JOD: 0.71, LBP: 89500, MAD: 10.0, TND: 3.13, DZD: 134.5 };
            setAllRates(fallback);
            setLastUpdate('Cached rates');
            return fallback;
        }
        return {};
    }

    async function handleConvert() {
        if (!amount || isNaN(parseFloat(amount))) return;
        setLoading(true); setError('');
        try {
            const rates = Object.keys(allRates).length ? allRates : await fetchRates(fromCur);
            let r = rates[toCur];
            if (fromCur !== 'USD' && rates[fromCur]) r = rates[toCur] / rates[fromCur];
            if (!r) throw new Error('Rate not available');
            setRate(r);
            setResult(parseFloat(amount) * r);
        } catch (e) { setError('Unable to fetch rates. Using cached data.'); }
        setLoading(false);
    }

    function swap() { const tmp = fromCur; setFromCur(toCur); setToCur(tmp); setResult(null); setRate(null); }

    useEffect(() => { fetchRates('USD'); }, []);

    // Auto-convert on input change
    useEffect(() => {
        const timer = setTimeout(() => {
            if (amount && !isNaN(parseFloat(amount))) {
                handleConvert();
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [amount, fromCur, toCur, allRates]);

    const popularPairs = [
        { from: 'USD', to: 'EUR' }, { from: 'USD', to: 'GBP' }, { from: 'USD', to: 'JPY' },
        { from: 'EUR', to: 'USD' }, { from: 'GBP', to: 'USD' }, { from: 'USD', to: 'EGP' },
        { from: 'USD', to: 'AED' }, { from: 'USD', to: 'SAR' }, { from: 'USD', to: 'INR' },
    ];

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'currency_converter')}</h1>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Real-time exchange rates {lastUpdate && `· Updated ${lastUpdate}`}</p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => fetchRates('USD')}><RefreshCw size={14} /> Refresh</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
                {/* Main converter */}
                <div className="card">
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Real-Time Converter</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>Get up-to-date exchange rates powered by ExchangeRate API</div>

                    <div className="form-group">
                        <label className="form-label">Amount</label>
                        <div className="input-with-icon">
                            <span className="input-icon" style={{ fontSize: 14, fontWeight: 600 }}>
                                {CURRENCIES.find(c => c.code === fromCur)?.symbol ?? '$'}
                            </span>
                            <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} placeholder="1" min="0" step="any" />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', marginBottom: 24 }}>
                        <CurrencySelect label={t(lang, 'from')} value={fromCur} onChange={setFromCur} />
                        <button onClick={swap} className="btn btn-ghost btn-icon" style={{ border: '1px solid var(--border-default)', marginTop: 24 }}>
                            <ArrowLeftRight size={18} />
                        </button>
                        <CurrencySelect label={t(lang, 'to')} value={toCur} onChange={setToCur} />
                    </div>

                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleConvert} disabled={loading}>
                        {loading ? <><RefreshCw size={16} className="animate-spin" />Converting…</> : <><ArrowLeftRight size={16} />{t(lang, 'convert')}</>}
                    </button>

                    {error && <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--warning-soft)', borderRadius: 8, fontSize: 13, color: 'var(--warning)' }}>{error}</div>}

                    {result !== null && (
                        <div className="animate-slideUp" style={{ marginTop: 24, padding: 24, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{amount} {fromCur} =</div>
                            <div className="amount" style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1.5px', color: 'var(--accent)', marginBottom: 8 }}>
                                {result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {toCur}
                            </div>
                            {rate && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>1 {fromCur} = {rate.toFixed(4)} {toCur}</div>}
                        </div>
                    )}
                </div>

                {/* Popular pairs */}
                <div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TrendingUp size={16} style={{ color: 'var(--primary-light)' }} /> Popular Pairs
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                        {popularPairs.map(pair => {
                            const r = allRates[pair.to] && allRates[pair.from] ? allRates[pair.to] / allRates[pair.from] : null;
                            return (
                                <div key={`${pair.from}-${pair.to}`} className="card card-sm" style={{ cursor: 'pointer', transition: 'all 200ms' }}
                                    onClick={() => { setFromCur(pair.from); setToCur(pair.to); setResult(null); }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ fontWeight: 600, fontSize: 13 }}>{pair.from} → {pair.to}</div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary-light)' }}>
                                            {r ? r.toFixed(4) : '…'}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                        {CURRENCIES.find(c => c.code === pair.from)?.name} → {CURRENCIES.find(c => c.code === pair.to)?.name}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
