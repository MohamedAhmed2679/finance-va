/**
 * AutoTrack ↔ Supabase, plus an offline outbox.
 *
 * Storing an item is idempotent (UNIQUE user + fingerprint), so retries, several devices and
 * re-imports can never create a second item; posting goes through the autotrack_* functions.
 * When offline, the item (structured fields + redacted excerpt only) waits in local storage
 * and is sent on the next start or when the connection returns.
 */
import { supabase } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { analyse, type IncomingMessage, type ItemDraft, type Outcome, type PipelineContext } from './pipeline';
import type { KnownTx } from './dedupe';
import type { LearnedRule, OwnAccount } from './classify';
import { parseMessage } from './parse';
import { redactForAI } from './redact';

export type ItemStatus = 'needs_review' | 'auto_added' | 'confirmed' | 'linked' | 'ignored' | 'undone' | 'failed';
export interface AutoTrackItem extends Omit<ItemDraft, 'status'> { id: string; status: ItemStatus; final_target: string | null; linked_kind: string | null; linked_id: string | null; fee_expense_id: string | null; error: string | null; decided_at: string | null; created_at: string }
export interface AutoTrackSettings { mode: 'review' | 'auto'; ai_consent: boolean; custom_senders: string[]; last_processed_at: string | null; last_error: string | null }
export const DEFAULT_SETTINGS: AutoTrackSettings = { mode: 'review', ai_consent: false, custom_senders: [], last_processed_at: null, last_error: null };

const OUTBOX = 'zaylo_autotrack_outbox_v1';
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

function db() {
    if (!supabase) throw Object.assign(new Error('You\'re offline.'), { code: 'offline' });
    return supabase;
}
const isOffline = (e: unknown) => (e as { code?: string })?.code === 'offline' || /Failed to fetch|NetworkError|Load failed|ERR_INTERNET|ERR_NETWORK/i.test(String((e as Error)?.message ?? e));

// ─────────────────────────────────────────────────────────────── settings, accounts, rules

export async function loadSettings(): Promise<AutoTrackSettings> {
    const { data, error } = await db().from('autotrack_settings').select('mode, ai_consent, custom_senders, last_processed_at, last_error').maybeSingle();
    if (error) throw error;
    return { ...DEFAULT_SETTINGS, ...(data || {}) };
}
export async function saveSettings(patch: Partial<AutoTrackSettings>) {
    const body: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
    if (patch.ai_consent !== undefined) body.ai_consent_at = patch.ai_consent ? new Date().toISOString() : null;
    const { error } = await db().from('autotrack_settings').upsert(body, { onConflict: 'user_id' });
    if (error) throw error;
}
export async function loadAccounts(): Promise<OwnAccount[]> {
    const { data, error } = await db().from('own_accounts').select('id, label, kind, provider_id, last4').eq('is_deleted', false).order('created_at');
    if (error) throw error;
    return (data || []).map(a => ({ id: a.id, label: a.label, kind: a.kind, last4: a.last4 ?? undefined, senderId: a.provider_id ?? undefined }));
}
export async function addAccount(a: { label: string; kind: OwnAccount['kind']; last4?: string; providerId?: string }) {
    const { data, error } = await db().from('own_accounts').insert({ label: a.label.trim(), kind: a.kind, last4: a.last4 || null, provider_id: a.providerId || null }).select('id').single();
    if (error) throw error;
    return data.id as string;
}
export async function removeAccount(id: string) {
    const { error } = await db().from('own_accounts').update({ is_deleted: true }).eq('id', id);
    if (error) throw error;
}
export async function loadRules(): Promise<(LearnedRule & { id: string })[]> {
    const { data, error } = await db().from('autotrack_rules').select('id, match, target, category').order('created_at');
    if (error) throw error;
    return (data || []).map(r => ({ id: r.id, match: r.match, target: r.target ?? undefined, category: r.category ?? undefined }));
}
export async function saveRule(r: LearnedRule) {
    const { error } = await db().from('autotrack_rules').upsert({ match: r.match.trim(), target: r.target ?? null, category: r.category ?? null }, { onConflict: 'user_id,match' });
    if (error) throw error;
}
export async function removeRule(id: string) {
    const { error } = await db().from('autotrack_rules').delete().eq('id', id);
    if (error) throw error;
}

