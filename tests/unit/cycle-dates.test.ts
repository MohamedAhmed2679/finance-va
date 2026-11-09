import { describe, it, expect } from 'vitest';
import '../../src/store/useStore';   // load order: the store imports constants
import { getActiveCycleDates } from '../../src/constants';

describe('salary-day cycles', () => {
    it('day 1 is the calendar month', () => {
        expect(getActiveCycleDates(new Date(2026, 10, 9), 1)).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    });
    it('before payday you are still in last month\'s cycle', () => {
        expect(getActiveCycleDates(new Date(2026, 10, 9), 25)).toEqual({ start: '2026-10-25', end: '2026-11-24' });
        expect(getActiveCycleDates(new Date(2026, 10, 25), 25)).toEqual({ start: '2026-11-25', end: '2026-12-24' });
    });
    it('payday on the 31st falls on the last day of shorter months', () => {
        expect(getActiveCycleDates(new Date(2026, 10, 30), 31)).toEqual({ start: '2026-11-30', end: '2026-12-30' });
        expect(getActiveCycleDates(new Date(2026, 10, 9), 31)).toEqual({ start: '2026-10-31', end: '2026-11-29' });
        expect(getActiveCycleDates(new Date(2027, 1, 28), 30)).toEqual({ start: '2027-02-28', end: '2027-03-29' });
    });
    it('crosses the year', () => {
        expect(getActiveCycleDates(new Date(2027, 0, 10), 25)).toEqual({ start: '2026-12-25', end: '2027-01-24' });
    });
});
