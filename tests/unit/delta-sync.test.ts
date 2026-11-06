/** Change-only sync: full download first, then only rows changed since the last sync (with overlap), full again daily. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls: { table: string; filters: string[] }[] = [];
let reply: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };
vi.mock('../../src/lib/supabase', () => {
    const builder = (table: string) => {
        const f: string[] = [];
        const b = {
            select: () => b,
            eq: (c: string, v: unknown) => { f.push(`${c}=eq.${v}`); return b; },
            neq: (c: string, v: unknown) => { f.push(`${c}=neq.${v}`); return b; },
            gt: (c: string, v: unknown) => { f.push(`${c}=gt.${v}`); return b; },
            then: (res: (v: typeof reply) => unknown) => { calls.push({ table, filters: f }); return Promise.resolve(reply).then(res); },
        };
        return b;
    };
    return { supabase: { from: builder }, isSupabaseReady: () => true };
});

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
const { fetchChanges, clear } = await import('../../src/services/deltaSync');

beforeEach(() => { calls.length = 0; store.clear(); reply = { data: [], error: null }; vi.useRealTimers(); });

describe('delta sync', () => {
    it('first time: a full download of live rows', async () => {
        reply.data = [{ id: 'a', updated_at: '2026-11-05T10:00:00Z' }, { id: 'b', updated_at: '2026-11-05T12:00:00Z' }];
        const c = await fetchChanges('ws1', 'expense', false);
        expect(c?.mode).toBe('full');
        expect(calls[0].filters).toEqual(['workspace_id=eq.ws1', 'is_deleted=eq.false']);
        c!.commit();
        expect(JSON.parse(store.get('zaylo_sync_cursor_v1')!).ws1.expense).toBe('2026-11-05T12:00:00Z');
    });
    it('next time: only rows changed since the newest one seen (2 minutes of overlap), deleted ones included', async () => {
        reply.data = [{ id: 'b', updated_at: '2026-11-05T12:00:00Z' }];
        (await fetchChanges('ws1', 'expense', false))!.commit();
        reply.data = [{ id: 'c', updated_at: '2026-11-06T09:00:00Z', is_deleted: true }];
        const c = await fetchChanges('ws1', 'expense', true);
        expect(c?.mode).toBe('delta');
        expect(calls[1].filters).toEqual(['workspace_id=eq.ws1', 'updated_at=gt.2026-11-05T11:58:00.000Z']);
        expect(c?.rows[0]).toMatchObject({ id: 'c', is_deleted: true });
    });
    it('without local rows (new device, cleared data) it downloads everything again', async () => {
        reply.data = [{ id: 'b', updated_at: '2026-11-05T12:00:00Z' }];
        (await fetchChanges('ws1', 'income', false))!.commit();
        expect((await fetchChanges('ws1', 'income', false))?.mode).toBe('full');
    });
    it('a full refresh at least once a day', async () => {
        reply.data = [{ id: 'b', updated_at: '2026-11-05T12:00:00Z' }];
        (await fetchChanges('ws1', 'bill', false))!.commit();
        vi.useFakeTimers(); vi.setSystemTime(Date.now() + 25 * 3600_000);
        expect((await fetchChanges('ws1', 'bill', true))?.mode).toBe('full');
    });
    it('nothing is remembered until the merge is committed (a crash means the same changes are fetched again)', async () => {
        reply.data = [{ id: 'b', updated_at: '2026-11-05T12:00:00Z' }];
        await fetchChanges('ws1', 'goal', false);
        expect(store.get('zaylo_sync_cursor_v1')).toBeUndefined();
    });
    it('before the database update (no updated_at) it falls back to full downloads', async () => {
        reply.data = [{ id: 'b', updated_at: '2026-11-05T12:00:00Z' }];
        (await fetchChanges('ws1', 'income', false))!.commit();
        let n = 0;
        reply = { data: null, error: { message: 'column incomes.updated_at does not exist' } };
        const orig = reply;
        Object.defineProperty(reply, 'error', { get: () => (n++ === 0 ? orig.error ?? { message: 'column incomes.updated_at does not exist' } : null) });
        const c = await fetchChanges('ws1', 'income', true);
        expect(c?.mode).toBe('full');
    });
    it('clear() forgets a workspace', async () => {
        reply.data = [{ id: 'b', updated_at: '2026-11-05T12:00:00Z' }];
        (await fetchChanges('ws1', 'expense', false))!.commit();
        clear('ws1');
        expect((await fetchChanges('ws1', 'expense', true))?.mode).toBe('full');
    });
});
