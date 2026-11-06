/**
 * Zaylo AutoTrack: what a parsed transaction means for the user's money.
 *
 *   income   → Income & Earnings   (only things that are clearly earnings: salary, interest)
 *   expense  → Expenses            (purchases, bills, fees, instalments)
 *   transfer → Transfers           (between the user's own accounts / cash; not income or spending)
 *   review   → Needs Review        (anything that could reasonably be more than one of these)
 *   ignore   → nothing is recorded (codes, adverts, balance notices, declined payments)
 *
 * Direction alone never decides: money in can be a refund, a repayment or a transfer from the
 * user's own account; money out can be a transfer to their own wallet or a cash withdrawal.
 */
import type { CategoryKey } from '../store/useStore';
import type { Channel, ParsedMessage } from './parse';

export type Target = 'income' | 'expense' | 'transfer' | 'review' | 'ignore';

/** An account the user told Zaylo is theirs (for spotting transfers to themselves). */
export interface OwnAccount { id: string; label: string; kind: 'bank' | 'wallet' | 'card' | 'cash'; last4?: string; senderId?: string }

/** A choice the user made earlier for a merchant or person ("Ahmed → transfer", "UBER → transport"). */
export interface LearnedRule { match: string; target?: Exclude<Target, 'ignore'>; category?: CategoryKey }

export interface ClassifyContext {
    ownAccounts: OwnAccount[];
    /** The user's own name(s), as banks print them, to spot "from MOHAMED AHMED". */
    ownNames: string[];
    rules: LearnedRule[];
}

export interface Classification {
    target: Target;
    /** One sentence the user sees: why it went where it went. */
    reason: string;
    category: CategoryKey;
    /** For transfers: which of the user's accounts the money left / arrived at. */
    fromAccountId?: string;
    toAccountId?: string;
    /** May this be added without the user looking at it (if they turned auto-add on)? */
    autoEligible: boolean;
}