// ─────────────────────────────────────────────────────────────── items

export async function loadItems(): Promise<AutoTrackItem[]> {
    const { data, error } = await db().from('autotrack_items').select('*').order('received_at', { ascending: false }).limit(300);
    if (error) throw error;
    return (data || []).map(r => ({ ...r, amount: r.amount === null ? null : Number(r.amount), fee: r.fee === null ? null : Number(r.fee), balance_after: r.balance_after === null ? null : Number(r.balance_after) })) as AutoTrackItem[];
}

/** Records the app already has, for duplicate and refund matching. */
export function knownFromStore(items: AutoTrackItem[]): KnownTx[] {
    const s = useStore.getState();
    const minor = (n: number) => Math.round(n * 100);
    const out: KnownTx[] = [];
    for (const e of s.expenses) if (!e.deleted && e.workspaceId === s.activeWorkspaceId) out.push({ id: e.id, kind: 'expense', source: 'manual', amountMinor: minor(e.amount), currency: e.currency, direction: 'debit', occurredAt: e.purchaseAt, label: e.merchant });
    for (const i of s.incomes) if (i.workspaceId === s.activeWorkspaceId) out.push({ id: i.id, kind: 'income', source: 'manual', amountMinor: minor(i.amount), currency: i.currency, direction: 'credit', occurredAt: i.date, label: i.name });
    for (const it of items) if (it.amount !== null && it.currency && it.direction !== 'unknown') out.push({ id: it.id, fingerprint: it.fingerprint, source: 'autotrack', amountMinor: minor(it.amount), currency: it.currency, direction: it.direction, occurredAt: it.occurred_at, senderId: it.provider_id ?? undefined, label: it.counterparty ?? it.provider_name ?? undefined });
    // records AutoTrack itself created are already represented by their item
    const created = new Set(items.map(i => i.linked_id).filter(Boolean));
    return out.filter(k => k.source === 'autotrack' || !created.has(k.id));
}

// ─────────────────────────────────────────────────────────────── outbox

const readOutbox = (): ItemDraft[] => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { return []; } };
const writeOutbox = (l: ItemDraft[]) => { try { if (l.length) localStorage.setItem(OUTBOX, JSON.stringify(l.slice(-200))); else localStorage.removeItem(OUTBOX); } catch { /* storage blocked */ } };
export const pendingCount = () => readOutbox().length;

/** Insert (idempotent). Returns the item id, or null if this alert already exists. */
async function store(draft: ItemDraft): Promise<string | null> {
    const { data, error } = await db().from('autotrack_items').upsert(draft, { onConflict: 'user_id,fingerprint', ignoreDuplicates: true }).select('id');
    if (error) throw error;
    return data?.[0]?.id ?? null;
}

/** Sends everything waiting offline. Safe to call any time. */
export async function flushOutbox(): Promise<number> {
    const list = readOutbox();
    if (!list.length || !supabase) return 0;
    let sent = 0;
    const left: ItemDraft[] = [];
    for (const d of list) {
        try { await store(d); sent++; }
        catch (e) {
            if (isOffline(e)) left.push(d);
            else await saveSettings({ last_error: `An alert couldn't be saved: ${(e as Error).message}` }).catch(() => {}); // a rejected item won't succeed on retry
        }
    }
    writeOutbox(left);
    if (sent) await saveSettings({ last_processed_at: new Date().toISOString(), last_error: null }).catch(() => {});
    return sent;
}

