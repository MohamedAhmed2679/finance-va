/**
 * Download only what changed.
 *
 * The first load of a workspace (and once a day after that) downloads everything; in between,
 * only rows whose updated_at moved since the last sync are fetched (soft-deleted rows included, so
 * deletions reach every device). The daily full refresh also catches anything a delta can't see.
 * If the database hasn't got updated_at on a table yet, it quietly falls back to full downloads.
 */
import { supabase, isSupabaseReady } from '../lib/supabase';

export type SyncKind = 'expense' | 'income' | 'bill' | 'goal';
const TABLE: Record<SyncKind, string> = { expense: 'expenses', income: 'incomes', bill: 'monthly_bills', goal: 'savings_goals' };
const KEY = 'zaylo_sync_cursor_v1';
const FULL_EVERY_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 1000;   // a little overlap so clock skew or in-flight writes are never missed

type Cursors = Record<string, Partial<Record<SyncKind | `${SyncKind}_full`, string>>>;
const read = (): Cursors => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (c: Cursors) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full or blocked: next sync is full */ } };

export type Row = Record<string, unknown> & { id: string; updated_at?: string; created_at?: string; is_deleted?: boolean | null };
export interface Changes { mode: 'full' | 'delta'; rows: Row[]; commit: () => void }

/** Rows for one table: everything (mode 'full') or only changes (mode 'delta'). null on failure. Call commit() once merged. */
export async function fetchChanges(workspaceId: string, kind: SyncKind, hasLocalRows: boolean): Promise<Changes | null> {
    if (!isSupabaseReady() || !supabase) return null;
    const all = read();
    const c = all[workspaceId] ?? {};
    const since = c[kind];
    const lastFull = c[`${kind}_full`];
    const delta = hasLocalRows && since && lastFull && Date.now() - Date.parse(lastFull) < FULL_EVERY_MS;

    let q = supabase.from(TABLE[kind]).select('*').eq('workspace_id', workspaceId);
    if (delta) q = q.gt('updated_at', new Date(Date.parse(since!) - OVERLAP_MS).toISOString());
    else q = kind === 'expense' ? q.eq('is_deleted', false) : q.neq('is_deleted', true);
    const { data, error } = await q;
    if (error) {
        // no updated_at column yet (database update not run): fall back to a full download, keep no cursor
        if (delta && /updated_at/.test(error.message)) { clear(workspaceId); return fetchChanges(workspaceId, kind, false); }
        return null;
    }
    const rows = (data ?? []) as Row[];
    const newest = rows.reduce<string | undefined>((m, r) => { const t = r.updated_at ?? r.created_at; return t && (!m || t > m) ? t : m; }, since);
    return {
        mode: delta ? 'delta' : 'full', rows,
        commit: () => {
            const now = read();
            const ws = { ...(now[workspaceId] ?? {}) };
            if (newest && rows.some(r => 'updated_at' in r)) ws[kind] = newest;
            if (!delta) ws[`${kind}_full`] = new Date().toISOString();
            write({ ...now, [workspaceId]: ws });
        },
    };
}

export function clear(workspaceId?: string) {
    if (!workspaceId) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } return; }
    const c = read(); delete c[workspaceId]; write(c);
}
export const SYNC_CURSOR_KEY = KEY;
