/**
 * AutoTrack parsing, classification and duplicate checks.
 *
 * The messages below are SYNTHETIC: written in the style of Egyptian bank and wallet alerts
 * (English and Arabic) to exercise the rules. They are not copies of real messages, and exact
 * formats vary by bank, so real-message coverage must still be confirmed with users' samples.
 */
import { describe, it, expect } from 'vitest';
import { parseMessage, amountToMinor, normaliseText } from '../../src/autotrack/parse';
import { classify, type ClassifyContext } from '../../src/autotrack/classify';
import { lookupSender } from '../../src/autotrack/senders';
import { fingerprint, findDuplicate, type KnownTx } from '../../src/autotrack/dedupe';

const AT = new Date('2026-11-05T12:30:00Z'); // 14:30 Cairo
const ctx: ClassifyContext = {
    ownAccounts: [
        { id: 'acc-cib', label: 'CIB current', kind: 'bank', last4: '4821', senderId: 'cib' },
        { id: 'acc-nbe', label: 'NBE savings', kind: 'bank', last4: '7730', senderId: 'nbe' },
        { id: 'acc-vf', label: 'Vodafone Cash', kind: 'wallet', last4: '5566', senderId: 'vfcash' },
        { id: 'acc-cash', label: 'Cash', kind: 'cash' },
    ],
    ownNames: ['Mohamed Ahmed Nagah'],
    rules: [],
};
const run = (sender: string, text: string, c: ClassifyContext = ctx) => { const p = parseMessage(text, sender, AT); return { p, c: classify(p, c) }; };

describe('amounts and text', () => {
    it.each([
        ['1,250.00', 125000], ['1250', 125000], ['1250.5', 125050], ['15,000', 1500000], ['٢٥٠٫٧٥', 25075],
        ['1.234,50', 123450], ['0', null], ['12.345', null], ['1,2,3', null],
    ])('%s → %s', (raw, minor) => expect(amountToMinor(raw)).toBe(minor));
    it('turns Arabic digits and direction marks into plain text', () => {
        expect(normaliseText('‏مبلغ ١٥٠ جنيه')).toBe('مبلغ 150 جنيه');
    });
});

describe('senders', () => {
    it.each([['CIB', 'cib'], ['NBE', 'nbe'], ['Banque Misr', 'banquemisr'], ['VF-Cash', 'vfcash'], ['InstaPay', 'instapay'], ['CIB-Alerts', 'cib']])('%s', (id, want) => expect(lookupSender(id)?.id).toBe(want));
    it('a phone number is a person, never a bank', () => expect(lookupSender('+201001234567')).toBeNull());
    it('unknown names are not guessed', () => expect(lookupSender('PIZZAHUT')).toBeNull());
    it('a sender the user added is recognised', () => expect(lookupSender('MyBank', [{ id: 'MyBank', name: 'My Bank', kind: 'bank', currency: 'EGP' }])?.custom).toBe(true));
});

describe('spending → Expenses', () => {
    it('English card purchase with merchant, card, date and balance', () => {
        const { p, c } = run('CIB', 'Your credit card ending with 4821 was charged for EGP 1,250.00 at CARREFOUR MAADI on 05/11/26 14:22. Available limit EGP 23,410.50');
        expect(p).toMatchObject({ kind: 'transaction', direction: 'debit', status: 'completed', channel: 'card_purchase', amountMinor: 125000, currency: 'EGP', accountRef: '4821', counterparty: 'CARREFOUR MAADI', balanceAfterMinor: 2341050, occurredAtFromText: true });
        expect(p.occurredAt).toBe('2026-11-05T12:22:00.000Z');
        expect(c).toMatchObject({ target: 'expense', category: 'groceries', autoEligible: true, fromAccountId: 'acc-cib' });
    });
    it('Arabic debit with merchant after لدى', () => {
        const { p, c } = run('NBE', 'تم خصم مبلغ 350.00 جنيه من حسابكم رقم ***7730 لدى UBER BV في 05/11/2026 الرصيد المتاح 12,000.00 جنيه');
        expect(p).toMatchObject({ direction: 'debit', amountMinor: 35000, currency: 'EGP', accountRef: '7730', counterparty: 'UBER BV' });
        expect(c).toMatchObject({ target: 'expense', category: 'transport', autoEligible: true });
    });
    it('a bill paid through Fawry', () => {
        const { c } = run('Fawry', 'Payment of EGP 920.00 for electricity bill was successful. Ref: FW8812377');
        expect(c).toMatchObject({ target: 'expense', category: 'utilities' });
    });
    it('a bank fee', () => {
        const { p, c } = run('CIB', 'Annual fee of EGP 450.00 has been debited from your account **4821');
        expect(p.channel).toBe('fee');
        expect(c.target).toBe('expense');
    });
});

