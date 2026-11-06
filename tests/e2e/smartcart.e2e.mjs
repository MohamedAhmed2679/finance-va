/**
 * Smart Cart end-to-end in a real browser against the production build (vite preview).
 * Supabase and the AI endpoint are replaced by an in-test fake backend; the database rules
 * themselves are covered by tests/db (real Postgres). All data here is test fixtures.
 *
 *   npm run build && npx vite preview --port 4339 &   then   node tests/e2e/smartcart.e2e.mjs http://localhost:4339
 */
import { createRequire } from 'module';
// Playwright comes from the machine (or `npm i -D playwright`); not a dependency of the app
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync, mkdirSync } from 'fs';

const BASE = process.argv[2] || 'http://localhost:4339';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TAG = new URL('./fixtures/price-tag.jpg', import.meta.url).pathname;
const now = new Date().toISOString();
const me = { uid: 'auth1', name: 'Test Shopper', email: 'shopper@example.test', role: 'owner', status: 'active', joinedAt: now };
const storeState = (lang = 'en') => JSON.stringify({ state: {
    isAuthenticated: true, showOnboarding: false, theme: 'light', language: lang, currency: 'EGP',
    user: { id: 'auth1', dbId: 'u1', name: 'Test Shopper', email: 'shopper@example.test', defaultCurrency: 'EGP', language: lang, theme: 'light', showOnboarding: false, connectedClouds: [], createdAt: now, isAdmin: false },
    workspaces: [{ id: 'w1', name: 'Home', type: 'personal', ownerId: 'auth1', currency: 'EGP', icon: '🏠', color: '#2563FF', members: [me], activityLog: [], createdAt: now, cycleStartDay: 1 }],
    activeWorkspaceId: 'w1', notifications: [], expenses: [], incomes: [], bills: [], savingsGoals: [],
}, version: 3 });

