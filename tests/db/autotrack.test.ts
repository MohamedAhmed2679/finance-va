/**
 * v25 AutoTrack in a real Postgres (PGlite) with every migration applied. Rows are test fixtures.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
type U = { authId: string; userId: string };
let me: U, other: U, viewer: U;
let ws: string, otherWs: string, shared: string;
let fpN = 0;
const fp = () => (++fpN).toString(16).padStart(64, '0');

const item = async (who: U, w: string, extra: Record<string, unknown> = {}) => {
    const row = { workspace_id: w, fingerprint: fp(), suggested_target: 'expense', direction: 'debit', channel: 'card_purchase', amount: 650, currency: 'EGP',
        counterparty: 'GROCERY STORE', provider_id: 'cib', provider_name: 'CIB', account_ref: '5678', received_at: '2026-11-05T10:00:00Z', occurred_at: '2026-11-05T09:58:00Z',
        category: 'groceries', reason: 'A completed card purchase.', parser_version: 'sms-1', ingestion: 'paste', ...extra };
    const cols = Object.keys(row);
    const [r] = await t.as<{ id: string }>(who.authId, `INSERT INTO public.autotrack_items (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, Object.values(row));
    return r.id;
};
const status = async (id: string) => (await t.as<{ status: string; linked_id: string | null }>('service', 'SELECT status, linked_id FROM public.autotrack_items WHERE id = $1', [id]))[0];
const post = (who: U, id: string, target: string, auto = false) => t.as<{ r: Record<string, unknown> }>(who.authId, 'SELECT public.autotrack_post($1, $2, $3) AS r', [id, target, auto]).then(x => x[0].r);

beforeAll(async () => {
    t = await createTestDb();
    expect(t.skipped).toEqual([]);
    me = await t.signUp('me@example.test'); other = await t.signUp('other@example.test'); viewer = await t.signUp('viewer@example.test');
    const mk = async (u: U, name: string, type = 'personal') => {
        const [w] = await t.as<{ id: string }>(u.authId, `INSERT INTO public.workspaces (name, owner_id, currency, type) VALUES ($1, $2, 'EGP', $3) RETURNING id`, [name, u.userId, type]);
        await t.as(u.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [w.id, u.userId]);
        return w.id;
    };
    ws = await mk(me, 'Mine'); otherWs = await mk(other, 'Theirs'); shared = await mk(me, 'Family', 'shared');
    await t.as('service', `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'viewer', 'active')`, [shared, viewer.userId]);
});

describe('items', () => {
    it('the same alert can only exist once per user (any device, any retry)', async () => {
        const f = fp();
        await item(me, ws, { fingerprint: f });
        await expect(item(me, ws, { fingerprint: f })).rejects.toThrow(/duplicate|unique/i);
        // another user receiving the same text is a different person's record
        await expect(item(other, otherWs, { fingerprint: f })).resolves.toBeTruthy();
    });
    it('cannot be created already posted, or in someone else\'s workspace', async () => {
        await expect(item(me, ws, { status: 'confirmed' })).rejects.toThrow(/row-level security|policy/i);
        await expect(item(me, otherWs)).rejects.toThrow(/row-level security|policy/i);
    });
    it('people only ever see their own', async () => {
        const id = await item(me, ws);
        expect(await t.as(other.authId, 'SELECT id FROM public.autotrack_items WHERE id = $1', [id])).toEqual([]);
        await expect(post(other, id, 'expense')).rejects.toThrow(/not found/);
        await expect(t.as(other.authId, 'SELECT public.autotrack_ignore($1)', [id])).rejects.toThrow(/not found/);
        expect(await t.as(other.authId, `UPDATE public.autotrack_items SET amount = 1 WHERE id = $1 RETURNING id`, [id])).toEqual([]);
    });
    it('status can\'t be changed directly, only through the actions', async () => {
        const id = await item(me, ws);
        await expect(t.as(me.authId, `UPDATE public.autotrack_items SET status = 'confirmed' WHERE id = $1`, [id])).rejects.toThrow(/Confirm, Ignore, Link or Undo/);
        await t.as(me.authId, `UPDATE public.autotrack_items SET amount = 655, category = 'dining' WHERE id = $1`, [id]); // corrections while in review are fine
    });
});

describe('posting', () => {
    it('Review First: confirm creates one expense, labelled, and is idempotent', async () => {
        const id = await item(me, ws);
        const r1 = await post(me, id, 'expense');
        const r2 = await post(me, id, 'expense');
        expect(r2).toMatchObject({ id: r1.id, already: true });
        const rows = await t.as<{ notes: string; source: string; amount: string; tags: string[] }>('service', 'SELECT notes, source, amount, tags FROM public.expenses WHERE autotrack_item_id = $1', [id]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ notes: 'Added by AutoTrack', source: 'autotrack', amount: '650.00', tags: ['autotrack'] });
        expect((await status(id)).status).toBe('confirmed');
    });
    it('income goes to Income & Earnings', async () => {
        const id = await item(me, ws, { suggested_target: 'income', direction: 'credit', channel: 'salary', amount: 18000, counterparty: null, category: null });
        const r = await post(me, id, 'income');
        const [inc] = await t.as<{ name: string; source: string }>('service', 'SELECT name, source FROM public.incomes WHERE id = $1', [r.id]);
        expect(inc).toEqual({ name: 'Salary', source: 'autotrack' });
    });
    it('a transfer goes to Transfers (not income or spending) with a separately stated fee as its own expense', async () => {
        const [a] = await t.as<{ id: string }>(me.authId, `INSERT INTO public.own_accounts (label, kind, last4) VALUES ('CIB', 'bank', '4821') RETURNING id`);
        const [b] = await t.as<{ id: string }>(me.authId, `INSERT INTO public.own_accounts (label, kind, last4) VALUES ('Vodafone Cash', 'wallet', '5566') RETURNING id`);
        const id = await item(me, ws, { suggested_target: 'transfer', channel: 'instapay', amount: 2000, fee: 2.5, from_account_id: a.id, to_account_id: b.id });
        const r = await post(me, id, 'transfer');
        const [tr] = await t.as<{ from_label: string; to_label: string; amount: string }>('service', 'SELECT from_label, to_label, amount FROM public.transfers WHERE id = $1', [r.id]);
        expect(tr).toEqual({ from_label: 'CIB', to_label: 'Vodafone Cash', amount: '2000.00' });
        expect((await t.as<{ amount: string }>('service', 'SELECT amount FROM public.expenses WHERE id = $1', [r.feeId]))[0].amount).toBe('2.50');
        expect(await t.as('service', `SELECT 1 FROM public.expenses WHERE autotrack_item_id = $1 AND amount = 2000`, [id])).toEqual([]);
        expect(await t.as('service', `SELECT 1 FROM public.incomes WHERE autotrack_item_id = $1`, [id])).toEqual([]);
    });
    it('a viewer cannot post into a shared workspace', async () => {
        const id = await item(viewer, shared).catch(e => e);
        expect(String(id)).toMatch(/row-level security|policy/i);
    });
});

describe('auto-add only when strictly eligible', () => {
    it('refused in Review First mode', async () => {
        const id = await item(me, ws);
        await expect(post(me, id, 'expense', true)).rejects.toThrow(/not eligible/);
    });
    it('allowed in auto mode for a clean item, refused for uncertain ones', async () => {
        await t.as(me.authId, `INSERT INTO public.autotrack_settings (mode) VALUES ('auto') ON CONFLICT (user_id) DO UPDATE SET mode = 'auto'`);
        const ok = await item(me, ws);
        expect(await post(me, ok, 'expense', true)).toMatchObject({ already: false });
        expect((await status(ok)).status).toBe('auto_added');
        for (const bad of [{ tx_status: 'pending' }, { ai_used: true }, { amount: null }, { direction: 'unknown' }, { suggested_target: 'review' }, { duplicate_of_kind: 'expense', duplicate_of_id: ok }]) {
            const id = await item(me, ws, bad);
            await expect(post(me, id, 'expense', true)).rejects.toThrow(/not eligible/);
            expect((await status(id)).status).toBe('needs_review');
        }
        const tr = await item(me, ws, { suggested_target: 'transfer' });
        await expect(post(me, tr, 'transfer', true)).rejects.toThrow(/accounts not resolved/);
    });
});

describe('undo, ignore, link', () => {
    it('undo removes the record from totals and the alert does not come back', async () => {
        const id = await item(me, ws);
        const r = await post(me, id, 'expense');
        await t.as(me.authId, 'SELECT public.autotrack_undo($1)', [id]);
        expect((await t.as<{ is_deleted: boolean }>('service', 'SELECT is_deleted FROM public.expenses WHERE id = $1', [r.id]))[0].is_deleted).toBe(true);
        expect((await status(id)).status).toBe('undone');
        await expect(post(me, id, 'expense', true)).rejects.toThrow(/not eligible/);   // auto-add can't revive it
    });
    it('ignored items stay ignored until the user restores them', async () => {
        const id = await item(me, ws);
        await t.as(me.authId, 'SELECT public.autotrack_ignore($1)', [id]);
        await expect(post(me, id, 'expense', true)).rejects.toThrow(/not eligible/);
        await t.as(me.authId, 'SELECT public.autotrack_restore($1)', [id]);
        expect((await status(id)).status).toBe('needs_review');
    });
    it('links to an existing Smart Cart / manual expense instead of adding another; undoing the link keeps that expense', async () => {
        const [e] = await t.as<{ id: string }>(me.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at, source) VALUES ($1, $2, 650, 'EGP', 'Smart Cart Purchase', 'groceries', now(), 'smart_cart') RETURNING id`, [ws, me.userId]);
        const id = await item(me, ws);
        await t.as(me.authId, `SELECT public.autotrack_link($1, 'expense', $2)`, [id, e.id]);
        expect(await status(id)).toEqual({ status: 'linked', linked_id: e.id });
        expect(await t.as('service', `SELECT 1 FROM public.expenses WHERE autotrack_item_id = $1 AND id <> $2`, [id, e.id])).toEqual([]);
        await t.as(me.authId, 'SELECT public.autotrack_undo($1)', [id]);
        expect((await t.as<{ is_deleted: boolean }>('service', 'SELECT coalesce(is_deleted, false) AS is_deleted FROM public.expenses WHERE id = $1', [e.id]))[0].is_deleted).toBe(false);
    });
    it('cannot link to someone else\'s record', async () => {
        const [e] = await t.as<{ id: string }>(other.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 650, 'EGP', 'Theirs', 'other', now()) RETURNING id`, [otherWs, other.userId]);
        const id = await item(me, ws);
        await expect(t.as(me.authId, `SELECT public.autotrack_link($1, 'expense', $2)`, [id, e.id])).rejects.toThrow(/isn't available/);
    });
});

describe('own accounts, rules, settings are private', () => {
    it('another user sees none of them', async () => {
        await t.as(me.authId, `INSERT INTO public.autotrack_rules (match, target) VALUES ('AHMED SAMIR', 'transfer')`);
        expect(await t.as(other.authId, 'SELECT * FROM public.own_accounts')).toEqual([]);
        expect(await t.as(other.authId, 'SELECT * FROM public.autotrack_rules')).toEqual([]);
        expect(await t.as(other.authId, 'SELECT * FROM public.autotrack_settings')).toEqual([]);
        await expect(t.as(other.authId, `INSERT INTO public.own_accounts (user_id, label, kind) VALUES ($1, 'x', 'bank')`, [me.userId])).rejects.toThrow(/row-level security|policy/i);
    });
});

describe('deleting imported data', () => {
    it('keeps the records by default, or removes the ones AutoTrack created when asked; linked records are never deleted', async () => {
        const u = await t.signUp('del@example.test');
        const [w] = await t.as<{ id: string }>(u.authId, `INSERT INTO public.workspaces (name, owner_id, currency, type) VALUES ('P', $1, 'EGP', 'personal') RETURNING id`, [u.userId]);
        await t.as(u.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [w.id, u.userId]);
        const a = await item(u, w.id); const ra = await post(u, a, 'expense');
        const [manual] = await t.as<{ id: string }>(u.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 650, 'EGP', 'Typed', 'other', now()) RETURNING id`, [w.id, u.userId]);
        const b = await item(u, w.id); await t.as(u.authId, `SELECT public.autotrack_link($1, 'expense', $2)`, [b, manual.id]);
        const r = (await t.as<{ r: Record<string, number> }>(u.authId, 'SELECT public.autotrack_delete_imported(true) AS r'))[0].r;
        expect(r).toEqual({ items: 2, recordsRemoved: 1 });
        const left = await t.as<{ id: string; is_deleted: boolean }>('service', 'SELECT id, coalesce(is_deleted, false) AS is_deleted FROM public.expenses WHERE id = ANY($1)', [[ra.id, manual.id]]);
        expect(Object.fromEntries(left.map(x => [x.id, x.is_deleted]))).toEqual({ [ra.id as string]: true, [manual.id]: false });
    });
});