describe('income only when it is clearly earnings', () => {
    it('salary → Income', () => {
        const { p, c } = run('NBE', 'Your account ***7730 has been credited with EGP 52,000.00 SALARY on 25/10/2026');
        expect(p).toMatchObject({ direction: 'credit', channel: 'salary', amountMinor: 5200000 });
        expect(c).toMatchObject({ target: 'income', autoEligible: true });
    });
    it('Arabic salary → Income', () => {
        expect(run('Banque Misr', 'تم إيداع الراتب بمبلغ 48,500 جنيه في حسابك رقم 9911').c.target).toBe('income');
    });
    it('interest → Income', () => {
        expect(run('NBE', 'Interest of EGP 1,830.25 has been credited to your account ***7730').c.target).toBe('income');
    });
    it('money from another person → Needs Review, not income', () => {
        const { p, c } = run('InstaPay', 'You have received EGP 500.00 from AHMED SAMIR via InstaPay. Ref 99812234');
        expect(p).toMatchObject({ direction: 'credit', channel: 'instapay', counterparty: 'AHMED SAMIR', reference: '99812234' });
        expect(c.target).toBe('review');
        expect(c.reason).toMatch(/repayment|gift/);
    });
    it('a refund → Needs Review (it reduces spending, it is not earnings)', () => {
        expect(run('CIB', 'A refund of EGP 799.00 from NOON has been credited to your card ending 4821').c).toMatchObject({ target: 'review' });
    });
    it('cashback → Needs Review', () => {
        expect(run('CIB', 'Cashback of EGP 35.00 has been credited to your card ending 4821').c.target).toBe('review');
    });
});

describe('own money moving → Transfers', () => {
    it('to the user\'s own wallet (by number) → Transfer', () => {
        const { c } = run('CIB', 'EGP 2,000.00 transferred from your account **4821 to account **5566 via InstaPay on 05/11/2026');
        expect(c).toMatchObject({ target: 'transfer', fromAccountId: 'acc-cib', toAccountId: 'acc-vf' });
    });
    it('to the user by name → Transfer', () => {
        expect(run('NBE', 'You have sent EGP 3,000.00 to MOHAMED AHMED NAGAH via InstaPay from account ***7730').c.target).toBe('transfer');
    });
    it('from the user\'s own account → Transfer, not income', () => {
        expect(run('CIB', 'Your account **4821 has been credited with EGP 3,000.00 transferred from account **7730').c).toMatchObject({ target: 'transfer', toAccountId: 'acc-cib', fromAccountId: 'acc-nbe' });
    });
    it('ATM cash → Transfer to Cash', () => {
        expect(run('CIB', 'Cash withdrawal of EGP 1,000.00 from ATM using card ending 4821 on 05/11/26 13:05').c).toMatchObject({ target: 'transfer', toAccountId: 'acc-cash' });
    });
    it('money sent to someone else → Needs Review', () => {
        expect(run('VF-Cash', 'تم تحويل مبلغ 200 جنيه إلى رقم 01012345678 بنجاح. رصيدك الحالي 1,500 جنيه').c.target).toBe('review');
    });
});

describe('never recorded', () => {
    it.each([
        ['CIB', 'Your OTP for the purchase of EGP 1,250.00 at AMAZON is 482913. Do not share it with anyone.', 'otp'],
        ['NBE', 'كود التفعيل الخاص بك هو 5521 لا تشارك هذا الكود', 'otp'],
        ['CIB', 'Enjoy 20% discount up to EGP 500 at Zara with your CIB card! Limited time offer.', 'promo'],
        ['QNB', 'Your available balance is EGP 12,345.67 as of 05/11/2026', 'balance'],
        ['Ahmed', 'Hey, are we still meeting at 7?', 'other'],
    ])('%s: %s', (sender, text, kind) => {
        const { p, c } = run(sender, text);
        expect(p.kind).toBe(kind);
        expect(c.target).toBe('ignore');
    });
    it('a declined payment is ignored', () => {
        const { p, c } = run('CIB', 'Your transaction of EGP 4,999.00 at B.TECH using card ending 4821 was declined due to insufficient funds.');
        expect(p.status).toBe('declined');
        expect(c.target).toBe('ignore');
    });
});