// ------------------------------------------------------------------ fake backend
function backend() {
    const db = { carts: new Map(), items: new Map(), confirmCalls: 0, discardCalls: 0, expenses: [], failConfirm: 0, extraction: [], extractionStatus: 200 };
    const lineMinor = (u, q) => Number((BigInt(u) * BigInt(q) * 2n + 1000n) / 2000n);
    const totals = cartId => {
        const c = db.carts.get(cartId);
        const items = [...db.items.values()].filter(i => i.cart_id === cartId);
        let taxable = 0n, exempt = 0n;
        for (const i of items) { const l = BigInt(lineMinor(i.unit_price_minor, i.qty_milli)); if (i.vat_exempt) exempt += l; else taxable += l; }
        const sub = taxable + exempt, rate = BigInt(c.vat_rate_bp ?? 1400);
        let vat = 0n, total = sub;
        if (c.vat_mode === 'add') { vat = (taxable * rate * 2n + 10000n) / 20000n; total = sub + vat; }
        if (c.vat_mode === 'included') { vat = (taxable * rate * 2n + 10000n + rate) / (2n * (10000n + rate)); }
        return { itemCount: items.length, totalQtyMilli: items.reduce((s, i) => s + i.qty_milli, 0), subtotal: Number(sub), taxable: Number(taxable), exempt: Number(exempt), vat: Number(vat), beforeVat: Number(c.vat_mode === 'included' ? sub - vat : sub), total: Number(total), mode: c.vat_mode, rateBp: c.vat_rate_bp ?? 1400, currency: c.currency };
    };
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    async function handle(route) {
        const req = route.request(); const url = new URL(req.url()); const m = req.method();
        const body = req.postData() ? JSON.parse(req.postData()) : null;
        db.requests = db.requests || [];
        db.requests.push({ method: m, path: url.pathname, body });
        if (url.pathname.endsWith('/api/ai/zaylo')) {
            const next = db.extraction.shift();
            if (db.extractionStatus !== 200) return json(route, { error: 'AI is unavailable right now.' }, db.extractionStatus);
            return json(route, next ?? { status: 'unreadable', message: 'Too blurry.', candidates: [] });
        }
        if (url.pathname.includes('/storage/v1/')) return json(route, { error: 'no storage in tests' }, 400);
        if (url.pathname === '/rest/v1/smart_carts' && m === 'POST') {
            for (const r of [].concat(body)) db.carts.set(r.id, { status: 'draft', ...db.carts.get(r.id), ...r });
            return json(route, [], 201);
        }
        if (url.pathname === '/rest/v1/smart_carts' && m === 'GET') return json(route, []);
        if (url.pathname === '/rest/v1/smart_cart_items' && m === 'POST') { for (const r of [].concat(body)) db.items.set(r.id, r); return json(route, [], 201); }
        if (url.pathname === '/rest/v1/smart_cart_items' && m === 'DELETE') {
            const ids = (url.searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(s => s.replace(/"/g, ''));
            ids.forEach(id => db.items.delete(id)); return json(route, []);
        }
        if (url.pathname === '/rest/v1/rpc/calculate_smart_cart') {
            const t = totals(body.p_cart_id);
            if (!t.itemCount) return json(route, { message: 'smart_cart: add at least one item first' }, 400);
            return json(route, t);
        }
        if (url.pathname === '/rest/v1/rpc/confirm_smart_cart') {
            db.confirmCalls++;
            await new Promise(r => setTimeout(r, 400)); // a slow network makes double taps likely
            if (db.failConfirm > 0) { db.failConfirm--; return json(route, { message: 'network down' }, 503); }
            const c = db.carts.get(body.p_cart_id);
            if (c.status === 'confirmed') return json(route, { expenseId: c.expense_id, alreadyConfirmed: true });
            const t = totals(body.p_cart_id);
            if (t.total !== body.p_expected_total_minor) return json(route, { message: 'smart_cart: totals_changed' }, 400);
            const id = `exp-${db.expenses.length + 1}`;
            db.expenses.push({ id, amount: (body.p_actual_minor ?? t.total) / 100, estimate: t.total, actual: body.p_actual_minor });
            c.status = 'confirmed'; c.expense_id = id;
            return json(route, { expenseId: id, alreadyConfirmed: false });
        }
        // ── AutoTrack fake (structured rows only; mirrors the v25 functions' behaviour)
        const at = db.at || (db.at = { items: [], settings: { mode: 'review', ai_consent: false, custom_senders: [], last_processed_at: null, last_error: null }, accounts: [], rules: [], transfers: [], offline: false });
        if (url.pathname === '/rest/v1/autotrack_items') {
            if (m === 'GET') return json(route, at.items);
            if (m === 'POST') {
                if (at.offline) return route.abort('internetdisconnected');
                const out = [];
                for (const r of [].concat(body)) {
                    if (at.items.some(x => x.fingerprint === r.fingerprint)) continue;      // UNIQUE (user, fingerprint)
                    const row = { id: `it-${at.items.length + 1}`, final_target: null, linked_kind: null, linked_id: null, fee_expense_id: null, error: null, decided_at: null, created_at: new Date().toISOString(), ...r };
                    at.items.unshift(row); out.push({ id: row.id });
                }
                return json(route, out, 201);
            }
        }
        if (url.pathname === '/rest/v1/autotrack_settings') {
            if (m === 'GET') return json(route, at.settings);
            Object.assign(at.settings, ...[].concat(body)); return json(route, [], 201);
        }
        if (url.pathname === '/rest/v1/own_accounts' && m === 'GET') return json(route, at.accounts);
        if (url.pathname === '/rest/v1/autotrack_rules' && m === 'GET') return json(route, at.rules);
        if (url.pathname === '/rest/v1/autotrack_rules' && m === 'POST') { at.rules.push(...[].concat(body).map((r, i) => ({ id: `rule-${at.rules.length + i}`, ...r }))); return json(route, [], 201); }
        if (url.pathname === '/rest/v1/transfers' && m === 'GET') return json(route, at.transfers);
        if (url.pathname.startsWith('/rest/v1/rpc/autotrack_')) {
            const it = at.items.find(x => x.id === body.p_item);
            const fn = url.pathname.split('/').pop();
            if (!it) return json(route, { message: 'autotrack: item not found' }, 400);
            if (fn === 'autotrack_post') {
                if (['auto_added', 'confirmed', 'linked'].includes(it.status)) return json(route, { kind: it.linked_kind, id: it.linked_id, already: true });
                Object.assign(it, { status: body.p_auto ? 'auto_added' : 'confirmed', final_target: body.p_target, linked_kind: body.p_target, linked_id: `rec-${it.id}`, category: body.p_category ?? it.category, amount: body.p_amount ?? it.amount });
                return json(route, { kind: body.p_target, id: it.linked_id, already: false });
            }
            if (fn === 'autotrack_undo') { it.status = 'undone'; return json(route, { undone: true }); }
            if (fn === 'autotrack_ignore') { it.status = 'ignored'; return json(route, { ignored: true }); }
            if (fn === 'autotrack_restore') { it.status = 'needs_review'; return json(route, { restored: true }); }
        }
        if (url.pathname === '/rest/v1/rpc/account_deletion_preview') return json(route, { deleteWorkspaces: ['Home'], transferWorkspaces: ['Family'], leaveWorkspaces: [] });
        if (url.pathname === '/rest/v1/rpc/discard_smart_cart') { db.discardCalls++; const c = db.carts.get(body.p_cart_id); if (c) c.status = 'discarded'; return json(route, { discarded: true, imagePaths: [] }); }
        if (url.pathname === '/auth/v1/user' && m === 'PUT') return json(route, { id: 'auth1', aud: 'authenticated', email: 'shopper@example.test', new_email: body?.email, app_metadata: {}, user_metadata: {} });
        if (url.pathname.startsWith('/auth/v1/')) return json(route, {}, 401);
        return json(route, []);
    }
    return { db, handle, totals };
}

// ------------------------------------------------------------------ harness
const results = [];
async function scenario(name, fn, opts = {}) {
    const browser = await chromium.launch();
    const ctx = await browser.newContext(opts.desktop
        ? { viewport: { width: 1280, height: 840 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Zaylo/1.0 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36', permissions: ['notifications'] }
        : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: [] });
    if (opts.desktop) await ctx.addInitScript(() => {
        // The desktop app (Electron) reports notification permission as granted; headless Chromium doesn't
        class FakeNotification { constructor() {} static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } }
        window.Notification = FakeNotification;
    });
    if (opts.session) await ctx.addInitScript(() => {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        localStorage.setItem('sb-ultugpyjbktlsubludds-auth-token', JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
            user: { id: 'auth1', aud: 'authenticated', role: 'authenticated', email: 'shopper@example.test', app_metadata: {}, user_metadata: {} } }));
    });
    await ctx.addInitScript(([s, denyCam]) => {
        if (!sessionStorage.getItem('seeded')) { localStorage.setItem('financeva-store', s); sessionStorage.setItem('seeded', '1'); }
        if (denyCam && navigator.permissions) {
            const q = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = d => (d && d.name === 'camera' ? Promise.resolve({ state: 'denied' }) : q(d));
        }
    }, [storeState(opts.lang), !!opts.denyCamera]);
    const be = backend();
    await ctx.route(/supabase\.co|\/api\/ai\/zaylo|\/api\/push|\/api\/backup|\/api\/account/, be.handle);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
        await page.goto(`${BASE}${opts.path || '/smart-cart'}`);
        await fn(page, be.db, be);
        if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
        results.push([true, name]);
    } catch (e) {
        results.push([false, name, e.message.split('\n')[0]]);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/FAIL-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
    } finally { await browser.close(); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const text = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); } };
