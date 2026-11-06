/**
 * Zaylo AutoTrack pipeline. Four separate steps, each testable on its own:
 *
 *   ingest   (adapters: Android receiver, iPhone Shortcut, paste, share, Ask Zaylo, history)
 *     → parse     (parse.ts: deterministic, on the device)
 *     → classify  (classify.ts: meaning, not direction)
 *     → reconcile (dedupe.ts: exact repeats, echoes, matches with existing records)
 *     → store     (one autotrack_items row; structured fields + a redacted excerpt, never the whole SMS)
 *     → post      (only Confirm, or auto-add when the user chose it and every rule passes)
 *
 * Messages that aren't transactions (personal texts, codes, adverts, balance notices) stop at
 * parse and are not stored anywhere.
 */
import { parseMessage, type ParsedMessage } from './parse';
import { classify, type Classification, type ClassifyContext } from './classify';
import { fingerprint, findDuplicate, type DuplicateMatch, type KnownTx } from './dedupe';
import { redactExcerpt } from './redact';
import { lookupSender } from './senders';

export const PARSER_VERSION = 'sms-1.0';
export type Ingestion = 'android' | 'ios_shortcut' | 'paste' | 'share' | 'history' | 'assistant';

export interface IncomingMessage { text: string; sender?: string | null; receivedAt?: Date; ingestion: Ingestion }

export interface ItemDraft {
    workspace_id: string; fingerprint: string; status: 'needs_review' | 'ignored';
    suggested_target: Classification['target']; direction: ParsedMessage['direction']; channel: string; tx_status: ParsedMessage['status'];
    amount: number | null; currency: string | null; fee: number | null; balance_after: number | null;
    counterparty: string | null; provider_id: string | null; provider_name: string | null;
    account_ref: string | null; counterparty_ref: string | null; reference: string | null;
    occurred_at: string; occurred_at_from_text: boolean; received_at: string;
    category: string | null; from_account_id: string | null; to_account_id: string | null;
    reason: string; issues: string[]; confidence: number; parser_version: string; ingestion: Ingestion; ai_used: boolean; excerpt: string;
    duplicate_of_kind: 'expense' | 'income' | 'transfer' | 'autotrack' | null; duplicate_of_id: string | null;
}

export type Outcome =
    | { outcome: 'not_financial'; why: string }                                  // nothing stored
    | { outcome: 'duplicate'; match: NonNullable<DuplicateMatch> }               // the same alert was already handled
    | { outcome: 'stored'; draft: ItemDraft; classification: Classification; parsed: ParsedMessage; autoEligible: boolean; possibleMatch: DuplicateMatch };

export interface PipelineContext extends ClassifyContext {
    workspaceId: string;
    known: KnownTx[];
    customSenders: string[];
    /** Structured result from Zaylo AI for a message the rules couldn't read (only with consent). */
    aiParsed?: ParsedMessage | null;
}

const toMajor = (minor: number | null) => (minor === null ? null : minor / 100);

/** Steps 1–4: everything except talking to the server. Pure apart from hashing. */
export async function analyse(msg: IncomingMessage, ctx: PipelineContext): Promise<Outcome> {
    const receivedAt = msg.receivedAt ?? new Date();
    const extra = ctx.customSenders.map(id => ({ id, name: id, kind: 'bank' as const, currency: 'EGP' }));
    let parsed = parseMessage(msg.text, msg.sender, receivedAt);
    if (!parsed.sender && msg.sender) parsed = { ...parsed, sender: lookupSender(msg.sender, extra) };
    let aiUsed = false;
    if (ctx.aiParsed && parsed.kind === 'other') { parsed = ctx.aiParsed; aiUsed = true; }

    if (parsed.kind !== 'transaction') {
        const why = parsed.kind === 'otp' ? 'Security code: not stored.' : parsed.kind === 'promo' ? 'Advert: not stored.'
            : parsed.kind === 'balance' ? 'Balance notice only: no transaction.' : 'Not a transaction message.';
        return { outcome: 'not_financial', why };
    }
    const c = classify(parsed, ctx);
    const fp = await fingerprint(parsed, msg.text);
    const dup = findDuplicate(parsed, fp, ctx.known);
    if (dup?.kind === 'exact') return { outcome: 'duplicate', match: dup };

    // Refunds: point at the purchase they reverse when there is a clear match
    let possibleMatch: DuplicateMatch = dup;
    if (!possibleMatch && c.target === 'review' && (parsed.channel === 'refund' || parsed.status === 'reversed') && parsed.amountMinor) {
        const original = ctx.known.find(k => k.direction === 'debit' && k.amountMinor === parsed.amountMinor && k.currency === parsed.currency
            && new Date(k.occurredAt) <= new Date(parsed.occurredAt) && Date.now() - new Date(k.occurredAt).getTime() < 90 * 86_400_000);
        if (original) possibleMatch = { kind: 'manual', match: original };
    }

    const reason = dup?.kind === 'echo' ? `Looks like the same transaction another alert already reported (${dup.match.label ?? 'earlier alert'}).`
        : dup?.kind === 'manual' ? `You may have recorded this already${dup.match.label ? ` ("${dup.match.label}")` : ''}. Link it instead of adding it again?`
        : aiUsed ? `Read by Zaylo AI because the message format isn't one Zaylo knows. ${c.reason}`
        : c.reason;
    const target = dup ? 'review' : c.target;
    const ignored = target === 'ignore';
    const draft: ItemDraft = {
        workspace_id: ctx.workspaceId, fingerprint: fp, status: ignored ? 'ignored' : 'needs_review',
        suggested_target: c.target, direction: parsed.direction, channel: parsed.channel, tx_status: parsed.status,
        amount: toMajor(parsed.amountMinor), currency: parsed.currency, fee: toMajor(parsed.feeMinor), balance_after: toMajor(parsed.balanceAfterMinor),
        counterparty: parsed.counterparty?.slice(0, 80) ?? null, provider_id: parsed.sender?.id ?? null, provider_name: parsed.sender?.name ?? null,
        account_ref: parsed.accountRef, counterparty_ref: parsed.counterpartyRef, reference: parsed.reference,
        occurred_at: parsed.occurredAt, occurred_at_from_text: parsed.occurredAtFromText, received_at: receivedAt.toISOString(),
        category: c.target === 'expense' || c.target === 'review' ? c.category : null,
        from_account_id: c.fromAccountId ?? null, to_account_id: c.toAccountId ?? null,
        reason, issues: parsed.issues, confidence: parsed.confidence, parser_version: PARSER_VERSION, ingestion: msg.ingestion, ai_used: aiUsed,
        excerpt: redactExcerpt(msg.text),
        duplicate_of_kind: possibleMatch ? (possibleMatch.match.source === 'autotrack' ? 'autotrack' : (possibleMatch.match.kind ?? 'expense')) : null,
        duplicate_of_id: possibleMatch?.match.id ?? null,
    };
    const autoEligible = c.autoEligible && !dup && !aiUsed && !ignored
        && (c.target !== 'transfer' || Boolean(c.fromAccountId || c.toAccountId));
    return { outcome: 'stored', draft, classification: c, parsed, autoEligible, possibleMatch };
}
