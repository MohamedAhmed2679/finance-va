/**
 * Outbox: every change to money data is written here first, then sent to Supabase.
 * A change leaves the outbox only after the cloud confirms it, so nothing is lost
 * when the network drops, a write fails, or the user signs out before it synced.
 *
 * Stored in localStorage under its own key (not the app store), so signing out —
 * which clears the app store — never drops pending changes. Entries carry the
 * owner's id and only that user's session sends them.
 */
import {
    syncExpenseToCloud, deleteExpenseFromCloud, syncIncomeToCloud, deleteIncomeFromCloud,
    syncBillToCloud, deleteBillFromCloud, syncSavingsGoalToCloud, deleteSavingsGoalFromCloud,
    syncWorkspaceToCloud,
} from './supabaseSync';

export type OutboxKind = 'expense' | 'income' | 'bill' | 'goal' | 'workspace';
export interface OutboxEntry {
    key: string;              // kind:id — a newer change to the same row replaces the older one
    kind: OutboxKind;
    op: 'upsert' | 'delete';
    id: string;
    workspaceId?: string;
    owner: string;            // users.id of who made the change
    payload?: Payload;
    at: number;
    tries: number;
    lastError?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the stored expense/income/bill/goal/workspace, handed to its own sender
type Payload = any;

const KEY = 'zaylo_outbox_v1';
const listeners = new Set<(n: number) => void>();
let flushing: Promise<void> | null = null;
let currentOwner = '';

function read(): OutboxEntry[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list: OutboxEntry[]) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full: changes still try to send */ }
    const mine = list.filter(e => e.owner === currentOwner).length;
    listeners.forEach(l => l(mine));
}

const SENDERS: Record<OutboxKind, { upsert: (p: Payload) => Promise<unknown>; delete?: (id: string) => Promise<unknown> }> = {
    expense: { upsert: syncExpenseToCloud, delete: deleteExpenseFromCloud },
    income: { upsert: syncIncomeToCloud, delete: deleteIncomeFromCloud },
    bill: { upsert: syncBillToCloud, delete: deleteBillFromCloud },
    goal: { upsert: syncSavingsGoalToCloud, delete: deleteSavingsGoalFromCloud },
    workspace: { upsert: syncWorkspaceToCloud },
};

/** Who is signed in; only their pending changes are sent. */
export function setOutboxOwner(owner: string) {
    currentOwner = owner || '';
    write(read());
    if (currentOwner) flushOutbox().catch(() => {});
}

export function onOutboxChange(fn: (pending: number) => void) {
    listeners.add(fn);
    fn(pendingFor(currentOwner).length);
    return () => { listeners.delete(fn); };
}

export function pendingFor(owner = currentOwner) { return read().filter(e => e.owner === owner); }

/** Ids with unsent changes, so a cloud refresh doesn't overwrite them. */
export function pendingIds(kind: OutboxKind, workspaceId?: string) {
    return new Set(pendingFor().filter(e => e.kind === kind && (!workspaceId || e.workspaceId === workspaceId)).map(e => e.id));
}

/** Unsent changes for one workspace: the latest version of each edited row, and deleted ids. */
export function pendingChanges<T>(kind: OutboxKind, workspaceId: string) {
    const mine = pendingFor().filter(e => e.kind === kind);
    return {
        rows: mine.filter(e => e.op === 'upsert' && e.workspaceId === workspaceId).map(e => e.payload as T),
        deleted: new Set(mine.filter(e => e.op === 'delete').map(e => e.id)),
    };
}

/** Record a change and try to send it now. Resolves when sent; rejects (entry kept) when not. */
export function enqueue(kind: OutboxKind, op: 'upsert' | 'delete', id: string, payload?: Payload, owner = currentOwner): Promise<void> {
    const entry: OutboxEntry = { key: `${kind}:${id}`, kind, op, id, workspaceId: payload?.workspaceId, owner, payload, at: Date.now(), tries: 0 };
    const list = read().filter(e => e.key !== entry.key);
    list.push(entry);
    write(list);
    return send(entry);
}

async function send(entry: OutboxEntry): Promise<void> {
    const s = SENDERS[entry.kind];
    try {
        if (entry.op === 'delete') await s.delete?.(entry.id);
        else await s.upsert(entry.payload);
        // Remove only if no newer change to the same row arrived meanwhile
        write(read().filter(e => !(e.key === entry.key && e.at === entry.at)));
    } catch (err) {
        write(read().map(e => (e.key === entry.key && e.at === entry.at ? { ...e, tries: e.tries + 1, lastError: (err as Error)?.message } : e)));
        throw err;
    }
}

/** Send everything waiting for the signed-in user, oldest first. */
export function flushOutbox(): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
        const order: OutboxKind[] = ['workspace', 'expense', 'income', 'bill', 'goal'];
        const mine = pendingFor().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.at - b.at);
        for (const e of mine) {
            try { await send(e); } catch { /* keep it for next time */ }
        }
    })().finally(() => { flushing = null; });
    return flushing;
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { flushOutbox().catch(() => {}); });
    setInterval(() => { if (currentOwner && pendingFor().length && navigator.onLine !== false) flushOutbox().catch(() => {}); }, 30_000);
}