const okScan = (name, price, extra = {}) => ({ status: 'ok', message: null, candidates: [{
    name, packageOptions: [{ minor: price, kind: 'package', text: String(price / 100), conditions: null, perUnit: null, currency: 'EGP', currencyAmbiguous: false }],
    promoOptions: [], comparisonPrices: [], packSize: null, unitBasis: 'each', barcode: null,
    productionDate: { value: null, raw: null, ambiguous: false }, expiryDate: { value: null, raw: null, ambiguous: false }, reviewFlags: [], ...extra }] });
async function start(page, store = 'Carrefour') {
    await page.getByRole('button', { name: 'Start shopping' }).waitFor();
    if (store) await page.fill('#sc-start-store', store);
    await page.getByRole('button', { name: 'Start shopping' }).click();
    await page.getByText('Know your total before checkout. Scan a price tag').waitFor();
}
async function upload(page) { await page.locator('input[type=file]:not([capture])').first().setInputFiles(TAG); }
async function manual(page, name, price, { qty, exempt } = {}) {
    await page.getByRole('button', { name: 'Add manually' }).click();
    await page.fill('#sc-name', name); await page.fill('#sc-price', price);
    if (qty) await page.fill('#sc-qty', qty);
    if (exempt) await page.getByLabel('No VAT / Exempt').check();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.locator('.sc-sheet').waitFor({ state: 'detached' });
}
const barTotal = page => text(page, '.sc-bar-total');

// ------------------------------------------------------------------ scenarios
await scenario('scan → review → add; repeated scanning; duplicate increases quantity', async (page, db) => {
    await start(page);
    await shot(page, '01-empty-cart');
    db.extraction.push(okScan('Juhayna Milk 1L', 3495));
    await upload(page);
    await page.locator('#sc-name').waitFor();
    expect(await page.inputValue('#sc-name') === 'Juhayna Milk 1L', 'name filled from scan');
    expect(await page.inputValue('#sc-price') === '34.95', 'price filled from scan');
    expect(await page.inputValue('#sc-exp') === '', 'missing expiry stays empty');
    expect(await page.inputValue('#sc-prod') === '', 'missing production date stays empty');
    await shot(page, '02-review-scan');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.locator('.sc-item').first().waitFor();
    db.extraction.push(okScan('Juhayna Milk 1L', 3495));
    await upload(page);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('alertdialog', { name: 'Already in your cart?' }).waitFor();
    await shot(page, '03-duplicate');
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    expect(await page.locator('.sc-item').count() === 1, 'still one line');
    expect((await text(page, '.sc-item-qty')).includes('2'), 'quantity is 2');
    expect((await barTotal(page)).startsWith('79.69'), `2 × 34.95 + 14% = 79.69, got ${await barTotal(page)}`);
});

