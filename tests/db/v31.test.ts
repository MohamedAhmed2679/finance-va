/**
 * v31: two-step verification is enforced by the database.
 * All rows are test fixtures in an in-memory database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
type U = { authId: string; userId: string };
let ana: U, ben: U;
let wsAna = '';

/** Runs SQL as a signed-in person whose session is at the given assurance level. */
const withAal = <T,>(u: U, aal: 'aal1' | 'aal2', sql: string, params: unknown[] = []) => t.db.transaction(async tx => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)`, [u.authId, JSON.stringify({ sub: u.authId, aal })]);
    await tx.exec('SET LOCAL ROLE authenticated');
    return (await tx.query<T>(sql, params)).rows;
});

beforeAll(async () => {
    t = await createTestDb();
    expect(t.skipped).toEqual([]);
    ana = await t.signUp('ana@example.test');
    ben = await t.signUp('ben@example.test');
    const [w] = await t.as<{ id: string }>(ana.authId, `INSERT INTO public.workspaces (name, owner_id, currency, type) VALUES ('Fixture home', $1, 'EGP', 'personal') RETURNING id`, [ana.userId]);
    wsAna = w.id;
    await t.as(ana.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [wsAna, ana.userId]);
    await t.as(ana.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 10, 'EGP', 'Fixture shop', 'other', now())`, [wsAna, ana.userId]);
});

describe('two-step verification', () => {
    it('covers every table that has row-level security', async () => {
        const [r] = await t.as<{ covered: string; rls: string }>('service', `SELECT
            (SELECT count(*) FROM pg_policies WHERE policyname = 'two_step_required' AND schemaname = 'public') AS covered,
            (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity) AS rls`);
        expect(Number(r.covered)).toBe(Number(r.rls));
        expect(Number(r.covered)).toBeGreaterThan(25);
    });

    it('changes nothing for an account without it', async () => {
        expect(await withAal(ana, 'aal1', `SELECT merchant FROM public.expenses WHERE workspace_id = $1`, [wsAna])).toHaveLength(1);
        expect(await t.as(ana.authId, `SELECT merchant FROM public.expenses WHERE workspace_id = $1`, [wsAna])).toHaveLength(1);   // a token with no level at all
    });

    it('an unfinished set-up does not lock the account', async () => {
        await t.db.query(`INSERT INTO auth.mfa_factors (user_id, status) VALUES ($1, 'unverified')`, [ana.authId]);
        expect(await withAal(ana, 'aal1', `SELECT merchant FROM public.expenses WHERE workspace_id = $1`, [wsAna])).toHaveLength(1);
    });

    describe('once it is on', () => {
        beforeAll(async () => { await t.db.query(`UPDATE auth.mfa_factors SET status = 'verified' WHERE user_id = $1`, [ana.authId]); });

        it('a session that has not entered a code reads nothing', async () => {
            for (const table of ['expenses', 'workspaces', 'workspace_members', 'users', 'notifications', 'support_requests', 'consent_events']) {
                expect(await withAal(ana, 'aal1', `SELECT * FROM public.${table}`), table).toEqual([]);
            }
        });
        it('and cannot add, change or delete anything', async () => {
            await expect(withAal(ana, 'aal1', `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 5, 'EGP', 'Fixture blocked', 'other', now())`, [wsAna, ana.userId])).rejects.toThrow(/row-level security/);
            expect(await withAal(ana, 'aal1', `UPDATE public.expenses SET amount = 999 WHERE workspace_id = $1 RETURNING id`, [wsAna])).toEqual([]);
            expect(await withAal(ana, 'aal1', `DELETE FROM public.expenses WHERE workspace_id = $1 RETURNING id`, [wsAna])).toEqual([]);
            await expect(withAal(ana, 'aal1', `INSERT INTO public.support_requests (user_id, category, subject) VALUES ($1, 'account', 'Fixture blocked')`, [ana.userId])).rejects.toThrow();
        });
        it('a session that entered a code works as before', async () => {
            expect(await withAal(ana, 'aal2', `SELECT merchant FROM public.expenses WHERE workspace_id = $1`, [wsAna])).toHaveLength(1);
            expect(await withAal(ana, 'aal2', `UPDATE public.expenses SET amount = 12 WHERE workspace_id = $1 RETURNING id`, [wsAna])).toHaveLength(1);
        });
        it('other people are not affected, and still cannot see this account', async () => {
            expect(await withAal(ben, 'aal1', `SELECT id FROM public.users WHERE id = $1`, [ben.userId])).toHaveLength(1);
            expect(await withAal(ben, 'aal1', `SELECT merchant FROM public.expenses WHERE workspace_id = $1`, [wsAna])).toEqual([]);
            expect(await withAal(ben, 'aal2', `SELECT merchant FROM public.expenses WHERE workspace_id = $1`, [wsAna])).toEqual([]);
        });
        it('turning it off restores access for a first-step session', async () => {
            await t.db.query(`DELETE FROM auth.mfa_factors WHERE user_id = $1`, [ana.authId]);
            expect(await withAal(ana, 'aal1', `SELECT merchant FROM public.expenses WHERE workspace_id = $1`, [wsAna])).toHaveLength(1);
        });
    });
});
