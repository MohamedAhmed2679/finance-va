/**
 * Zaylo AutoTrack: is this transaction already known?
 *
 *  - exact: the same SMS delivered twice, or re-imported (same fingerprint)
 *  - echo: one payment announced by two senders (the bank AND InstaPay, card AND wallet) within minutes
 *  - manual: the user already typed it in themselves (same amount and currency, close in time)
 * Exact repeats are dropped; echoes and manual matches go to Needs Review, never silently merged.
 */
import type { ParsedMessage } from './parse';

export interface KnownTx { id: string; fingerprint?: string; source: 'autotrack' | 'manual'; amountMinor: number; currency: string; direction: 'debit' | 'credit'; occurredAt: string; senderId?: string; label?: string }
export type DuplicateMatch = { kind: 'exact' | 'echo' | 'manual'; match: KnownTx } | null;

/** Stable, privacy-preserving key for a message (no text is kept in it). */
export async function fingerprint(p: ParsedMessage, rawText: string): Promise<string> {
    const minute = p.occurredAt.slice(0, 16);
    const key = [p.sender?.id ?? 'unknown', p.direction, p.amountMinor, p.currency, p.accountRef ?? '', p.reference ?? minute, normaliseBody(rawText)].join('|');
    const bytes = new TextEncoder().encode(key);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
const normaliseBody = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();

const MINUTE = 60_000;
export function findDuplicate(p: ParsedMessage, fp: string, known: KnownTx[]): DuplicateMatch {
    const exact = known.find(k => k.fingerprint === fp);
    if (exact) return { kind: 'exact', match: exact };
    if (p.amountMinor === null || !p.currency || p.direction === 'unknown') return null;
    const at = new Date(p.occurredAt).getTime();
    const same = (k: KnownTx) => k.amountMinor === p.amountMinor && k.currency === p.currency && k.direction === p.direction;
    const echo = known.find(k => k.source === 'autotrack' && same(k) && k.senderId !== p.sender?.id && Math.abs(new Date(k.occurredAt).getTime() - at) <= 15 * MINUTE);
    if (echo) return { kind: 'echo', match: echo };
    const manual = known.find(k => k.source === 'manual' && same(k) && Math.abs(new Date(k.occurredAt).getTime() - at) <= 36 * 60 * MINUTE);
    if (manual) return { kind: 'manual', match: manual };
    return null;
}