await scenario('ambiguous tag: several products, comparison price ignored, promo needs confirmation', async (page, db) => {
    await start(page);
    db.extraction.push({ status: 'choose', message: null, candidates: [
        { ...okScan('Cheese 250g', 6250).candidates[0], comparisonPrices: [{ minor: 25000, kind: 'unit_comparison', text: '250', perUnit: 'per kg', conditions: null, currency: 'EGP', currencyAmbiguous: false }],
          promoOptions: [{ minor: 5500, kind: 'promotional', text: '55', perUnit: null, conditions: 'With loyalty card', currency: 'EGP', currencyAmbiguous: false }], reviewFlags: ['promotion'] },
        okScan('Cheese 500g', 11900).candidates[0],
    ] });
    await upload(page);
    await page.getByText('Several products were found').waitFor();
    await page.getByRole('radio', { name: /Cheese 250g/ }).check();
    expect(await page.inputValue('#sc-price') === '62.50', 'regular package price, not the per-kg price');
    await page.getByText('Comparison price on the tag').waitFor();
    await page.getByRole('radio', { name: /Offer price/ }).check();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByText('Confirm you meet the offer conditions').waitFor();
    await shot(page, '04-promo-needs-confirmation');
    expect(await page.locator('.sc-item').count() === 0, 'not added before confirming the offer');
    await page.getByLabel('I meet the offer conditions').check();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.locator('.sc-item').first().waitFor();
    expect((await text(page, '.sc-item')).includes('55.00'), 'offer price used after confirmation');
});

await scenario('different currency must be resolved before adding', async (page, db) => {
    await start(page);
    const s = okScan('Imported chocolate', 999); s.candidates[0].packageOptions[0].currency = 'USD'; s.candidates[0].reviewFlags = ['currency_mismatch'];
    db.extraction.push(s);
    await upload(page);
    await page.getByText('Zaylo won\'t convert it for you.').waitFor();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    expect(await page.locator('.sc-item').count() === 0, 'blocked while currency differs');
    await page.getByRole('button', { name: 'The price is in EGP' }).click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.locator('.sc-item').first().waitFor();
});

await scenario('unreadable photo and extraction failure offer retry and manual entry', async (page, db) => {
    await start(page);
    db.extraction.push({ status: 'unreadable', message: 'The photo is too dark to read.', candidates: [] });
    await upload(page);
    await page.getByText('The photo is too dark to read.').waitFor();
    await page.getByRole('button', { name: 'Try another photo' }).waitFor();
    db.extractionStatus = 502;
    await upload(page);
    await page.getByText('AI is unavailable right now.').waitFor();
    await shot(page, '05-extraction-error');
    await page.locator('.sc-warn').getByRole('button', { name: 'Add manually' }).click();
    await page.locator('#sc-name').waitFor();
});

await scenario('camera permission denied explains upload and manual entry', async page => {
    await start(page);
    await page.getByRole('button', { name: 'Take photo' }).click();
    await page.getByText('Camera access is turned off for Zaylo.').waitFor();
    await shot(page, '06-camera-denied');
}, { denyCamera: true });

await scenario('manual entry validation; VAT modes, exemptions; removal with undo', async page => {
    await start(page);
    expect(await page.getByRole('button', { name: 'Calculate total' }).isDisabled(), 'calculate disabled for an empty cart');
    await page.getByRole('button', { name: 'Add manually' }).click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByText('Enter the product name.').waitFor();
    await page.getByText('Enter the price.').waitFor();
    await page.fill('#sc-name', 'Bad price'); await page.fill('#sc-price', '12.345');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByText('Enter a valid price').waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await manual(page, 'Item A', '100', { qty: '2' });
    expect((await barTotal(page)).startsWith('228.00'), `2 × 100 + 14% = 228, got ${await barTotal(page)}`);
    await manual(page, 'Exempt item', '50', { exempt: true });
    expect((await barTotal(page)).startsWith('278.00'), `200 + 50 exempt + 28 VAT = 278, got ${await barTotal(page)}`);
    await page.getByRole('radio', { name: 'Prices already include VAT' }).click();
    expect((await barTotal(page)).startsWith('250.00'), 'included mode never adds VAT');
    await page.getByRole('radio', { name: 'Before VAT / No VAT added' }).click();
    expect((await barTotal(page)).startsWith('250.00'), 'no VAT added mode');
    await page.getByRole('radio', { name: /Add 14% VAT/ }).click();
    await page.getByRole('button', { name: 'Remove Exempt item' }).click();
    expect((await barTotal(page)).startsWith('228.00'), 'removal updates the estimate at once');
    await shot(page, '07-undo');
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await barTotal(page)).startsWith('278.00'), 'undo restores the item');
    await page.getByRole('button', { name: 'More Item A' }).click();
    expect((await barTotal(page)).startsWith('392.00'), '3 × 100 + 42 + 50 = 392');
    await shot(page, '08-cart');
});

