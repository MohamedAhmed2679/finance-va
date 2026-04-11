import { useState, useRef, useEffect } from 'react';
import { CURRENCIES } from '../constants';
import { Search, ChevronDown } from 'lucide-react';

interface CurrencySelectProps {
    value: string;
    onChange: (currency: string) => void;
    label?: string;
    disabled?: boolean;
}

export default function CurrencySelect({ value, onChange, label, disabled }: CurrencySelectProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const selected = CURRENCIES.find(c => c.code === value) || CURRENCIES[0];

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const filtered = CURRENCIES.filter(c => 
        c.code.toLowerCase().includes(search.toLowerCase()) || 
        c.name.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
            {label && <label className="form-label">{label}</label>}
            <button 
                type="button"
                className="form-input" 
                onClick={() => !disabled && setOpen(!open)}
                disabled={disabled}
                style={{ 
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                    cursor: disabled ? 'not-allowed' : 'pointer', background: 'var(--bg-card)',
                    textAlign: 'left'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{selected.flag}</span>
                    <span style={{ fontWeight: 600 }}>{selected.code}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{selected.name}</span>
                </div>
                <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
            </button>

            {open && (
                <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)', zIndex: 50,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
                    maxHeight: 280
                }}>
                    <div style={{ padding: '8px', borderBottom: '1px solid var(--border-default)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', padding: '0 10px' }}>
                            <Search size={14} style={{ color: 'var(--text-muted)' }} />
                            <input 
                                type="text" autoFocus 
                                placeholder="Search currency..." 
                                value={search} onChange={e => setSearch(e.target.value)}
                                style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-primary)', padding: '8px', width: '100%', fontSize: 13 }}
                            />
                        </div>
                    </div>
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                        {filtered.length === 0 ? (
                            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No currencies found</div>
                        ) : (
                            filtered.map(c => (
                                <div 
                                    key={c.code}
                                    onClick={() => { onChange(c.code); setOpen(false); setSearch(''); }}
                                    style={{
                                        padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                                        background: value === c.code ? 'var(--primary-soft)' : 'transparent',
                                        transition: 'background 150ms ease'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                                    onMouseLeave={e => e.currentTarget.style.background = value === c.code ? 'var(--primary-soft)' : 'transparent'}
                                >
                                    <span style={{ fontSize: 18 }}>{c.flag}</span>
                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{c.code}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{c.name}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
