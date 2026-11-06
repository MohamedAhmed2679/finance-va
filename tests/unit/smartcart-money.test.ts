import { describe, it, expect } from 'vitest';
import { calculate, lineMinor, parseMoney, parseQty, formatMinor, formatQty } from '../../src/smartcart/money';

const item = (price: number, qty = 1, extra = {}) => ({ unitMinor: Math.round(price * 100), qtyMilli: Math.round(qty * 1000), ...extra });

describe('VAT modes (spec fixtures)', () => {
    it('two units at 100 before VAT, add 14% → 200 / 28 / 228', () => {
        const t = calculate([item(100, 2)], 'add');
        expect([t.subtotal, t.vat, t.total]).toEqual([20000, 2800, 22800]);
    });
    it('one item at 114 already including 14% → before VAT 100, VAT 14, total 114', () => {
        const t = calculate([item(114)], 'included');
        expect([t.beforeVat, t.vat, t.total]).toEqual([10000, 1400, 11400]);
    });
    it('taxable 100 + exempt 50, add 14% → 150 / 14 / 164', () => {
        const t = calculate([item(100), item(50, 1, { vatExempt: true })], 'add');
        expect([t.subtotal, t.vat, t.total, t.exempt]).toEqual([15000, 1400, 16400, 5000]);
    });
    it('before VAT / no VAT added mode shows 200 with no VAT', () => {
        const t = calculate([item(100, 2)], 'none');
        expect([t.subtotal, t.vat, t.total]).toEqual([20000, 0, 20000]);
    });
    it('never adds VAT twice in included mode', () => {
        const t = calculate([item(57), item(57)], 'included');
        expect(t.total).toBe(t.subtotal);
        expect(t.beforeVat + t.vat).toBe(t.total);
    });
    it('exempt items carry no VAT in included mode either', () => {
        const t = calculate([item(114), item(50, 1, { vatExempt: true })], 'included');
        expect([t.vat, t.beforeVat, t.total]).toEqual([1400, 15000, 16400]);
    });
    it('the rate is configurable', () => {
        expect(calculate([item(100)], 'add', 500).vat).toBe(500);
        expect(calculate([item(100)], 'add', 0).total).toBe(10000);
    });
});

describe('decimal-safe rounding', () => {
    it('0.1 + 0.2 style sums are exact', () => {
        const t = calculate([item(0.1), item(0.2)], 'none');
        expect(t.total).toBe(30);
    });
    it('weighed items round half-up per line', () => {
        expect(lineMinor(1999, 725)).toBe(1449); // 19.99 × 0.725 = 14.49275
        expect(lineMinor(1, 500)).toBe(1);       // 0.005 → 0.01 (half-up)
        expect(lineMinor(1, 499)).toBe(0);
    });
    it('lines, subtotal, VAT and total reconcile over many items', () => {
        const items = Array.from({ length: 200 }, (_, n) => ({ unitMinor: 101 + n * 37, qtyMilli: 1000 + (n % 7) * 250, vatExempt: n % 5 === 0 }));
        for (const mode of ['none', 'add', 'included'] as const) {
            const t = calculate(items, mode);
            expect(t.lines.reduce((a, b) => a + b, 0)).toBe(t.subtotal);
            expect(t.taxable + t.exempt).toBe(t.subtotal);
            if (mode === 'add') expect(t.subtotal + t.vat).toBe(t.total);
            if (mode === 'included') expect(t.beforeVat + t.vat).toBe(t.total);
        }
    });
    it('large amounts stay exact', () => {
        const t = calculate([{ unitMinor: 9_999_999_999, qtyMilli: 999_000 }], 'add');
        expect(t.subtotal).toBe(9_989_999_999_001);
        expect(t.vat).toBe(1_398_599_999_860);
    });
});

describe('cart counts and removal', () => {
    it('counts distinct items and total quantity; removed items are excluded at once', () => {
        const items = [item(10, 2), item(5, 0.5), { ...item(99, 3), included: false }];
        const t = calculate(items, 'add');
        expect(t.itemCount).toBe(2);
        expect(t.totalQtyMilli).toBe(2500);
        expect(t.subtotal).toBe(2250);
    });
    it('an empty cart totals zero', () => {
        expect(calculate([], 'add').total).toBe(0);
    });
    it('rejects invalid prices and quantities', () => {
        expect(() => calculate([{ unitMinor: -1, qtyMilli: 1000 }], 'add')).toThrow('invalid_price');
        expect(() => calculate([{ unitMinor: 1.5, qtyMilli: 1000 }], 'add')).toThrow('invalid_price');
        expect(() => calculate([{ unitMinor: 100, qtyMilli: 0 }], 'add')).toThrow('invalid_quantity');
    });
});

describe('parsing typed amounts', () => {
    it.each([
        ['12', 1200], ['12.5', 1250], ['12,50', 1250], ['1,234.50', 123450], ['1.234,50', 123450],
        ['1,234', 123400], ['١٢٫٥', 1250], ['٣٥', 3500], ['0', 0], [' 7.05 ', 705],
    ])('money %s → %d', (s, v) => expect(parseMoney(s)).toBe(v));
    it.each([['', null], ['abc', null], ['-5', null], ['1.234', null], ['12.345', null], ['1e5', null]])('money %s is rejected', (s, v) => expect(parseMoney(s)).toBe(v));
    it('quantities allow 3 decimals', () => {
        expect(parseQty('0.725')).toBe(725);
        expect(parseQty('1,5')).toBe(1500);
        expect(parseQty('2')).toBe(2000);
        expect(parseQty('0.0001')).toBe(null);
    });
    it('formats minor units and quantities', () => {
        expect(formatMinor(123450)).toBe('1,234.50');
        expect(formatMinor(5)).toBe('0.05');
        expect(formatQty(725)).toBe('0.725');
        expect(formatQty(2000)).toBe('2');
    });
});