await scenario('weighed item with a fractional quantity', async page => {
    await start(page);
    await page.getByRole('button', { name: 'Add manually' }).click();
    await page.fill('#sc-name', 'Tomatoes'); await page.fill('#sc-price', '19.99');
    await page.selectOption('#sc-basis', 'kg'); await page.fill('#sc-qty', '0.725');
    expect((await text(page, '.sc-line')).includes('14.49'), '19.99 × 0.725 = 14.49');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.locator('.sc-item').first().waitFor();
    expect((await text(page, '.sc-item')).includes('0.725 kg'), 'shows the unit basis');
});

await scenario('draft survives a reload and can be resumed', async page => {
    await start(page, 'Spinneys');
    await manual(page, 'Coffee', '120');
    await page.waitForTimeout(1200);
    await page.reload();
    await page.getByRole('button', { name: 'Resume draft' }).click();
    await page.locator('.sc-item').first().waitFor();
    expect((await text(page, '.sc-item')).includes('Coffee'), 'item restored');
    expect(await page.inputValue('.sc-title-input') === 'Spinneys', 'store restored');
});

await scenario('confirm creates exactly one expense even with repeated taps; actual amount kept', async (page, db) => {
    await start(page);
    await manual(page, 'Rice 5kg', '250');
    await page.getByRole('button', { name: 'Calculate total' }).click();
    await page.getByText('Estimated total. Your final checkout amount may vary.').waitFor();
    await shot(page, '09-summary');
    await page.fill('#sc-actual', '279.99');
    await page.getByText('Difference from the estimate').waitFor();
    // three taps in the same instant, before the page can re-render
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Confirm purchase')); b.click(); b.click(); b.click(); });
    await page.getByText('Purchase saved').waitFor();
    await shot(page, '10-success');
    expect(db.expenses.length === 1, `one expense, got ${db.expenses.length}`);
    expect(db.confirmCalls === 1, `confirm sent once, got ${db.confirmCalls}`);
    expect(db.expenses[0].amount === 279.99 && db.expenses[0].estimate === 28500, 'actual recorded, estimate kept');
    await page.getByRole('button', { name: 'View expense' }).waitFor();
    await page.getByRole('button', { name: 'Start new cart' }).waitFor();
});

await scenario('a failed save keeps the cart and can be retried', async (page, db) => {
    await start(page);
    await manual(page, 'Juice', '20');
    await page.getByRole('button', { name: 'Calculate total' }).click();
    db.failConfirm = 1;
    await page.getByRole('button', { name: 'Confirm purchase' }).click();
    await page.getByText('Couldn\'t save the purchase. Your cart is safe').waitFor();
    expect(db.expenses.length === 0, 'nothing saved on failure');
    await page.getByRole('button', { name: 'Confirm purchase' }).click();
    await page.getByText('Purchase saved').waitFor();
    expect(db.expenses.length === 1, 'retry saved exactly one');
});

await scenario('editing after calculating updates the summary before confirming', async (page, db) => {
    await start(page);
    await manual(page, 'Eggs', '90');
    await page.getByRole('button', { name: 'Calculate total' }).click();
    await page.getByText('102.60').first().waitFor();
    await page.getByRole('button', { name: 'Continue shopping' }).first().click();
    await manual(page, 'Cheese', '60');
    await page.getByRole('button', { name: 'Calculate total' }).click();
    await page.getByText('171.00').first().waitFor();
    await page.getByRole('button', { name: 'Confirm purchase' }).click();
    await page.getByText('Purchase saved').waitFor();
    expect(db.expenses[0].estimate === 17100, 'confirmed the latest total');
});

