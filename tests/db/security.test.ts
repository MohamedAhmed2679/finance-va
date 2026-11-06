/**
 * Authorization and data-isolation checks against the real migrations (RLS enforced).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });

describe('app admin flag', () => {
    it('a user without a profile row cannot create one marked as app admin', async () => {
        const authId = (await t.db.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0].id;
        await t.db.query('INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, now())', [authId, 'attacker1@example.test']);
        await t.as('service', 'DELETE FROM public.users WHERE auth_id = $1', [authId]); // e.g. the sign-up trigger failed
        const [row] = await t.as<{ id: string }>(authId, `INSERT INTO public.users (auth_id, email, name, is_admin, is_banned) VALUES ($1, 'attacker1@example.test', 'x', true, false) RETURNING id`, [authId]);
        const [r] = await t.as<{ is_admin: boolean }>('service', 'SELECT is_admin FROM public.users WHERE id = $1', [row.id]);
        expect(r.is_admin).toBe(false);
    });
    it('a user cannot claim an admin email they do not own', async () => {
        // the listed admin email is used as the profile email, but the signed-in account's real email is different
        const authId = (await t.db.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0].id;
        await t.db.query('INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, now())', [authId, 'attacker2@example.test']);
        await t.as('service', 'DELETE FROM public.users WHERE auth_id = $1', [authId]);
        const rows = await t.as<{ id: string; is_admin: boolean }>(authId, `INSERT INTO public.users (auth_id, email, name) VALUES ($1, 'mohamed@unifiedhive.com', 'x') RETURNING id, is_admin`, [authId]).catch(e => [{ id: '', is_admin: false, err: String(e) }]);
        const id = rows[0].id;
        if (id) {
            const [r] = await t.as<{ is_admin: boolean }>('service', 'SELECT is_admin FROM public.users WHERE id = $1', [id]);
            expect(r.is_admin).toBe(false);
        }
    });
    it('a user cannot promote themselves later', async () => {
        const { authId, userId } = await t.signUp('plain@example.test');
        await t.as(authId, 'UPDATE public.users SET is_admin = true WHERE id = $1', [userId]);
        const [r] = await t.as<{ is_admin: boolean }>('service', 'SELECT is_admin FROM public.users WHERE id = $1', [userId]);
        expect(r.is_admin).toBe(false);
    });
});

describe('workspace data isolation', () => {
    it("a user cannot read or write another user's workspace expenses", async () => {
        const a = await t.signUp('alice@example.test');
        const b = await t.signUp('bob@example.test');
        const [ws] = await t.as<{ id: string }>(a.authId, `INSERT INTO public.workspaces (name, owner_id, currency) VALUES ('A home', $1, 'EGP') RETURNING id`, [a.userId]);
        await t.as(a.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [ws.id, a.userId]);
        await t.as(a.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 10, 'EGP', 'Shop', 'other', now())`, [ws.id, a.userId]);
        expect((await t.as(b.authId, 'SELECT * FROM public.expenses WHERE workspace_id = $1', [ws.id])).length).toBe(0);
        await expect(t.as(b.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 99, 'EGP', 'X', 'other', now())`, [ws.id, b.userId])).rejects.toThrow();
        await expect(t.as(b.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [ws.id, b.userId])).rejects.toThrow();
        expect((await t.as(a.authId, 'SELECT * FROM public.expenses WHERE workspace_id = $1', [ws.id])).length).toBe(1);
    });
});

describe('workspace roles and authorship', () => {
    it('an admin cannot make someone else owner; expenses are always stamped with the real author', async () => {
        const o = await t.signUp('owner2@example.test');
        const ad = await t.signUp('admin2@example.test');
        const m = await t.signUp('member2@example.test');
        const [ws] = await t.as<{ id: string }>(o.authId, `INSERT INTO public.workspaces (name, owner_id, currency) VALUES ('Team', $1, 'EGP') RETURNING id`, [o.userId]);
        await t.as(o.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [ws.id, o.userId]);
        await t.as(o.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active'), ($1, $3, 'member', 'active')`, [ws.id, ad.userId, m.userId]);
        await expect(t.as(ad.authId, `UPDATE public.workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`, [ws.id, m.userId])).rejects.toThrow(/one owner/);
        await expect(t.as(ad.authId, `UPDATE public.workspace_members SET role = 'viewer' WHERE workspace_id = $1 AND user_id = $2`, [ws.id, o.userId])).rejects.toThrow(/only the owner/);
        await t.as(ad.authId, `UPDATE public.workspace_members SET role = 'viewer' WHERE workspace_id = $1 AND user_id = $2`, [ws.id, m.userId]); // normal role change still works
        const [e] = await t.as<{ created_by: string }>(ad.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 5, 'EGP', 'Spoof', 'other', now()) RETURNING created_by`, [ws.id, o.userId]);
        expect(e.created_by).toBe(ad.userId);
    });
});

describe('row-level security coverage', () => {
    it('every table in the public schema has row-level security switched on', async () => {
        const rows = await t.as<{ table: string }>('service', `SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY 1`);
        expect(rows.map(r => r.table)).toEqual([]);
    });
    it('signed-out visitors can read nothing', async () => {
        const tables = await t.as<{ table: string }>('service', `SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`);
        const leaks: string[] = [];
        for (const { table } of tables) {
            const r = await t.db.transaction(async tx => { await tx.exec('SET LOCAL ROLE anon'); return tx.query(`SELECT count(*)::int AS n FROM public.${table}`).catch(() => ({ rows: [{ n: 0 }] })); });
            if ((r.rows[0] as { n: number }).n > 0) leaks.push(table);
        }
        expect(leaks).toEqual([]);
    });
});
