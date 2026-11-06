/** The full-year test-data script runs cleanly, can be re-run without doubling, and the removal script undoes it. */
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDb } from './harness';

it('seeds a year, re-runs without duplicates, and removes cleanly', async () => {
    const t = await createTestDb();
    const u = await t.signUp('Mohamed@unifiedhive.com');
    const other = await t.signUp('someone@example.test');
    const [w] = await t.as<{ id: string }>(u.authId, `INSERT INTO public.workspaces (name, owner_id, currency, type) VALUES ('Personal', $1, 'EGP', 'personal') RETURNING id`, [u.userId]);
    const [ow] = await t.as<{ id: string }>(other.authId, `INSERT INTO public.workspaces (name, owner_id, currency, type) VALUES ('Theirs', $1, 'EGP', 'personal') RETURNING id`, [other.userId]);
    await t.as(u.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 99, 'EGP', 'Real purchase', 'other', now())`, [w.id, u.userId]);
    await t.as(other.authId, `INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, category, purchased_at) VALUES ($1, $2, 5, 'EGP', 'Other person', 'other', now())`, [ow.id, other.userId]);

    const seed = readFileSync('supabase/seed/seed_full_year_test_data.sql', 'utf8');
    await t.db.exec(seed);
    const count = async () => (await t.db.query<{ e: number; i: number; b: number; g: number; months: number; cats: number }>(`SELECT
        (SELECT count(*)::int FROM public.expenses WHERE 'test-seed' = ANY (tags)) e,
        (SELECT count(*)::int FROM public.incomes WHERE workspace_id = '${w.id}') i,
        (SELECT count(*)::int FROM public.monthly_bills WHERE workspace_id = '${w.id}') b,
        (SELECT count(*)::int FROM public.savings_goals WHERE workspace_id = '${w.id}') g,
        (SELECT count(DISTINCT date_trunc('month', purchased_at))::int FROM public.expenses WHERE 'test-seed' = ANY (tags)) months,
        (SELECT count(DISTINCT category)::int FROM public.expenses WHERE 'test-seed' = ANY (tags)) cats`)).rows[0];
    const first = await count();
    console.log('seeded', first);
    expect(first.e).toBeGreaterThan(700);
    expect(first.months).toBeGreaterThanOrEqual(12);
    expect(first.cats).toBeGreaterThanOrEqual(9);
    expect(first).toMatchObject({ b: 7, g: 3 });
    expect((await t.db.query<{ n: number }>(`SELECT count(*)::int n FROM public.expenses WHERE 'test-seed' = ANY (tags) AND workspace_id <> '${w.id}'`)).rows[0].n).toBe(0);
    expect((await t.db.query<{ n: number }>(`SELECT count(*)::int n FROM public.expenses WHERE purchased_at > now()`)).rows[0].n).toBe(0);

    await t.db.exec(seed); // again: same totals, no doubling
    expect(await count()).toEqual(first);

    await t.db.exec(readFileSync('supabase/seed/seed_full_year_test_data_REMOVE.sql', 'utf8'));
    expect(await count()).toMatchObject({ e: 0, i: 0, b: 0, g: 0 });
    const left = (await t.db.query<{ merchant: string }>(`SELECT merchant FROM public.expenses ORDER BY merchant`)).rows.map(r => r.merchant);
    expect(left).toEqual(['Other person', 'Real purchase']); // real data untouched
}, 120_000);
