/**
 * v30: account deletion covers Help and AI records; database-backed rate limits.
 * All rows are test fixtures in an in-memory database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
type U = { authId: string; userId: string };
let ana: U, ben: U, cat: U;
const svc = <T,>(sql: string, p: unknown[] = []) => t.as<T>('service', sql, p);
const count = async (from: string, p: unknown[] = []) => Number((await svc<{ n: string }>(`SELECT count(*) AS n FROM ${from}`, p))[0].n);
const open = (u: U, subject = 'Fixture request') => t.as(u.authId, `INSERT INTO public.support_requests (user_id, category, subject) VALUES ($1, 'account', $2)`, [u.userId, subject]);

beforeAll(async () => {
    t = await createTestDb();
    expect(t.skipped).toEqual([]);
    ana = await t.signUp('ana@example.test');
    ben = await t.signUp('ben@example.test');
    cat = await t.signUp('cat@example.test');
});

describe('Zaylo AI rate limit', () => {
    it('allows 60 calls in 10 minutes, then refuses, for that person only', async () => {
        for (let i = 0; i < 60; i++) expect((await t.as<{ ok: boolean }>(ana.authId, 'SELECT public.ai_rate_ok() AS ok'))[0].ok).toBe(true);
        expect((await t.as<{ ok: boolean }>(ana.authId, 'SELECT public.ai_rate_ok() AS ok'))[0].ok).toBe(false);
        expect((await t.as<{ ok: boolean }>(ben.authId, 'SELECT public.ai_rate_ok() AS ok'))[0].ok).toBe(true);
        expect(await count('public.rate_events WHERE user_id = $1', [ana.userId])).toBe(60);
    });
    it('allows calls again once the window has passed', async () => {
        await svc(`UPDATE public.rate_events SET created_at = now() - interval '11 minutes' WHERE user_id = $1`, [ana.userId]);
        expect((await t.as<{ ok: boolean }>(ana.authId, 'SELECT public.ai_rate_ok() AS ok'))[0].ok).toBe(true);
    });
    it('cannot be read, cleared or filled in directly', async () => {
        const before = await count('public.rate_events WHERE user_id = $1', [ana.userId]);
        expect(await t.as(ana.authId, 'SELECT * FROM public.rate_events').catch(() => [])).toEqual([]);
        await t.as(ana.authId, 'DELETE FROM public.rate_events').catch(() => {});
        expect(await count('public.rate_events WHERE user_id = $1', [ana.userId])).toBe(before);
        await expect(t.as(ana.authId, `INSERT INTO public.rate_events (user_id, kind) VALUES ($1, 'ai')`, [ben.userId])).rejects.toThrow();
    });
    it('refuses someone who is not signed in', async () => {
        await expect(t.as('anon', 'SELECT public.ai_rate_ok() AS ok')).rejects.toThrow();
    });
});

describe('support request rate limit', () => {
    it('allows 10 requests an hour, then refuses', async () => {
        for (let i = 0; i < 10; i++) await open(cat, `Fixture ${i}`);
        await expect(open(cat, 'One too many')).rejects.toThrow(/too many requests/);
        await open(ben);   // other people are not affected
    });
    it('allows more once the hour has passed, up to 30 a day', async () => {
        await svc(`UPDATE public.support_requests SET created_at = now() - interval '2 hours' WHERE user_id = $1`, [cat.userId]);
        for (let i = 0; i < 10; i++) await open(cat, `Later ${i}`);
        await svc(`UPDATE public.support_requests SET created_at = now() - interval '2 hours' WHERE user_id = $1`, [cat.userId]);
        for (let i = 0; i < 10; i++) await open(cat, `Evening ${i}`);
        await svc(`UPDATE public.support_requests SET created_at = now() - interval '2 hours' WHERE user_id = $1`, [cat.userId]);
        await expect(open(cat, 'Thirty-first today')).rejects.toThrow(/too many requests/);
    });
});

describe('deleting an account that leaves a placeholder behind', () => {
    it('removes support requests, their messages, AI permission records, AI feedback and rate events', async () => {
        // Ben owns a workspace; Ana joins and adds an expense, so a nameless placeholder is kept for her
        const [{ id: ws }] = await t.as<{ id: string }>(ben.authId, `INSERT INTO public.workspaces (name, owner_id, currency, type) VALUES ('Fixture shared', $1, 'EGP', 'shared') RETURNING id`, [ben.userId]);
        await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [ws, ben.userId]);
        await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [ws, ana.userId]);
        await svc(`INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 10, 'EGP', 'Fixture shared expense', 'other', now())`, [ws, ana.userId]);
        await open(ana, 'Fixture to be deleted');
        const [{ id: req }] = await svc<{ id: string }>(`SELECT id FROM public.support_requests WHERE user_id = $1 LIMIT 1`, [ana.userId]);
        await t.as(ana.authId, `INSERT INTO public.support_messages (user_id, request_id, from_admin, body) VALUES ($1, $2, FALSE, 'fixture message')`, [ana.userId, req]);
        await t.as(ana.authId, `INSERT INTO public.consent_events (user_id, purpose, granted, notice_version, provider, surface) VALUES ($1, 'ai_processing', TRUE, 'v1', 'Google (Gemini API)', 'settings')`, [ana.userId]);
        await t.as(ana.authId, `INSERT INTO public.ai_feedback (user_id, surface, rating) VALUES ($1, 'assistant', 'helpful')`, [ana.userId]);

        const [{ r }] = await svc<{ r: { deleted: boolean } }>('SELECT public.delete_account_data($1) AS r', [ana.authId]);
        expect(r.deleted).toBe(true);
        expect(await count(`public.users WHERE id = $1 AND name = 'Deleted user'`, [ana.userId])).toBe(1);   // placeholder kept
        expect(await count(`public.expenses WHERE merchant = 'Fixture shared expense'`)).toBe(1);             // the household's record stays
        for (const table of ['support_requests', 'support_messages', 'consent_events', 'ai_feedback', 'rate_events']) {
            expect(await count(`public.${table} WHERE user_id = $1`, [ana.userId]), table).toBe(0);
        }
    });
});