describe('uncertain → Needs Review, never auto-added', () => {
    it('pending', () => expect(run('CIB', 'A transaction of EGP 600.00 at SHELL is pending on card ending 4821').c).toMatchObject({ target: 'review', autoEligible: false }));
    it('an unknown sender is never auto-added', () => {
        const { c } = run('RandomBank', 'Your card ending 1111 was charged EGP 99.00 at KFC');
        expect(c.autoEligible).toBe(false);
    });
    it('no currency printed', () => {
        const { p } = run('CIB', 'Your card ending 4821 was charged 250.00 at KFC');
        expect(p.issues).toContain('No currency was printed.');
        expect(p.currency).toBe('EGP'); // the bank's home currency, with lower confidence
        expect(p.confidence).toBeLessThan(0.85);
    });
    it('a far-away date in the text falls back to arrival time, with a note', () => {
        const { p } = run('CIB', 'Your card ending 4821 was charged EGP 80.00 at COSTA on 05/11/24 10:00');
        expect(p.occurredAtFromText).toBe(false);
        expect(p.issues.join(' ')).toMatch(/far from when it arrived/);
    });
    it('a learned rule wins', () => {
        const c2 = { ...ctx, rules: [{ match: 'AHMED SAMIR', target: 'transfer' as const }] };
        expect(run('InstaPay', 'You have received EGP 500.00 from AHMED SAMIR via InstaPay', c2).c.target).toBe('transfer');
    });
});

describe('duplicates', () => {
    const msg = 'Your credit card ending with 4821 was charged for EGP 1,250.00 at CARREFOUR MAADI on 05/11/26 14:22.';
    it('the same SMS twice has the same fingerprint', async () => {
        const p = parseMessage(msg, 'CIB', AT);
        const fp = await fingerprint(p, msg);
        expect(await fingerprint(parseMessage(msg, 'CIB', new Date(AT.getTime() + 60_000)), msg)).toBe(fp);
        const known: KnownTx[] = [{ id: 'x', fingerprint: fp, source: 'autotrack', amountMinor: 125000, currency: 'EGP', direction: 'debit', occurredAt: p.occurredAt }];
        expect(findDuplicate(p, fp, known)?.kind).toBe('exact');
    });
    it('the bank and InstaPay announcing one transfer is an echo', async () => {
        const a = parseMessage('EGP 500.00 sent to AHMED SAMIR via InstaPay from account **4821', 'CIB', AT);
        const b = parseMessage('You have sent EGP 500.00 to AHMED SAMIR via InstaPay', 'InstaPay', new Date(AT.getTime() + 120_000));
        const known: KnownTx[] = [{ id: 'a', fingerprint: await fingerprint(a, 'x'), source: 'autotrack', amountMinor: 50000, currency: 'EGP', direction: 'debit', occurredAt: a.occurredAt, senderId: 'cib' }];
        expect(findDuplicate(b, await fingerprint(b, 'y'), known)?.kind).toBe('echo');
    });
    it('an expense the user already typed is a possible duplicate', async () => {
        const p = parseMessage(msg, 'CIB', AT);
        const known: KnownTx[] = [{ id: 'm', source: 'manual', amountMinor: 125000, currency: 'EGP', direction: 'debit', occurredAt: '2026-11-05T09:00:00Z', label: 'Carrefour' }];
        expect(findDuplicate(p, await fingerprint(p, msg), known)?.kind).toBe('manual');
    });
    it('a different amount is not a duplicate', async () => {
        const p = parseMessage(msg, 'CIB', AT);
        expect(findDuplicate(p, await fingerprint(p, msg), [{ id: 'm', source: 'manual', amountMinor: 125001, currency: 'EGP', direction: 'debit', occurredAt: p.occurredAt }])).toBeNull();
    });
});
