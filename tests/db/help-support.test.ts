/**
 * v29: support requests, the support-message update lock, consent records and AI feedback.
 * All rows are test fixtures in an in-memory database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
type U = { authId: string; userId: string };
let ana: U, ben: U;
const svc = <T,>(sql: string, p: unknown[] = []) => t.as<T>('service', sql, p);
const openRequest = async (u: U, category = 'account', extra = '') => (await t.as<{ id: string; number: string; status: string }>(u.authId,
    `INSERT INTO public.support_requests (user_id, category, subject ${extra ? ', confidential' : ''}) VALUES ($1, $2, 'Cannot sign in on my phone' ${extra}) RETURNING id, number, status`, [u.userId, category]))[0];

beforeAll(async () => {
    t = await createTestDb();
    expect(t.skipped).toEqual([]);
    ana = await t.signUp('ana@example.test');
    ben = await t.signUp('ben@example.test');
});

describe('support requests', () => {
    it('gives each request a number and starts it open', async () => {
        const a = await openRequest(ana), b = await openRequest(ana);
        expect(Number(a.number)).toBeGreaterThanOrEqual(1001);
        expect(Number(b.number)).toBe(Number(a.number) + 1);
        expect(a.status).toBe('open');
    });
    it('cannot be opened for someone else, or opened already closed', async () => {
        await expect(t.as(ana.authId, `INSERT INTO public.support_requests (user_id, category, subject) VALUES ($1, 'account', 'For Ben')`, [ben.userId])).rejects.toThrow();
        await expect(t.as(ana.authId, `INSERT INTO public.support_requests (user_id, category, subject, status) VALUES ($1, 'account', 'Closed', 'closed')`, [ana.userId])).rejects.toThrow();
    });
    it('is visible only to its owner', async () => {
        const r = await openRequest(ana);
        expect(await t.as(ben.authId, `SELECT id FROM public.support_requests WHERE id = $1`, [r.id])).toEqual([]);
        expect(await t.as(ana.authId, `SELECT id FROM public.support_requests WHERE id = $1`, [r.id])).toHaveLength(1);
    });
    it('cannot be edited directly by its owner', async () => {
        const r = await openRequest(ana);
        const rows = await t.as(ana.authId, `UPDATE public.support_requests SET severity = 'urgent', status = 'resolved' WHERE id = $1 RETURNING id`, [r.id]).catch(() => []);
        expect(rows).toEqual([]);
        expect((await svc<{ severity: string; status: string }>(`SELECT severity, status FROM public.support_requests WHERE id = $1`, [r.id]))[0]).toEqual({ severity: 'normal', status: 'open' });
    });
    it('security categories must be confidential', async () => {
        await expect(openRequest(ana, 'sec_account_compromise')).rejects.toThrow();
        expect((await openRequest(ana, 'sec_account_compromise', ', TRUE')).status).toBe('open');
    });
    it('moves to "waiting on you" when the team replies and back to open when the person answers', async () => {
        const r = await openRequest(ana);
        const status = async () => (await svc<{ status: string }>(`SELECT status FROM public.support_requests WHERE id = $1`, [r.id]))[0].status;
        await t.as(ana.authId, `INSERT INTO public.support_messages (user_id, body, request_id) VALUES ($1, 'Details', $2)`, [ana.userId, r.id]);
        expect(await status()).toBe('open');
        await svc(`INSERT INTO public.support_messages (user_id, body, request_id, from_admin, sender_name) VALUES ($1, 'Try this', $2, TRUE, 'Zaylo team')`, [ana.userId, r.id]);
        expect(await status()).toBe('waiting_on_you');
        await t.as(ana.authId, `INSERT INTO public.support_messages (user_id, body, request_id) VALUES ($1, 'Still broken', $2)`, [ana.userId, r.id]);
        expect(await status()).toBe('open');
    });
    it('can be closed and reopened by its owner only', async () => {
        const r = await openRequest(ana);
        await expect(t.as(ben.authId, `SELECT public.close_support_request($1)`, [r.id])).rejects.toThrow();
        await t.as(ana.authId, `SELECT public.close_support_request($1)`, [r.id]);
        expect((await svc<{ status: string; closed: boolean }>(`SELECT status, closed_at IS NOT NULL AS closed FROM public.support_requests WHERE id = $1`, [r.id]))[0]).toEqual({ status: 'closed', closed: true });
        // no replies on a closed request
        await expect(t.as(ana.authId, `INSERT INTO public.support_messages (user_id, body, request_id) VALUES ($1, 'Hello?', $2)`, [ana.userId, r.id])).rejects.toThrow();
        await expect(t.as(ben.authId, `SELECT public.reopen_support_request($1)`, [r.id])).rejects.toThrow();
        await t.as(ana.authId, `SELECT public.reopen_support_request($1)`, [r.id]);
        expect((await svc<{ status: string }>(`SELECT status FROM public.support_requests WHERE id = $1`, [r.id]))[0].status).toBe('open');
    });
    it('rejects a message attached to another person\'s request', async () => {
        const r = await openRequest(ana);
        await expect(t.as(ben.authId, `INSERT INTO public.support_messages (user_id, body, request_id) VALUES ($1, 'Mine now', $2)`, [ben.userId, r.id])).rejects.toThrow();
    });
});

describe('support messages cannot be forged', () => {
    it('a person cannot turn their own message into a team reply or rewrite it', async () => {
        const [m] = await t.as<{ id: string }>(ana.authId, `INSERT INTO public.support_messages (user_id, body) VALUES ($1, 'My words') RETURNING id`, [ana.userId]);
        await t.as(ana.authId, `UPDATE public.support_messages SET from_admin = TRUE, body = 'We will refund you', sender_name = 'Zaylo team' WHERE id = $1`, [m.id]).catch(() => {});
        expect((await svc<{ from_admin: boolean; body: string }>(`SELECT from_admin, body FROM public.support_messages WHERE id = $1`, [m.id]))[0]).toEqual({ from_admin: false, body: 'My words' });
    });
    it('a person cannot post as the team', async () => {
        await expect(t.as(ana.authId, `INSERT INTO public.support_messages (user_id, body, from_admin) VALUES ($1, 'Official', TRUE)`, [ana.userId])).rejects.toThrow();
    });
    it('a person can still mark a team reply as read, without changing its text', async () => {
        const [m] = await svc<{ id: string }>(`INSERT INTO public.support_messages (user_id, body, from_admin, sender_name) VALUES ($1, 'Reply', TRUE, 'Zaylo team') RETURNING id`, [ana.userId]);
        await t.as(ana.authId, `UPDATE public.support_messages SET read_at = now(), body = 'Edited' WHERE id = $1`, [m.id]);
        expect((await svc<{ read: boolean; body: string }>(`SELECT read_at IS NOT NULL AS read, body FROM public.support_messages WHERE id = $1`, [m.id]))[0]).toEqual({ read: true, body: 'Reply' });
    });
});

describe('consent records', () => {
    it('are append-only and private', async () => {
        await t.as(ana.authId, `INSERT INTO public.consent_events (user_id, purpose, granted, notice_version, provider) VALUES ($1, 'ai_processing', TRUE, '2026-11-10', 'Google Gemini API')`, [ana.userId]);
        await t.as(ana.authId, `INSERT INTO public.consent_events (user_id, purpose, granted, notice_version) VALUES ($1, 'ai_processing', FALSE, '2026-11-10')`, [ana.userId]);
        expect(await t.as(ana.authId, `SELECT granted FROM public.consent_events ORDER BY created_at`)).toHaveLength(2);
        expect(await t.as(ben.authId, `SELECT granted FROM public.consent_events`)).toEqual([]);
        const changed = await t.as(ana.authId, `UPDATE public.consent_events SET granted = TRUE RETURNING id`).catch(() => []);
        const removed = await t.as(ana.authId, `DELETE FROM public.consent_events RETURNING id`).catch(() => []);
        expect([changed, removed]).toEqual([[], []]);
        await expect(t.as(ana.authId, `INSERT INTO public.consent_events (user_id, purpose, granted, notice_version) VALUES ($1, 'ai_processing', TRUE, 'v')`, [ben.userId])).rejects.toThrow();
    });
});

describe('AI feedback', () => {
    it('keeps the answer text only for a report', async () => {
        await t.as(ana.authId, `INSERT INTO public.ai_feedback (user_id, surface, rating) VALUES ($1, 'assistant', 'helpful')`, [ana.userId]);
        await expect(t.as(ana.authId, `INSERT INTO public.ai_feedback (user_id, surface, rating, answer_excerpt) VALUES ($1, 'assistant', 'helpful', 'text')`, [ana.userId])).rejects.toThrow();
        await t.as(ana.authId, `INSERT INTO public.ai_feedback (user_id, surface, rating, reason, answer_excerpt) VALUES ($1, 'assistant', 'reported', 'Wrong total', 'text')`, [ana.userId]);
        expect(await t.as(ben.authId, `SELECT id FROM public.ai_feedback`)).toEqual([]);
    });
});

describe('account deletion still removes everything', () => {
    it('removes requests, consent records and feedback with the account', async () => {
        const gone = await t.signUp('gone@example.test');
        await openRequest(gone);
        await t.as(gone.authId, `INSERT INTO public.consent_events (user_id, purpose, granted, notice_version) VALUES ($1, 'ai_processing', TRUE, 'v')`, [gone.userId]);
        await svc(`DELETE FROM public.users WHERE id = $1`, [gone.userId]);
        for (const table of ['support_requests', 'consent_events', 'ai_feedback']) {
            expect((await svc<{ n: string }>(`SELECT count(*) AS n FROM public.${table} WHERE user_id = $1`, [gone.userId]))[0].n).toBe(0 as unknown as string);
        }
    });
});
