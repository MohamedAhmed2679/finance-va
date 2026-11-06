/**
 * v23: reminders chosen in Settings → Notifications, budget alerts, and Smart Cart photo cleanup.
 * All rows are test fixtures in an in-memory database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
type U = { authId: string; userId: string };
let ann: U, ben: U, cat: U;
let annWs: string, sharedWs: string;

const notes = (u: U, type: string) => t.as<{ message: string; dedupe_key: string; link: string }>('service', 'SELECT message, dedupe_key, link FROM public.notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at', [u.userId, type]);
const addExpense = (u: U, ws: string, amount: number, at = 'now()') =>
    t.as(u.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, $3, 'EGP', 'Fixture shop', 'groceries', ${at}) RETURNING id`, [ws, u.userId, amount]);
const workspace = async (u: U, name: string, type: 'personal' | 'shared') => {
    const [w] = await t.as<{ id: string }>(u.authId, `INSERT INTO public.workspaces (name, owner_id, currency, type) VALUES ($1, $2, 'EGP', $3) RETURNING id`, [name, u.userId, type]);
    await t.as(u.authId, `INSERT INTO public.workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT DO NOTHING`, [w.id, u.userId]);
    return w.id;
};

beforeAll(async () => {
    t = await createTestDb();
    expect(t.skipped).toEqual([]);
    ann = await t.signUp('ann@example.test');
    ben = await t.signUp('ben@example.test');
    cat = await t.signUp('cat@example.test');
    annWs = await workspace(ann, 'Ann personal', 'personal');
    sharedWs = await workspace(ann, 'Ann shared', 'shared');
});

describe('reminder choices', () => {
    it('start off and record when they are saved', async () => {
        const [row] = await t.as<{ notify_daily: boolean; notify_monthly: boolean; notify_budget: boolean; notify_prefs_saved_at: string | null }>(ann.authId, 'SELECT notify_daily, notify_monthly, notify_budget, notify_prefs_saved_at FROM public.users WHERE id = $1', [ann.userId]);
        expect(row).toMatchObject({ notify_daily: false, notify_monthly: false, notify_budget: false, notify_prefs_saved_at: null });
        await t.as(ann.authId, 'UPDATE public.users SET notify_daily = true WHERE id = $1', [ann.userId]);
        const [after] = await t.as<{ notify_prefs_saved_at: string | null }>(ann.authId, 'SELECT notify_prefs_saved_at FROM public.users WHERE id = $1', [ann.userId]);
        expect(after.notify_prefs_saved_at).not.toBeNull();
    });
});

describe('daily reminder (evening)', () => {
    it('reaches people who chose it and logged nothing today, once', async () => {
        await t.as(ben.authId, 'UPDATE public.users SET notify_daily = true WHERE id = $1', [ben.userId]);
        const benWs = await workspace(ben, 'Ben personal', 'personal');
        await addExpense(ben, benWs, 10); // Ben logged something today
        await t.as('service', `SELECT public.create_preference_reminders('evening')`);
        await t.as('service', `SELECT public.create_preference_reminders('evening')`);
        expect(await notes(ann, 'daily_log')).toHaveLength(1);
        expect((await notes(ann, 'daily_log'))[0].link).toBe('/expenses');
        expect(await notes(ben, 'daily_log')).toHaveLength(0);
        expect(await notes(cat, 'daily_log')).toHaveLength(0); // never chose it
    });
    it('the morning run never sends it', async () => {
        await t.as('service', `DELETE FROM public.notifications WHERE type = 'daily_log'`);
        await t.as('service', `SELECT public.create_preference_reminders('morning')`);
        expect(await notes(ann, 'daily_log')).toHaveLength(0);
    });
});

describe('monthly summary', () => {
    it('on the 1st, sums last month per workspace for people who chose it', async () => {
        await t.as(ann.authId, 'UPDATE public.users SET notify_monthly = true WHERE id = $1', [ann.userId]);
        await addExpense(ann, annWs, 100, `'2026-11-10 12:00+02'`);
        await addExpense(ann, annWs, 250.5, `'2026-11-30 23:00+02'`);
        await addExpense(ann, annWs, 999, `'2026-12-01 09:00+02'`); // this month: not counted
        await t.as('service', `SELECT public.create_preference_reminders('morning', '2026-12-02 08:00+02')`); // not the 1st
        expect(await notes(ann, 'monthly_summary')).toHaveLength(0);
        await t.as('service', `SELECT public.create_preference_reminders('morning', '2026-12-01 08:00+02')`);
        await t.as('service', `SELECT public.create_preference_reminders('morning', '2026-12-01 08:00+02')`);
        const n = await notes(ann, 'monthly_summary');
        expect(n).toHaveLength(1); // the shared workspace had no expenses last month
        expect(n[0].message).toBe('November in "Ann personal": EGP 350.50 spent across 2 expenses.');
    });
});

describe('budget alerts', () => {
    it('fire once at 80% and once at 100% of the monthly budget', async () => {
        const dan = await t.signUp('dan@example.test');
        const ws = await workspace(dan, 'Dan personal', 'personal');
        await t.as(dan.authId, 'UPDATE public.users SET notify_budget = true, monthly_budget = 1000 WHERE id = $1', [dan.userId]);
        await addExpense(dan, ws, 500);
        expect(await notes(dan, 'budget_alert')).toHaveLength(0);
        await addExpense(dan, ws, 320);
        let n = await notes(dan, 'budget_alert');
        expect(n).toHaveLength(1);
        expect(n[0].message).toBe('You\'ve used 82% of your monthly budget: EGP 820.00 spent of EGP 1,000.00.');
        await addExpense(dan, ws, 50);
        expect(await notes(dan, 'budget_alert')).toHaveLength(1);
        await addExpense(dan, ws, 200);
        n = await notes(dan, 'budget_alert');
        expect(n).toHaveLength(2);
        expect(n[1].message).toContain('gone over your monthly budget');
        await addExpense(dan, ws, 10);
        expect(await notes(dan, 'budget_alert')).toHaveLength(2);
    });
    it('stay quiet when not chosen, without a budget, or in shared workspaces', async () => {
        await t.as(ann.authId, 'UPDATE public.users SET notify_budget = true, monthly_budget = 100 WHERE id = $1', [ann.userId]);
        await addExpense(ann, sharedWs, 500);
        expect(await notes(ann, 'budget_alert')).toHaveLength(0);
        const eve = await t.signUp('eve@example.test');
        const ws = await workspace(eve, 'Eve personal', 'personal');
        await t.as(eve.authId, 'UPDATE public.users SET monthly_budget = 100 WHERE id = $1', [eve.userId]);
        await addExpense(eve, ws, 500);
        expect(await notes(eve, 'budget_alert')).toHaveLength(0);
    });
});

describe('Smart Cart cleanup', () => {
    it('discards drafts untouched for 30 days and lists photos nobody uses', async () => {
        const fay = await t.signUp('fay@example.test');
        const ws = await workspace(fay, 'Fay personal', 'personal');
        const cart = async () => (await t.as<{ id: string }>(fay.authId, `INSERT INTO public.smart_carts (user_id, workspace_id, currency) VALUES ($1, $2, 'EGP') RETURNING id`, [fay.userId, ws]))[0].id;
        const oldCart = await cart();
        const freshCart = await cart();
        const p = (c: string, f: string) => `${fay.authId}/${c}/${f}`;
        for (const [c, f] of [[oldCart, 'a.jpg'], [freshCart, 'b.jpg']]) {
            await t.as(fay.authId, `INSERT INTO public.smart_cart_items (cart_id, name, unit_price_minor, qty_milli, currency, image_paths) VALUES ($1, 'Fixture', 100, 1000, 'EGP', $2)`, [c, [p(c, f)]]);
        }
        // Storage objects: the two in use, one left behind by a removed item, one uploaded just now
        for (const [name, age] of [[p(oldCart, 'a.jpg'), '40 days'], [p(freshCart, 'b.jpg'), '40 days'], [p(freshCart, 'removed.jpg'), '2 days'], [p(freshCart, 'new.jpg'), '1 minute']]) {
            await t.db.query(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES ('smart-cart', $1, now() - $2::interval)`, [name, age]);
        }
        // The old draft was last touched 40 days ago (test fixture: bypass the update trigger)
        await t.db.exec(`SET session_replication_role = replica;
            UPDATE public.smart_carts SET updated_at = now() - interval '40 days' WHERE id = '${oldCart}';
            UPDATE public.smart_cart_items SET updated_at = now() - interval '40 days' WHERE cart_id = '${oldCart}';
            SET session_replication_role = origin;`);

        const [{ paths }] = await t.as<{ paths: string[] }>('service', 'SELECT public.smart_cart_cleanup() AS paths');
        expect([...paths].sort()).toEqual([p(oldCart, 'a.jpg'), p(freshCart, 'removed.jpg')].sort());
        const states = await t.as<{ id: string; status: string }>('service', 'SELECT id, status FROM public.smart_carts WHERE id = ANY($1)', [[oldCart, freshCart]]);
        expect(Object.fromEntries(states.map(s => [s.id, s.status]))).toEqual({ [oldCart]: 'discarded', [freshCart]: 'draft' });
    });
});