// ─────────────────────────────────────────────────────────────── the whole flow

export interface ProcessResult { outcome: Outcome['outcome'] | 'queued' | 'auto_added' | 'failed'; message: string; itemId?: string; postedId?: string; draft?: ItemDraft }

/** Optional: Zaylo AI reads a message the rules couldn't, after a separate consent. Codes are never sent. */
async function aiRead(text: string, sender: string | null | undefined, receivedAt: Date) {
    const first = parseMessage(text, sender, receivedAt);
    if (first.kind !== 'other') return null;                 // read fine, or a code/advert/balance: never sent to AI
    if (!/\d/.test(text) || !/(egp|جنيه|usd|\$|€|ج\.م|le\b|debit|credit|خصم|إيداع|ايداع|تحويل|transfer|paid|received)/i.test(text)) return null;
    // AutoTrack runs in the background, so it never asks: without the AI permission it simply doesn't use AI.
    const { hasAiConsent } = await import('../services/aiConsent');
    if (!hasAiConsent()) return null;
    const { data } = (await supabase?.auth.getSession()) || { data: { session: null } };
    if (!data.session) return null;
    const res = await fetch(`${API_BASE}/api/ai/zaylo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ action: 'sms_extract', text: redactForAI(text), sender: sender ?? '', receivedAt: receivedAt.toISOString() }),
    });
    if (!res.ok) return null;
    const out = await res.json().catch(() => null);
    return out?.parsed ?? null;
}

/**
 * The whole flow for one message. `allowAuto: false` keeps the result in Needs Review whatever the
 * settings (used for links from outside the app, which anyone could craft).
 */
export async function processMessage(msg: IncomingMessage, opts: { items?: AutoTrackItem[]; allowAuto?: boolean } = {}): Promise<ProcessResult> {
    const s = useStore.getState();
    if (!s.activeWorkspaceId || !s.user) return { outcome: 'failed', message: 'Sign in first.' };
    let settings = DEFAULT_SETTINGS, accounts: OwnAccount[] = [], rules: LearnedRule[] = [], items = opts.items ?? [];
    try {
        [settings, accounts, rules, items] = await Promise.all([loadSettings(), loadAccounts(), loadRules(), opts.items ? Promise.resolve(opts.items) : loadItems()]);
    } catch (e) { if (!isOffline(e)) throw e; }

    const receivedAt = msg.receivedAt ?? new Date();
    const aiParsed = settings.ai_consent ? await aiRead(msg.text, msg.sender, receivedAt).catch(() => null) : null;
    const ctx: PipelineContext = {
        workspaceId: s.activeWorkspaceId, ownAccounts: accounts, ownNames: [s.user.name].filter(Boolean), rules,
        known: knownFromStore(items), customSenders: settings.custom_senders, aiParsed,
    };
    const result = await analyse({ ...msg, receivedAt }, ctx);
    if (result.outcome === 'not_financial') return { outcome: 'not_financial', message: result.why };
    if (result.outcome === 'duplicate') return { outcome: 'duplicate', message: 'Already recorded: this alert was handled before.' };

    let id: string | null;
    try { id = await store(result.draft); }
    catch (e) {
        if (isOffline(e)) { writeOutbox([...readOutbox().filter(d => d.fingerprint !== result.draft.fingerprint), result.draft]); return { outcome: 'queued', message: 'Saved on this device; it will sync when you\'re online.', draft: result.draft }; }
        await saveSettings({ last_error: 'Couldn\'t save the last alert. It will be tried again.' }).catch(() => {});
        return { outcome: 'failed', message: (e as Error).message || 'Couldn\'t save this alert.' };
    }
    await saveSettings({ last_processed_at: new Date().toISOString(), last_error: null }).catch(() => {});
    if (!id) return { outcome: 'duplicate', message: 'Already recorded: this alert was handled before.' };

    if (opts.allowAuto !== false && msg.ingestion !== 'ios_shortcut' && settings.mode === 'auto' && result.autoEligible && result.classification.target !== 'review' && result.classification.target !== 'ignore') {
        const { data, error } = await db().rpc('autotrack_post', { p_item: id, p_target: result.classification.target, p_auto: true });
        if (!error) return { outcome: 'auto_added', message: `Added by AutoTrack to ${result.classification.target === 'income' ? 'Income & Earnings' : result.classification.target === 'expense' ? 'Expenses' : 'Transfers'}.`, itemId: id, postedId: (data as { id?: string })?.id, draft: result.draft };
    }
    return {
        outcome: 'stored', itemId: id, draft: result.draft,
        message: result.draft.status === 'ignored' ? `Not recorded: ${result.classification.reason}` : 'Added to Needs Review.',
    };
}

// ─────────────────────────────────────────────────────────────── review actions

type Rpc = 'autotrack_post' | 'autotrack_undo' | 'autotrack_link' | 'autotrack_ignore' | 'autotrack_restore' | 'autotrack_delete_imported';
async function rpc<T = Record<string, unknown>>(name: Rpc, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db().rpc(name, args);
    if (error) throw new Error(error.message.replace(/^autotrack:\s*/, ''));
    return data as T;
}
export const confirmItem = (id: string, target: 'income' | 'expense' | 'transfer', edits: { amount?: number; currency?: string; occurredAt?: string; category?: string; title?: string; from?: string | null; to?: string | null } = {}) =>
    rpc<{ kind: string; id: string; already: boolean }>('autotrack_post', {
        p_item: id, p_target: target, p_auto: false, p_amount: edits.amount ?? null, p_currency: edits.currency ?? null, p_occurred_at: edits.occurredAt ?? null,
        p_category: edits.category ?? null, p_title: edits.title ?? null, p_from: edits.from ?? null, p_to: edits.to ?? null,
    });
export const undoItem = (id: string) => rpc('autotrack_undo', { p_item: id });
export const ignoreItem = (id: string) => rpc('autotrack_ignore', { p_item: id });
export const restoreItem = (id: string) => rpc('autotrack_restore', { p_item: id });
export const linkItem = (id: string, kind: 'expense' | 'income' | 'transfer', recordId: string) => rpc('autotrack_link', { p_item: id, p_kind: kind, p_record: recordId });
export const deleteImported = (alsoRecords: boolean) => rpc<{ items: number; recordsRemoved: number }>('autotrack_delete_imported', { p_records: alsoRecords });

// ─────────────────────────────────────────────────────────────── transfers list

export interface Transfer { id: string; amount: number; currency: string; from_label: string | null; to_label: string | null; occurred_at: string; note: string; source: string }
export async function loadTransfers(workspaceId: string): Promise<Transfer[]> {
    const { data, error } = await db().from('transfers').select('id, amount, currency, from_label, to_label, occurred_at, note, source').eq('workspace_id', workspaceId).eq('is_deleted', false).order('occurred_at', { ascending: false }).limit(200);
    if (error) throw error;
    return (data || []).map(t => ({ ...t, amount: Number(t.amount) })) as Transfer[];
}
export async function addTransfer(workspaceId: string, t: { amount: number; currency: string; from?: OwnAccount; to?: OwnAccount; occurredAt: string; note?: string }) {
    const { error } = await db().from('transfers').insert({
        workspace_id: workspaceId, amount: t.amount, currency: t.currency, from_account_id: t.from?.id ?? null, to_account_id: t.to?.id ?? null,
        from_label: t.from?.label ?? null, to_label: t.to?.label ?? null, occurred_at: t.occurredAt, note: t.note ?? '', source: 'manual',
    });
    if (error) throw error;
}
export async function deleteTransfer(id: string) {
    const { error } = await db().from('transfers').update({ is_deleted: true }).eq('id', id);
    if (error) throw error;
}
