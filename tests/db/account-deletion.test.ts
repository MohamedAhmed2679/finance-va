/**
 * v24: deleting an account. All rows are test fixtures in an in-memory database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
type U = { authId: string; userId: string };
let leaver: U, partner: U, viewer: U, friend: U;
let solo: string, household: string, friendsWs: string, viewerOnly: string;

const one = async <T,>(sql: string, p: unknown[] = []) => (await t.as<T>('service', sql, p))[0];
const count = async (sql: string, p: unknown[] = []) => Number((await one<{ n: string }>(`SELECT count(*) AS n FROM ${sql}`, p)).n);
const workspace = async (owner: U, name: string, type: 'personal' | 'shared') => {
    const [w] = await t.as<{ id: string }>(owner.authId, `INSERT INTO public.workspaces (name, owner_id, currency, type) VALUES ($1, $2, 'EGP', $3) RETURNING id`, [name, owner.userId, type]);
    await t.as(owner.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [w.id, owner.userId]);
    return w.id;
};
const join = (ws: string, u: U, role: string, joined = 'now()') =>
    t.as('service', `INSERT INTO public.workspace_members (workspace_id, user_id, role, status, joined_at) VALUES ($1, $2, $3, 'active', ${joined})`, [ws, u.userId, role]);
const expense = (u: U, ws: string, merchant: string) =>
    t.as(u.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 10, 'EGP', $3, 'other', now())`, [ws, u.userId, merchant]);

beforeAll(async () => {
    t = await createTestDb();
    expect(t.skipped).toEqual([]);
    leaver = await t.signUp('leaver@example.test');
    partner = await t.signUp('partner@example.test');
    viewer = await t.signUp('viewer@example.test');
    friend = await t.signUp('friend@example.test');

    solo = await workspace(leaver, 'Leaver personal', 'personal');
    household = await workspace(leaver, 'Household', 'shared');
    await join(household, viewer, 'viewer', `now() - interval '2 years'`); // longest-standing, but only a viewer
    await join(household, partner, 'member', `now() - interval '1 year'`);
    viewerOnly = await workspace(leaver, 'Shown to a viewer', 'shared');
    await join(viewerOnly, viewer, 'viewer');
    friendsWs = await workspace(friend, 'Friends trip', 'shared');
    await join(friendsWs, leaver, 'member');

    await expense(leaver, solo, 'Fixture private');
    await expense(leaver, household, 'Fixture groceries');
    await expense(partner, household, 'Fixture partner rent');
    await expense(leaver, friendsWs, 'Fixture taxi');
    await t.as(leaver.authId, `INSERT INTO public.notifications (user_id, type, message) VALUES ($1, 'admin_notice', 'fixture')`, [leaver.userId]);
    await t.as(leaver.authId, `INSERT INTO public.push_subscriptions (user_id, endpoint) VALUES ($1, 'https://push.example.test/1')`, [leaver.userId]);
    await t.as(leaver.authId, `INSERT INTO public.smart_carts (user_id, workspace_id, currency) VALUES ($1, $2, 'EGP')`, [leaver.userId, solo]);
    await t.db.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('smart-cart', $1, $2), ('smart-cart', $3, $4)`,
        [`${leaver.authId}/cart/a.jpg`, leaver.authId, `${partner.authId}/cart/b.jpg`, partner.authId]);
});

describe('before confirming', () => {
    it('the preview shows what will be deleted, handed over and left', async () => {
        const [{ p }] = await t.as<{ p: Record<string, string[]> }>(leaver.authId, 'SELECT public.account_deletion_preview() AS p');
        expect(p).toEqual({ deleteWorkspaces: ['Leaver personal'], transferWorkspaces: ['Household', 'Shown to a viewer'], leaveWorkspaces: ['Friends trip'] });
    });
});

describe('deleting the account', () => {
    let result: Record<string, unknown>;
    beforeAll(async () => {
        result = (await one<{ r: Record<string, unknown> }>('SELECT public.delete_account_data($1) AS r', [leaver.authId])).r;
    });

    it('reports what happened and lists only this person\'s files', () => {
        expect(result).toMatchObject({ deleted: true, workspacesDeleted: 1, workspacesTransferred: 2 });
        expect(result.storagePaths).toEqual([`smart-cart/${leaver.authId}/cart/a.jpg`]);
    });

    it('deletes the personal workspace and everything in it', async () => {
        expect(await count('public.workspaces WHERE id = $1', [solo])).toBe(0);
        expect(await count(`public.expenses WHERE merchant = 'Fixture private'`)).toBe(0);
        expect(await count('public.change_history WHERE workspace_id = $1', [solo])).toBe(0);
    });

    it('hands shared workspaces to the next admin or member, and tells them', async () => {
        expect((await one<{ owner_id: string }>('SELECT owner_id FROM public.workspaces WHERE id = $1', [household])).owner_id).toBe(partner.userId);
        expect((await one<{ role: string }>('SELECT role FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2', [household, partner.userId])).role).toBe('owner');
        // a workspace with only a viewer left still goes to that viewer rather than being deleted
        expect((await one<{ owner_id: string }>('SELECT owner_id FROM public.workspaces WHERE id = $1', [viewerOnly])).owner_id).toBe(viewer.userId);
        expect(await count(`public.notifications WHERE user_id = $1 AND message LIKE 'You now own "Household"%'`, [partner.userId])).toBe(1);
    });

    it('keeps the household\'s records but removes the person\'s name and email', async () => {
        expect(await count(`public.expenses WHERE merchant IN ('Fixture groceries', 'Fixture partner rent', 'Fixture taxi')`)).toBe(3);
        const row = await one<{ name: string; email: string; auth_id: string; is_banned: boolean; phone: string | null }>('SELECT name, email, auth_id, is_banned, phone FROM public.users WHERE id = $1', [leaver.userId]);
        expect(row.name).toBe('Deleted user');
        expect(row.email).not.toContain('leaver');
        expect(row.auth_id).not.toBe(leaver.authId);
        expect(row.is_banned).toBe(true);
        expect(await count(`public.change_history WHERE table_name = 'users' AND row_id = $1`, [leaver.userId])).toBe(0);
    });

    it('removes memberships, notifications, devices and Smart Carts', async () => {
        expect(await count('public.workspace_members WHERE user_id = $1', [leaver.userId])).toBe(0);
        expect(await count('public.notifications WHERE user_id = $1', [leaver.userId])).toBe(0);
        expect(await count('public.push_subscriptions WHERE user_id = $1', [leaver.userId])).toBe(0);
        expect(await count('public.smart_carts WHERE user_id = $1', [leaver.userId])).toBe(0);
    });

    it('leaves everyone else untouched', async () => {
        expect(await count('public.workspaces WHERE id = $1', [friendsWs])).toBe(1);
        expect((await one<{ name: string }>('SELECT name FROM public.users WHERE id = $1', [partner.userId])).name).not.toBe('Deleted user');
        expect(await count('public.workspace_members WHERE workspace_id = $1', [friendsWs])).toBe(1);
    });

    it('running it again is harmless', async () => {
        const again = (await one<{ r: Record<string, unknown> }>('SELECT public.delete_account_data($1) AS r', [leaver.authId])).r;
        expect(again).toMatchObject({ deleted: false, reason: 'no_profile' });
    });
});

describe('someone with nothing shared', () => {
    it('is removed completely, confirmed Smart Carts included', async () => {
        const lone = await t.signUp('lone@example.test');
        const ws = await workspace(lone, 'Lone personal', 'personal');
        const [c] = await t.as<{ id: string }>(lone.authId, `INSERT INTO public.smart_carts (user_id, workspace_id, currency) VALUES ($1, $2, 'EGP') RETURNING id`, [lone.userId, ws]);
        await t.as(lone.authId, `INSERT INTO public.smart_cart_items (cart_id, name, unit_price_minor, qty_milli, currency) VALUES ($1, 'Fixture', 100, 1000, 'EGP')`, [c.id]);
        const total = Number((await t.as<{ t: { total: number } }>(lone.authId, 'SELECT public.smart_cart_totals($1) AS t', [c.id]))[0].t.total);
        await t.as(lone.authId, `SELECT public.confirm_smart_cart($1, $2, 'groceries', 'card', now())`, [c.id, total]);
        const r = (await one<{ r: Record<string, unknown> }>('SELECT public.delete_account_data($1) AS r', [lone.authId])).r;
        expect(r).toMatchObject({ deleted: true, workspacesDeleted: 1, workspacesTransferred: 0 });
        expect(await count('public.users WHERE id = $1', [lone.userId])).toBe(0);
        expect(await count('public.smart_carts WHERE id = $1', [c.id])).toBe(0);
    });
});