const CATEGORY_HINTS: [CategoryKey, RegExp][] = [
    ['groceries', /carrefour|seoudi|spinneys|hyper|kazyon|metro market|gourmet|oscar|kheir zaman|breadfast|rabbit|instashop|grocer|بقال|سوبر ?ماركت|هايبر/i],
    ['dining', /restaurant|cafe|café|coffee|starbucks|costa|cilantro|kfc|mcdonald|pizza|burger|talabat|elmenus|zooba|bazooka|koshary|mo'?men|مطعم|كافيه|قهوة/i],
    ['transport', /uber|careem|didi|indrive|swvl|taxi|fuel|petrol|wataniya|total ?energies|misr petroleum|chillout|gas station|parking|بنزين|وقود|مواصلات/i],
    ['utilities', /vodafone|orange|etisalat|e&|\bwe\b|telecom egypt|electric|electricity|water|natural gas|town gas|internet|كهرباء|مياه|غاز|انترنت|فاتورة/i],
    ['healthcare', /pharma|pharmacy|ezaby|seif|19011|clinic|hospital|doctor|lab|al ?borg|al ?mokhtabar|صيدلية|مستشفى|معمل|دكتور/i],
    ['shopping', /amazon|noon|jumia|zara|h&m|ikea|lc ?waikiki|defacto|b\.?tech|2b|raya|mall|store|shop/i],
    ['entertainment', /netflix|spotify|shahid|osn|anghami|cinema|vox|playstation|steam|apple\.com|google play|youtube/i],
    ['travel', /hotel|airbnb|booking\.com|egyptair|flight|airline|emirates|go ?bus|blue ?bus|marriott|hilton/i],
    ['education', /course|udemy|coursera|school|university|tuition|book|مدرسة|جامعة|مصاريف دراسية/i],
];

export function guessCategory(text: string, channel: Channel): CategoryKey {
    if (channel === 'mobile_recharge' || channel === 'bill_payment') return 'utilities';
    if (channel === 'fee' || channel === 'loan_installment') return 'other';
    return CATEGORY_HINTS.find(([, re]) => re.test(text))?.[0] ?? 'other';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
function sameName(a: string | null, names: string[]) {
    if (!a) return false;
    const x = norm(a);
    return names.some(n => {
        const y = norm(n);
        if (!y) return false;
        // banks often print "MOHAMED A AHMED" or just the first two names
        const parts = y.split(' ').filter(p => p.length > 1);
        return x === y || (parts.length >= 2 && parts.slice(0, 2).every(p => x.includes(p)));
    });
}

function ownAccountFor(p: ParsedMessage, ctx: ClassifyContext, which: 'mine' | 'other'): OwnAccount | undefined {
    const ref = which === 'mine' ? p.accountRef : p.counterpartyRef;
    if (!ref) return which === 'mine' && p.sender ? ctx.ownAccounts.find(a => a.senderId === p.sender!.id && !a.last4) : undefined;
    return ctx.ownAccounts.find(a => a.last4 && a.last4.slice(-ref.length) === ref.slice(-a.last4.length));
}

export function classify(p: ParsedMessage, ctx: ClassifyContext): Classification {
    const text = `${p.counterparty ?? ''}`;
    const category = guessCategory(text, p.channel);
    const out = (target: Target, reason: string, extra: Partial<Classification> = {}): Classification => {
        const autoEligible = (target === 'income' || target === 'expense' || target === 'transfer')
            && p.kind === 'transaction' && p.status === 'completed' && p.direction !== 'unknown'
            && p.amountMinor !== null && Boolean(p.currency) && Boolean(p.sender) && p.confidence >= 0.8
            && extra.autoEligible !== false;
        return { target, reason, category, ...extra, autoEligible };
    };

    // ── not money
    if (p.kind === 'otp') return out('ignore', 'A security code, not a transaction.');
    if (p.kind === 'promo') return out('ignore', 'An advert, not a transaction.');
    if (p.kind === 'balance') return out('ignore', 'A balance notice; no money moved.');
    if (p.kind !== 'transaction') return out('ignore', 'Not a transaction message.');
    if (p.status === 'declined') return out('ignore', 'The payment was declined, so no money moved.');

    // ── the user taught Zaylo what this merchant or person is
    const rule = ctx.rules.find(r => p.counterparty && norm(p.counterparty).includes(norm(r.match)));
    if (rule?.target) {
        return { ...out(rule.target, `You marked "${rule.match}" as ${rule.target === 'review' ? 'always needing a look' : rule.target} before.`), category: rule.category ?? category };
    }

    if (p.amountMinor === null || !p.currency) return out('review', 'The amount or currency couldn\'t be read for certain.');
    if (p.direction === 'unknown') return out('review', 'It isn\'t clear whether money came in or went out.');
    if (p.status === 'pending') return out('review', 'The bank says this is still pending; it may change or be cancelled.');
    if (p.status === 'reversed' || p.channel === 'refund') {
        return out('review', p.direction === 'credit'
            ? 'A refund or reversal: it reduces earlier spending rather than being income.'
            : 'A reversal; check which earlier transaction it cancels.');
    }

    const mine = ownAccountFor(p, ctx, 'mine');
    const otherIsMine = ownAccountFor(p, ctx, 'other');
    const fromMe = sameName(p.counterparty, ctx.ownNames);

    if (p.direction === 'debit') {
        switch (p.channel) {
            case 'atm_withdrawal':
                return out('transfer', 'Cash taken out at an ATM moves your own money to cash; it isn\'t spending yet.', { fromAccountId: mine?.id, toAccountId: ctx.ownAccounts.find(a => a.kind === 'cash')?.id });
            case 'instapay': case 'wallet_transfer': case 'bank_transfer':
                if (otherIsMine || fromMe) return out('transfer', 'Sent to one of your own accounts.', { fromAccountId: mine?.id, toAccountId: otherIsMine?.id });
                return out('review', 'Money sent to someone else: it could be a payment, a loan or a gift.', { fromAccountId: mine?.id });
            case 'card_purchase': case 'online_purchase':
                return out('expense', 'A completed card purchase.', { fromAccountId: mine?.id });
            case 'bill_payment': return out('expense', 'A bill payment.', { fromAccountId: mine?.id });
            case 'mobile_recharge': return out('expense', 'A mobile top-up.', { fromAccountId: mine?.id });
            case 'fee': return out('expense', 'A bank or wallet fee.', { fromAccountId: mine?.id });
            case 'loan_installment': return out('expense', 'A loan or instalment payment.', { fromAccountId: mine?.id });
            default: return out('review', 'Money went out, but the message doesn\'t say what for.', { fromAccountId: mine?.id });
        }
    }

    // credit
    switch (p.channel) {
        case 'salary': return out('income', 'Salary or payroll.', { toAccountId: mine?.id });
        case 'interest': return out('income', 'Interest or profit paid by the bank.', { toAccountId: mine?.id });
        case 'cashback': return out('review', 'Cashback lowers what you spent; decide whether to count it as income.', { toAccountId: mine?.id });
        case 'cash_deposit': return out('transfer', 'Cash you deposited: your own money moving into the account.', { toAccountId: mine?.id, fromAccountId: ctx.ownAccounts.find(a => a.kind === 'cash')?.id });
        case 'instapay': case 'wallet_transfer': case 'bank_transfer':
            if (otherIsMine || fromMe) return out('transfer', 'From one of your own accounts.', { toAccountId: mine?.id, fromAccountId: otherIsMine?.id });
            return out('review', 'Money received from someone: it could be earnings, a repayment, a refund or a gift.', { toAccountId: mine?.id });
        default: return out('review', 'Money came in, but the message doesn\'t say what it is.', { toAccountId: mine?.id });
    }
}
