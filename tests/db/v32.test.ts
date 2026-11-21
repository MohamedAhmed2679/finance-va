/**
 * v32: least privilege. All rows are test fixtures in an in-memory database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
let ana: { authId: string; userId: string };

const asAnon = (sql: string) => t.db.transaction(async tx => {
    await tx.exec(`SET LOCAL ROLE anon`);
    return (await tx.query(sql)).rows;
});

beforeAll(async () => {
    t = await createTestDb();
    expect(t.skipped).toEqual([]);
    ana = await t.signUp('ana@example.test');   // fires the profile trigger (no EXECUTE needed at run time)
});

describe('not signed in', () => {
    it('cannot read or change any table', async () => {
        for (const table of ['users', 'expenses', 'workspaces', 'announcements', 'support_messages']) {
            await expect(asAnon(`SELECT * FROM public.${table} LIMIT 1`), table).rejects.toThrow(/permission denied/);
        }
        await expect(asAnon(`DELETE FROM public.expenses`)).rejects.toThrow(/permission denied/);
    });
    it('cannot call the app functions', async () => {
        for (const fn of [`public.ensure_profile()`, `public.claim_pending_invites()`, `public.list_my_invitations()`, `public.get_workspace_invite('x')`]) {
            await expect(asAnon(`SELECT ${fn}`), fn).rejects.toThrow(/permission denied/);
        }
    });
    it('can still evaluate the yes/no policy helpers', async () => {
        const [r] = await asAnon(`SELECT public.current_user_id() AS me, public.is_app_admin() AS admin`) as { me: string | null; admin: boolean }[];
        expect(r.me).toBeNull();
        expect(r.admin).toBe(false);
    });
});

describe('signed in', () => {
    it('still works: profile, workspace, expense, history triggers', async () => {
        const [w] = await t.as<{ id: string }>(ana.authId, `INSERT INTO public.workspaces (name, owner_id, currency, type) VALUES ('Fixture home', $1, 'EGP', 'personal') RETURNING id`, [ana.userId]);
        await t.as(ana.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [w.id, ana.userId]);
        await t.as(ana.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 10, 'EGP', 'Fixture shop', 'other', now())`, [w.id, ana.userId]);
        expect(await t.as(ana.authId, `SELECT merchant FROM public.expenses WHERE workspace_id = $1`, [w.id])).toHaveLength(1);
        const [p] = await t.as<{ id: string }>(ana.authId, `SELECT (public.ensure_profile()).id AS id`);
        expect(p.id).toBe(ana.userId);
        expect(await t.as(ana.authId, `SELECT * FROM public.list_my_invitations()`)).toEqual([]);
    });
    it('cannot TRUNCATE (which would skip row-level security)', async () => {
        await expect(t.as(ana.authId, `TRUNCATE public.expenses`)).rejects.toThrow(/permission denied/);
    });
    it('cannot call trigger functions directly', async () => {
        await expect(t.as(ana.authId, `SELECT public.handle_new_user()`)).rejects.toThrow(/permission denied|trigger/);
    });
});
