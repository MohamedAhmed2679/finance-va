/**
 * Smart Cart in the database: isolation, state rules, server-side totals, one expense per cart.
 * All rows here are test fixtures in an in-memory database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { calculate } from '../../src/smartcart/money';

let t: TestDb;
let alice: { authId: string; userId: string }, bob: { authId: string; userId: string }, viewer: { authId: string; userId: string };
let ws: string;

async function newCart(owner = alice, extra: Record<string, unknown> = {}) {
    const cols = ['user_id', 'workspace_id', 'currency', ...Object.keys(extra)];
    const vals = [owner.userId, ws, 'EGP', ...Object.values(extra)];
    const [c] = await t.as<{ id: string }>(owner.authId, `INSERT INTO public.smart_carts (${cols}) VALUES (${cols.map((_, i) => '$' + (i + 1))}) RETURNING id`, vals);
    return c.id;
}
async function addItem(cart: string, name: string, unitMinor: number, qtyMilli = 1000, extra: Record<string, unknown> = {}, who = alice) {
    const cols = ['cart_id', 'name', 'unit_price_minor', 'qty_milli', 'currency', ...Object.keys(extra)];
    const vals = [cart, name, unitMinor, qtyMilli, 'EGP', ...Object.values(extra)];
    const [i] = await t.as<{ id: string }>(who.authId, `INSERT INTO public.smart_cart_items (${cols}) VALUES (${cols.map((_, i) => '$' + (i + 1))}) RETURNING id`, vals);
    return i.id;
}
const totals = async (cart: string, who = alice) => (await t.as<{ t: Record<string, number> }>(who.authId, 'SELECT public.smart_cart_totals($1) AS t', [cart]))[0].t;
const confirm = (cart: string, expected: number | null, actual: number | null = null, who = alice) =>
    t.as<{ r: { expenseId: string; alreadyConfirmed: boolean } }>(who.authId, `SELECT public.confirm_smart_cart($1, $2, 'groceries', 'card', now(), 'test fixture', $3) AS r`, [cart, expected, actual]).then(x => x[0].r);
const expensesFor = async (cart: string) => t.as<{ id: string; amount: string; merchant: string; source: string; details: Record<string, unknown> }>('service', 'SELECT * FROM public.expenses WHERE cart_id = $1', [cart]);

beforeAll(async () => {
    t = await createTestDb();
    expect(t.skipped).toEqual([]);
    alice = await t.signUp('alice@example.test');
    bob = await t.signUp('bob@example.test');
    viewer = await t.signUp('vera@example.test');
    const [w] = await t.as<{ id: string }>(alice.authId, `INSERT INTO public.workspaces (name, owner_id, currency) VALUES ('Home', $1, 'EGP') RETURNING id`, [alice.userId]);
    ws = w.id;
    await t.as(alice.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [ws, alice.userId]);
    await t.as(alice.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'viewer', 'active')`, [ws, viewer.userId]);
});

describe('totals match the app calculator exactly', () => {
    it.each([
        ['add', [[10000, 2000, false]], 22800],
        ['included', [[11400, 1000, false]], 11400],
        ['add', [[10000, 1000, false], [5000, 1000, true]], 16400],
        ['none', [[10000, 2000, false]], 20000],
        ['add', [[1999, 725, false], [1, 500, false], [333, 3000, true]], null],
        ['included', [[1999, 725, false], [12345, 1500, false], [99, 1000, true]], null],
    ] as const)('mode %s', async (mode, items, expected) => {
        const cart = await newCart(alice, { vat_mode: mode });
        for (const [u, q, ex] of items) await addItem(cart, 'Fixture item', u, q, { vat_exempt: ex });
        const db = await totals(cart);
        const app = calculate(items.map(([u, q, ex]) => ({ unitMinor: u, qtyMilli: q, vatExempt: ex })), mode);
        expect(Number(db.total)).toBe(app.total);
        expect(Number(db.vat)).toBe(app.vat);
        expect(Number(db.subtotal)).toBe(app.subtotal);
        expect(Number(db.beforeVat)).toBe(app.beforeVat);
        if (expected !== null) expect(app.total).toBe(expected);
    });
});

describe('confirming a cart', () => {
    it('creates exactly one itemized expense, even when confirmed again', async () => {
        const cart = await newCart(alice, { store_name: 'Carrefour Maadi', vat_mode: 'add' });
        await addItem(cart, 'Milk 1L', 3500, 2000);
        await addItem(cart, 'Bread', 1500, 1000, { vat_exempt: true });
        const total = Number((await totals(cart)).total);
        expect(total).toBe(9480); // 70 + 15 + 14% of 70 = 94.80
        const first = await confirm(cart, total);
        const again = await confirm(cart, total);
        expect(again.alreadyConfirmed).toBe(true);
        expect(again.expenseId).toBe(first.expenseId);
        const rows = await expensesFor(cart);
        expect(rows).toHaveLength(1);
        expect(rows[0].merchant).toBe('Shopping · Carrefour Maadi');
        expect(rows[0].source).toBe('smart_cart');
        expect(Number(rows[0].amount)).toBe(94.8);
        const d = rows[0].details as { items: unknown[]; vatMinor: number; estimatedTotalMinor: number; actualTotalMinor: null };
        expect(d.items).toHaveLength(2);
        expect([d.vatMinor, d.estimatedTotalMinor, d.actualTotalMinor]).toEqual([980, 9480, null]);
    });
    it('records the actual checkout amount and the difference without touching item prices', async () => {
        const cart = await newCart();
        await addItem(cart, 'Rice 5kg', 25000);
        const total = Number((await totals(cart)).total); // 285.00 with 14% added
        await confirm(cart, total, 27999);
        const [e] = await expensesFor(cart);
        expect(Number(e.amount)).toBe(279.99);
        const d = e.details as { estimatedTotalMinor: number; actualTotalMinor: number; differenceMinor: number; items: { unitPriceMinor: number }[] };
        expect([d.estimatedTotalMinor, d.actualTotalMinor, d.differenceMinor]).toEqual([28500, 27999, -501]);
        expect(d.items[0].unitPriceMinor).toBe(25000);
        expect(rowsTitle(e.merchant)).toBe('Smart Cart Purchase');
    });
    it('rejects a stale total: the user must confirm the latest numbers', async () => {
        const cart = await newCart();
        await addItem(cart, 'Eggs', 9000);
        const old = Number((await totals(cart)).total);
        await addItem(cart, 'Cheese', 6000);
        await expect(confirm(cart, old)).rejects.toThrow(/totals_changed/);
        expect(await expensesFor(cart)).toHaveLength(0);
    });
    it('refuses an empty cart', async () => {
        const cart = await newCart();
        await expect(confirm(cart, 0)).rejects.toThrow(/at least one item/);
        await expect(t.as(alice.authId, 'SELECT public.calculate_smart_cart($1)', [cart])).rejects.toThrow(/at least one item/);
    });
    it('refuses mixed currencies instead of converting', async () => {
        const cart = await newCart();
        await addItem(cart, 'Local item', 1000);
        await t.as(alice.authId, `INSERT INTO public.smart_cart_items (cart_id, name, unit_price_minor, currency) VALUES ($1, 'Imported', 500, 'USD')`, [cart]);
        await expect(t.as(alice.authId, 'SELECT public.calculate_smart_cart($1)', [cart])).rejects.toThrow(/different currency/);
        await expect(confirm(cart, Number((await totals(cart)).total))).rejects.toThrow(/different currency/);
    });
    it('a failed save leaves the cart as a recoverable draft', async () => {
        const cart = await newCart();
        await addItem(cart, 'Coffee', 12000);
        const total = Number((await totals(cart)).total);
        await expect(t.as(alice.authId, `SELECT public.confirm_smart_cart($1, $2, '', 'card', now())`, [cart, total])).rejects.toThrow(/category/);
        const [c] = await t.as<{ status: string }>(alice.authId, 'SELECT status FROM public.smart_carts WHERE id = $1', [cart]);
        expect(c.status).toBe('draft');
        expect(await expensesFor(cart)).toHaveLength(0);
        await confirm(cart, total); // retry works
        expect(await expensesFor(cart)).toHaveLength(1);
    });
    it('a viewer cannot create carts in the workspace', async () => {
        await expect(newCart(viewer)).rejects.toThrow();
    });
});

describe('state rules', () => {
    it('editing a calculated cart moves it back to draft', async () => {
        const cart = await newCart();
        const item = await addItem(cart, 'Apples', 4000, 1500);
        await t.as(alice.authId, 'SELECT public.calculate_smart_cart($1)', [cart]);
        await t.as(alice.authId, 'UPDATE public.smart_cart_items SET qty_milli = 2000 WHERE id = $1', [item]);
        const [c] = await t.as<{ status: string; calculated_total_minor: string | null }>(alice.authId, 'SELECT status, calculated_total_minor FROM public.smart_carts WHERE id = $1', [cart]);
        expect(c).toEqual({ status: 'draft', calculated_total_minor: null });
    });
    it('a cart cannot be marked confirmed directly', async () => {
        const cart = await newCart();
        await addItem(cart, 'Tea', 3000);
        await expect(t.as(alice.authId, `UPDATE public.smart_carts SET status = 'confirmed' WHERE id = $1`, [cart])).rejects.toThrow(/confirm_smart_cart/);
    });
    it('discarding creates no expense and freezes the cart', async () => {
        const cart = await newCart();
        await addItem(cart, 'Soap', 2500, 1000, { image_paths: [`${alice.authId}/${'x'}/tag.jpg`] });
        const [{ r }] = await t.as<{ r: { discarded: boolean; imagePaths: string[] } }>(alice.authId, 'SELECT public.discard_smart_cart($1) AS r', [cart]);
        expect(r.discarded).toBe(true);
        expect(r.imagePaths).toHaveLength(1);
        expect(await expensesFor(cart)).toHaveLength(0);
        await expect(confirm(cart, 2850)).rejects.toThrow(/discarded/);
        await expect(addItem(cart, 'More', 100)).rejects.toThrow(/discarded/);
    });
    it('a confirmed cart cannot be edited or discarded', async () => {
        const cart = await newCart();
        const item = await addItem(cart, 'Juice', 2000);
        await confirm(cart, Number((await totals(cart)).total));
        await expect(t.as(alice.authId, 'UPDATE public.smart_cart_items SET unit_price_minor = 1 WHERE id = $1', [item])).rejects.toThrow(/confirmed/);
        await expect(t.as(alice.authId, 'SELECT public.discard_smart_cart($1)', [cart])).rejects.toThrow(/confirmed/);
    });
    it('rejects invalid items', async () => {
        const cart = await newCart();
        await expect(addItem(cart, '  ', 100)).rejects.toThrow();
        await expect(addItem(cart, 'Neg', -1)).rejects.toThrow();
        await expect(addItem(cart, 'Zero qty', 100, 0)).rejects.toThrow();
        await expect(addItem(cart, 'Dates', 100, 1000, { production_date: '2026-05-01', expiry_date: '2026-04-01' })).rejects.toThrow(/expiry/);
    });
});

describe('isolation between users', () => {
    it("another user can't see, change, calculate, confirm or discard someone else's cart", async () => {
        const cart = await newCart();
        const item = await addItem(cart, 'Private item', 1000);
        expect(await t.as(bob.authId, 'SELECT * FROM public.smart_carts WHERE id = $1', [cart])).toHaveLength(0);
        expect(await t.as(bob.authId, 'SELECT * FROM public.smart_cart_items WHERE cart_id = $1', [cart])).toHaveLength(0);
        await t.as(bob.authId, `UPDATE public.smart_cart_items SET unit_price_minor = 1 WHERE id = $1`, [item]);
        const [i] = await t.as<{ unit_price_minor: string }>(alice.authId, 'SELECT unit_price_minor FROM public.smart_cart_items WHERE id = $1', [item]);
        expect(Number(i.unit_price_minor)).toBe(1000);
        await expect(addItem(cart, 'Injected', 1, 1000, {}, bob)).rejects.toThrow();
        await expect(confirm(cart, 1140, null, bob)).rejects.toThrow(/not found/);
        await expect(t.as(bob.authId, 'SELECT public.discard_smart_cart($1)', [cart])).rejects.toThrow(/not found/);
        await expect(t.as(bob.authId, `INSERT INTO public.smart_carts (user_id, workspace_id, currency) VALUES ($1, $2, 'EGP')`, [alice.userId, ws])).rejects.toThrow();
    });
    it("images are readable only by their owner", async () => {
        await t.as('service', `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('smart-cart', $1, $2)`, [`${alice.authId}/c1/tag.jpg`, alice.authId]);
        expect(await t.as(alice.authId, `SELECT name FROM storage.objects WHERE bucket_id = 'smart-cart'`)).toHaveLength(1);
        expect(await t.as(bob.authId, `SELECT name FROM storage.objects WHERE bucket_id = 'smart-cart'`)).toHaveLength(0);
        await expect(t.as(bob.authId, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('smart-cart', $1, $2)`, [`${alice.authId}/c1/evil.jpg`, bob.authId])).rejects.toThrow();
    });
});

function rowsTitle(m: string) { return m; }

describe('cart currency differs from the workspace currency', () => {
    it('stores the workspace-currency value using the given rate', async () => {
        const cart = (await t.as<{ id: string }>(alice.authId, `INSERT INTO public.smart_carts (user_id, workspace_id, currency, vat_mode) VALUES ($1, $2, 'USD', 'none') RETURNING id`, [alice.userId, ws]))[0].id;
        await t.as(alice.authId, `INSERT INTO public.smart_cart_items (cart_id, name, unit_price_minor, currency) VALUES ($1, 'Duty free', 1000, 'USD')`, [cart]);
        await t.as(alice.authId, `SELECT public.confirm_smart_cart($1, 1000, 'shopping', 'card', now(), NULL, NULL, 48.5)`, [cart]);
        const [e] = await expensesFor(cart);
        expect([Number(e.amount), e.currency, Number((e as unknown as { base_amount: string }).base_amount), (e as unknown as { base_currency: string }).base_currency]).toEqual([10, 'USD', 485, 'EGP']);
    });
});

describe('the app does not send user ids', () => {
    it('the database fills in the owner from the session, even if another id is sent', async () => {
        const [c] = await t.as<{ user_id: string }>(alice.authId, `INSERT INTO public.smart_carts (workspace_id, currency) VALUES ($1, 'EGP') RETURNING user_id`, [ws]);
        expect(c.user_id).toBe(alice.userId);
        const [d] = await t.as<{ user_id: string }>(alice.authId, `INSERT INTO public.smart_carts (user_id, workspace_id, currency) VALUES ($1, $2, 'EGP') RETURNING user_id`, [bob.userId, ws]);
        expect(d.user_id).toBe(alice.userId);
    });
});