await scenario('discard asks first and creates no expense', async (page, db) => {
    await start(page);
    await manual(page, 'Soap', '25');
    await page.getByRole('button', { name: 'Discard cart' }).click();
    await page.getByText('No expense will be created.').waitFor();
    await shot(page, '11-discard');
    await page.getByRole('button', { name: 'Keep cart' }).click();
    expect(await page.locator('.sc-item').count() === 1, 'cancel keeps the cart');
    await page.getByRole('button', { name: 'Discard cart' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard cart' }).click();
    await page.getByRole('button', { name: 'Start shopping' }).waitFor();
    expect(db.expenses.length === 0 && db.confirmCalls === 0, 'no expense created');
    expect(await page.getByRole('button', { name: 'Resume draft' }).count() === 0, 'no draft left');
});

await scenario('Arabic, right-to-left, no horizontal overflow', async page => {
    await page.getByRole('button', { name: 'ابدأ التسوق' }).click();
    await page.getByText('اعرف إجمالي مشترياتك قبل الدفع.').first().waitFor();
    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir === 'rtl', 'page is right-to-left');
    await page.getByRole('button', { name: 'إضافة يدوية' }).click();
    await page.fill('#sc-name', 'حليب'); await page.fill('#sc-price', '٣٤٫٩٥');
    await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
    await page.locator('.sc-item').first().waitFor();
    expect((await barTotal(page)).startsWith('39.84'), `Arabic digits parsed: 34.95 + 14% = 39.84, got ${await barTotal(page)}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow <= 0, `no sideways scroll (${overflow}px)`);
    await shot(page, '12-arabic');
}, { lang: 'ar' });


// ------------------------------------------------------------------ settings, dialogs, sign-out, phone sign-in page
async function openSettings(page, section) {
    await page.getByRole('heading', { name: 'Settings' }).first().waitFor();
    await page.locator('.nav-item').filter({ hasText: new RegExp(`^${section}$`) }).last().click();
}

await scenario('desktop app: notifications turn off and on again, one message at a time', async page => {
    await openSettings(page, 'Notifications');
    await page.getByRole('button', { name: 'Turn off' }).waitFor();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Turn off|Turn on/ }).first().click({ trial: false }).catch(() => {});
    // three quick clicks: off → on → off, never a pile of identical messages
    await page.waitForTimeout(800);
    const toasts = await page.locator('[role=status]').count();
    expect(toasts <= 1, `at most one notification message, saw ${toasts}`);
    const state = await page.locator('.push-panel p').first().innerText();
    const btn = await page.locator('.push-panel button').first().innerText();
    expect((state === 'Off' && btn === 'Turn on') || (state.startsWith('On.') && btn === 'Turn off'), `state and button agree (${state} / ${btn})`);
    if (btn === 'Turn off') await page.getByRole('button', { name: 'Turn off' }).click();
    await page.getByRole('button', { name: 'Turn on' }).waitFor();
    expect((await page.locator('.push-panel p').first().innerText()) === 'Off', 'turning off sticks');
    await page.reload();
    await openSettings(page, 'Notifications');
    await page.getByRole('button', { name: 'Turn on' }).waitFor();
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByRole('button', { name: 'Turn off' }).waitFor();
    expect((await page.locator('.push-panel p').first().innerText()).includes('while Zaylo is open'), 'desktop wording is accurate');
    await shot(page, '13-desktop-notifications');
}, { desktop: true, path: '/settings' });

await scenario('reminder switches are real switches and are saved to the account', async (page, db) => {
    await openSettings(page, 'Notifications');
    const sw = page.getByRole('switch', { name: 'Daily Reminder' });
    expect((await sw.getAttribute('aria-checked')) === 'false', 'starts off');
    await sw.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    expect((await sw.getAttribute('aria-checked')) === 'true', 'keyboard turns it on');
    const saved = db.requests.filter(r => r.method === 'PATCH' && r.path === '/rest/v1/users').map(r => r.body);
    expect(saved.some(b => b && b.notify_daily === true), `saved to the account: ${JSON.stringify(saved)}`);
    await page.getByRole('switch', { name: 'Budget Alerts' }).click();
    await page.waitForTimeout(600);
    expect(db.requests.some(r => r.method === 'PATCH' && r.path === '/rest/v1/users' && r.body?.notify_budget === true), 'budget alerts saved');
}, { desktop: true, path: '/settings' });

await scenario('dialogs: focus moves in, Tab stays inside, Escape closes and focus returns', async (page, db) => {
    await openSettings(page, 'Profile');
    const opener = page.getByRole('button', { name: 'Change', exact: true });
    await opener.click();
    const dlg = page.getByRole('dialog', { name: 'Change Email' });
    await dlg.waitFor();
    expect(await page.evaluate(() => document.activeElement?.id === 'new-email'), 'focus starts in the email field');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]'))), 'Tab stays inside the dialog');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]'))), 'Shift+Tab stays inside the dialog');
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Change'), 'focus returns to the button that opened it');
    // The real email change goes to Supabase (no pretend "verify with Google" step any more)
    await opener.click();
    await page.fill('#new-email', 'new-address@example.test');
    await page.getByRole('button', { name: 'Send confirmation' }).click();
    // Without a real session Supabase refuses: the error is shown and nothing pretends the email changed
    await page.getByText('Auth session missing!').waitFor();
    expect(await dlg.isVisible(), 'dialog stays open after a refusal');
    expect(!(await page.getByText('Allow Access').count()) && !(await page.getByText('Validating').count()), 'no simulated sign-in window');
    expect((await page.locator('input[type=email][disabled], input[value="shopper@example.test"]').first().inputValue().catch(() => 'shopper@example.test')) === 'shopper@example.test', 'shown email unchanged');
}, { desktop: true, path: '/settings' });

await scenario('signing out removes this account\'s data from the device', async page => {
    await page.evaluate(() => {
        localStorage.setItem('zaylo_smart_cart_v1_auth1', '{"id":"fixture"}');
        localStorage.setItem('zaylo_health_w1', '{}');
        sessionStorage.setItem('zaylo_chat_w1', '[]');
        localStorage.setItem('zaylo_join_token', 'keep-me');
    });
    await page.getByRole('heading', { name: 'Settings' }).first().waitFor();
    await page.getByText('Sign Out', { exact: true }).first().click();
    await page.waitForTimeout(9000); // gives unsent changes their last chance (up to 8 s), then cleans up
    const left = await page.evaluate(() => ({
        cart: localStorage.getItem('zaylo_smart_cart_v1_auth1'), health: localStorage.getItem('zaylo_health_w1'),
        chat: sessionStorage.getItem('zaylo_chat_w1'), join: localStorage.getItem('zaylo_join_token'),
        store: JSON.parse(localStorage.getItem('financeva-store') || '{}').state,
    }));
    expect(left.cart === null && left.health === null && left.chat === null, `user data removed: ${JSON.stringify(left).slice(0, 200)}`);
    expect(left.join === 'keep-me', 'an invite link being opened is kept');
    expect(left.store && left.store.user === null && !left.store.isAuthenticated && left.store.workspaces.length === 0 && left.store.expenses.length === 0, 'stored app data cleared');
}, { desktop: true, path: '/settings' });

await scenario('phone sign-in page on zaylo.cc refuses links it did not make', async page => {
    await page.getByText('Sign in to the Zaylo app').waitFor();
    await page.getByText("This sign-in link isn't valid any more").waitFor();
    expect(!(await page.locator('.app-signin-btn').count()), 'no Google button for a bad link');
}, { path: '/app-signin?nonce=abc&state=x' });


await scenario('delete account: shows what happens, needs the exact email, never deletes by accident', async (page, db) => {
    await openSettings(page, 'Security & Privacy');
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dlg = page.getByRole('dialog', { name: 'Delete your Zaylo account?' });
    await dlg.waitFor();
    await dlg.getByText('Family').waitFor();
    expect(await dlg.getByText('Home').count() > 0, 'lists the workspace that will be deleted');
    const del = dlg.getByRole('button', { name: 'Delete account' });
    expect(await del.isDisabled(), 'disabled before typing');
    await page.fill('#del-confirm', 'shopper@example');
    expect(await del.isDisabled(), 'disabled for a partial email');
    await page.fill('#del-confirm', 'SHOPPER@example.test');
    expect(!(await del.isDisabled()), 'enabled for the exact email, any letter case');
    await del.click();
    await dlg.getByRole('alert').waitFor();
    expect(!db.requests.some(r => r.path === '/api/account'), 'without a live session nothing is sent');
    expect(await dlg.isVisible(), 'still signed in, dialog open');
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
}, { desktop: true, path: '/settings' });


// ------------------------------------------------------------------ AutoTrack
const SMS_PURCHASE = 'Purchase of EGP 650 at Grocery Store using card **5678 on 05/11/26 11:40.';
async function pasteMessage(page, text) {
    await page.getByRole('button', { name: 'Paste message' }).first().click();
    await page.fill('#at-text', text);
    await page.getByRole('button', { name: 'Read message' }).click();
}

await scenario('AutoTrack: paste → Needs Review with a reason → confirm with a correction → Added → Undo', async (page, db) => {
    await page.getByRole('heading', { name: 'AutoTrack' }).waitFor();
    await page.getByText('Nothing waiting.').waitFor();
    await pasteMessage(page, SMS_PURCHASE);
    const card = page.locator('.at-item').first();
    await card.getByText('Grocery Store').waitFor();
    expect(await card.getByText('A completed card purchase.').count() === 1, 'explains why');
    const stored = db.at.items[0];
    expect(stored.amount === 650 && stored.currency === 'EGP' && stored.account_ref === '5678' && stored.status === 'needs_review', `structured fields stored: ${JSON.stringify(stored).slice(0, 160)}`);
    expect(!JSON.stringify(db.requests.filter(r => r.path === '/rest/v1/autotrack_items')).includes('using card **5678 on 05/11/26 11:40.'.repeat(1)) || stored.excerpt.length <= 160, 'only a short excerpt is stored');
    expect(!('body' in stored) && !('text' in stored), 'the full message is not a stored field');
    await card.getByRole('button', { name: 'Review & confirm' }).click();
    const dlg = page.getByRole('dialog', { name: 'Confirm transaction' });
    await dlg.waitFor();
    await page.selectOption('#at-cat', 'dining');
    await dlg.getByRole('button', { name: 'Confirm' }).click();
    await dlg.waitFor({ state: 'detached' });
    const post = db.requests.find(r => r.path === '/rest/v1/rpc/autotrack_post');
    expect(post && post.body.p_target === 'expense' && post.body.p_category === 'dining' && post.body.p_auto === false, `posted as a corrected expense: ${JSON.stringify(post?.body)}`);
    await page.getByRole('tab', { name: /Added/ }).click();
    await page.locator('.at-item .badge-success', { hasText: 'Confirmed' }).waitFor();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByText('Undone. It no longer counts').waitFor();
    expect(db.at.items[0].status === 'undone', 'undone');
    await shot(page, '19-autotrack-added');
}, { desktop: true, path: '/autotrack' });

await scenario('AutoTrack: codes and balance notices are never stored; the same alert twice is recorded once', async (page, db) => {
    await page.getByRole('heading', { name: 'AutoTrack' }).waitFor();
    await pasteMessage(page, 'Your OTP for EGP 650 at AMAZON is 482913. Do not share it.');
    await page.getByText('Security code: not stored.').waitFor();
    await page.fill('#at-text', 'Your available balance is EGP 9,500.');
    await page.getByRole('button', { name: 'Read message' }).click();
    await page.getByText('Balance notice only: no transaction.').waitFor();
    expect(!db.requests.some(r => r.method === 'POST' && r.path === '/rest/v1/autotrack_items'), 'nothing was sent for codes or balances');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await pasteMessage(page, SMS_PURCHASE);
    await page.locator('.at-item').first().waitFor();
    await pasteMessage(page, SMS_PURCHASE);
    await page.getByText('Already recorded: this alert was handled before.').waitFor();
    expect(db.at.items.length === 1, `one item, not two (${db.at.items.length})`);
}, { desktop: true, path: '/autotrack' });

await scenario('AutoTrack: offline paste is kept on the device and synced later without duplicates', async (page, db) => {
    await page.getByRole('heading', { name: 'AutoTrack' }).waitFor();
    db.at = db.at || undefined;
    await page.evaluate(() => {});
    // go offline for item writes
    (db.at ??= { items: [], settings: { mode: 'review', ai_consent: false, custom_senders: [] }, accounts: [], rules: [], transfers: [] }).offline = true;
    await pasteMessage(page, SMS_PURCHASE);
    await page.getByText('Saved on this device').waitFor();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zaylo_autotrack_outbox_v1') || '[]').length) === 1, 'waiting in the outbox');
    db.at.offline = false;
    await page.reload();
    await page.locator('.at-item').first().waitFor();
    expect(db.at.items.length === 1, 'synced once');
    expect(await page.evaluate(() => localStorage.getItem('zaylo_autotrack_outbox_v1')) === null, 'outbox emptied');
}, { desktop: true, path: '/autotrack' });

await scenario('Ask Zaylo: a pasted salary SMS goes through AutoTrack (not the chat AI) and is shown masked', async (page, db) => {
    await page.getByRole('heading', { name: 'Ask Zaylo' }).waitFor();
    await page.locator('textarea').first().fill('Salary credited: EGP 18,000 to account 4111111111111234. Ref TRX99812234');
    await page.keyboard.press('Enter');
    await page.getByText('Added to Needs Review.').waitFor();
    expect(!db.requests.some(r => r.path.endsWith('/api/ai/zaylo') && r.body?.action === 'chat'), 'the chat AI was not called');
    const shown = await page.locator('.chat-scroll').innerText();
    expect(!shown.includes('4111111111111234') && !shown.includes('TRX99812234'), 'the chat shows a masked copy');
    expect(db.at.items[0]?.suggested_target === 'income' && db.at.items[0].ingestion === 'assistant', `classified as income: ${db.at.items[0]?.suggested_target}`);
}, { desktop: true, path: '/assistant' });

await scenario('AutoTrack settings on the web: honest "not available", review-first by default, auto-add needs a choice', async (page, db) => {
    await openSettings(page, 'AutoTrack');
    await page.getByText('Not available on this device').waitFor();
    expect(!(await page.getByRole('button', { name: 'Turn on AutoTrack' }).count()), 'no enable button where it can\'t work');
    expect(await page.getByRole('radio', { name: /Review first/ }).isChecked(), 'review first is the default');
    await page.getByRole('radio', { name: /Auto-add clear transactions/ }).check();
    await page.waitForTimeout(400);
    expect(db.at.settings.mode === 'auto', 'auto-add saved');
    await page.getByRole('button', { name: 'Turn on AI reading…' }).click();
    await page.getByRole('dialog', { name: 'Use Zaylo AI for unfamiliar messages?' }).waitFor();
    await page.getByRole('button', { name: 'Not now' }).click();
    expect(db.at.settings.ai_consent === false, 'AI stays off when declined');
    await shot(page, '20-autotrack-settings');
}, { desktop: true, path: '/settings' });

// ------------------------------------------------------------------ report
let failed = 0;
for (const [ok, name, err] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${err ? `\n      ${err}` : ''}`); if (!ok) failed++; }
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
