/**
 * Zaylo AutoTrack: bank / wallet SMS → structured transaction facts.
 *
 * Deterministic and on-device: no network, no AI. It only reads what the message says and
 * records how sure it is. Deciding what a transaction *means* (income, spending, transfer…)
 * happens in classify.ts.
 *
 * Amounts are integer minor units (piastres/cents) so nothing drifts through floating point.
 */
import { lookupSender, type SenderInfo } from './senders';

export type Direction = 'debit' | 'credit' | 'unknown';
export type TxStatus = 'completed' | 'pending' | 'declined' | 'reversed';
/** What kind of message it is, before any judgement about income or spending. */
export type MessageKind =
    | 'transaction'   // money moved
    | 'otp'           // one-time code / verification
    | 'promo'         // marketing
    | 'balance'       // balance or statement notice only
    | 'other';        // not financial, or unreadable

/** How the money moved, as far as the text says. */
export type Channel =
    | 'card_purchase' | 'online_purchase' | 'atm_withdrawal' | 'cash_deposit'
    | 'instapay' | 'wallet_transfer' | 'bank_transfer' | 'bill_payment' | 'mobile_recharge'
    | 'salary' | 'interest' | 'cashback' | 'refund' | 'fee' | 'loan_installment' | 'unknown';

export interface ParsedMessage {
    kind: MessageKind;
    sender: SenderInfo | null;
    direction: Direction;
    status: TxStatus;
    channel: Channel;
    amountMinor: number | null;
    currency: string | null;
    /** Merchant for purchases, the other party for transfers (as printed). */
    counterparty: string | null;
    /** Last digits of the user's account / card / wallet the message is about. */
    accountRef: string | null;
    /** Last digits of the other account in a transfer, when printed. */
    counterpartyRef: string | null;
    reference: string | null;
    /** When the transaction happened: from the text if printed, else when the SMS arrived. */
    occurredAt: string;
    occurredAtFromText: boolean;
    balanceAfterMinor: number | null;
    feeMinor: number | null;
    language: 'ar' | 'en';
    /** 0–1: how complete and unambiguous the extraction is. */
    confidence: number;
    /** Plain-language notes on anything unclear (shown in Needs Review). */
    issues: string[];
}

// ─────────────────────────────────────────────────────────────── text helpers

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function normaliseText(s: string): string {
    return String(s ?? '')
        .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)))
        .replace(/[۰-۹]/g, d => String(FA_DIGITS.indexOf(d)))
        .replace(/٫/g, '.').replace(/٬/g, ',')
        .replace(/[‎‏‪-‮⁦-⁩]/g, '') // direction marks
        .replace(/\s+/g, ' ')
        .trim();
}

const CURRENCY_TOKENS: [RegExp, string][] = [
    [/^(egp|le|l\.e\.?|ج\.?م\.?|جم|جنيه|جنيها|جنيهات|جنية|ج)$/i, 'EGP'],
    [/^(usd|us\$|\$|دولار)$/i, 'USD'],
    [/^(eur|€|يورو)$/i, 'EUR'],
    [/^(gbp|£|استرليني)$/i, 'GBP'],
    [/^(sar|ريال|ر\.س)$/i, 'SAR'],
    [/^(aed|درهم|د\.إ)$/i, 'AED'],
    [/^(kwd|دينار كويتي)$/i, 'KWD'],
];
export function currencyFrom(token: string | undefined | null): string | null {
    const t = String(token ?? '').trim().replace(/[.:]+$/, '');
    if (!t) return null;
    for (const [re, code] of CURRENCY_TOKENS) if (re.test(t)) return code;
    return /^[A-Z]{3}$/.test(t) ? t : null;
}

/**
 * "1,234.50" → 123450. Accepts "1234", "1,234", "1234.5", "1 234.50". Rejects "1.234" style
 * thousands (ambiguous) unless followed by 2 decimals, e.g. "1.234,50" (European) → 123450.
 */
export function amountToMinor(raw: string): number | null {
    let s = normaliseText(raw).replace(/\s/g, '');
    if (!/^\d[\d.,]*$/.test(s)) return null;
    const euro = /^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s);
    if (euro) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,(?=\d{3}(\D|$))/g, '');
    if (/,/.test(s)) s = s.replace(',', '.');
    if ((s.match(/\./g) || []).length > 1) return null;
    const [int, frac = ''] = s.split('.');
    if (frac.length > 2) return null;
    const minor = Number(int) * 100 + Number((frac + '00').slice(0, 2));
    return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

// Amount next to a currency, either order: "EGP 1,250.00", "1,250.00 EGP", "مبلغ 250 جنيه"
const NUM = String.raw`(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const CUR = String.raw`(EGP|USD|EUR|GBP|SAR|AED|KWD|L\.?E\.?|US\$|\$|€|£|ج\.?م\.?|جم|جنيه(?:ا|ات)?|جنية|دولار|يورو|ريال|درهم)`;
const AMOUNT_RES = [
    new RegExp(`${CUR}\\s?${NUM}`, 'giu'),
    new RegExp(`${NUM}\\s?${CUR}`, 'giu'),
];

interface AmountHit { minor: number; currency: string | null; index: number; text: string }
const BARE_AMOUNT = new RegExp(String.raw`(?:charged(?: for)?|debited(?: with| by)?|credited(?: with| by)?|amount(?: of)?|of|مبلغ|بمبلغ|قيمة)\s*(?:مقداره\s*)?` + NUM + String.raw`(?!\s*(?:\d|%|[/:-]))`, 'giu');
function amountsIn(text: string): AmountHit[] {
    const hits: AmountHit[] = [];
    for (const [i, re] of AMOUNT_RES.entries()) {
        re.lastIndex = 0;
        for (let m = re.exec(text); m; m = re.exec(text)) {
            const num = i === 0 ? m[2] : m[1];
            const cur = i === 0 ? m[1] : m[2];
            const minor = amountToMinor(num);
            if (minor) hits.push({ minor, currency: currencyFrom(cur), index: m.index, text: m[0] });
        }
    }
    if (!hits.length) {
        BARE_AMOUNT.lastIndex = 0;
        for (let m = BARE_AMOUNT.exec(text); m; m = BARE_AMOUNT.exec(text)) {
            const minor = amountToMinor(m[1]);
            if (minor) hits.push({ minor, currency: null, index: m.index + m[0].indexOf(m[1]), text: m[1] });
        }
    }
    // the same amount matched by both patterns → keep one
    return hits.sort((a, b) => a.index - b.index).filter((h, i, all) => !all.slice(0, i).some(p => Math.abs(p.index - h.index) < 4));
}

const has = (t: string, re: RegExp) => re.test(t);

// ─────────────────────────────────────────────────────────────── vocabulary

const RE = {
    otp: /\b(otp|one[- ]time|verification code|passcode|pin code|activation code)\b|كود التفعيل|رمز التحقق|كلمة المرور لمرة واحدة|الرقم السري المؤقت|كود التحقق|لا تشارك|do not share|don't share/i,
    promo: /\b(offer|discount|promo|win|congratulations|enjoy|limited time|apply now|pre-?approved|cashback up to|instalments? starting)\b|عرض|خصم يصل|خصومات|اشترك الآن|استمتع|فرصة|مبروك|قسط يبدأ|احصل على/i,
    declined: /\b(declined|rejected|unsuccessful|failed|was not completed|insufficient funds|could not be processed)\b|مرفوض|رفض|لم تتم|فشل|غير ناجح|رصيد غير كاف/i,
    pending: /\b(pending|on hold|authori[sz]ation hold|being processed|under process)\b|قيد التنفيذ|معلق|جاري التنفيذ|تحت التنفيذ/i,
    reversed: /\b(revers(ed|al)|refund(ed)?|returned|chargeback|credited back)\b|استرداد|مرتجع|إلغاء العملية|تم رد|عكس العملية/i,
    debit: /\b(debited|charged|spent|purchase|paid|payment|withdraw(n|al)?|transferred to|transferred from your|sent to|sent|deducted|used for)\b|تم خصم|خصم|سحب|شراء|مشتريات|دفع|سداد|تحويل (?:مبلغ .{0,30})?(?:إلى|الى|لـ|ل )|تم إرسال|تم ارسال|ارسال/i,
    credit: /\b(credited|received|deposit(ed)?|added to your|transferred to your|incoming|refund)\b|تم إيداع|تم ايداع|إيداع|ايداع|إضافة|اضافة|تم استلام|استلام|وارد|تحويل وارد|تم تحويل .{0,40}(?:إلى حسابك|الى حسابك|لحسابك)/i,
    balanceOnly: /\b(your (?:available )?balance is|balance as of|statement (?:is ready|for))\b|رصيدك (?:الحالي )?هو|رصيد حسابك|كشف الحساب/i,
    atm: /\b(atm|cash withdrawal)\b|ماكينة|صراف|سحب نقدي/i,
    cashDeposit: /\bcash deposit\b|إيداع نقدي|ايداع نقدي/i,
    instapay: /instapay|انستاباي|إنستاباي|انستا باي|\bIPN\b/i,
    wallet: /\b(vodafone cash|etisalat cash|e& cash|orange cash|we pay|wallet)\b|فودافون كاش|محفظة|المحفظة|اتصالات كاش|اورنج كاش/i,
    bill: /\b(bill|fawry|electricity|water|gas bill|internet|utility)\b|فاتورة|فوري|كهرباء|مياه|غاز|انترنت/i,
    recharge: /\b(recharge|top[- ]?up|mobile credit)\b|شحن رصيد|كارت شحن|شحن/i,
    salary: /\b(salary|payroll|sal(?:ary)? credit|wages)\b|راتب|مرتب|الراتب|المرتب|رواتب/i,
    interest: /\b(interest|profit (?:paid|credited)|coupon)\b|فوائد|فائدة|عائد|أرباح الوديعة|ارباح/i,
    cashback: /\bcash ?back\b|كاش باك|استرجاع نقدي/i,
    fee: /\b(fee|fees|charge for|commission|annual fee|stamp duty|vat on)\b|رسوم|عمولة|مصاريف (?:إدارية|ادارية)|ضريبة/i,
    loan: /\b(loan|instal?lment|installment|EMI)\b|قرض|قسط|أقساط|اقساط/i,
    online: /\b(online|e-?commerce|internet purchase|www\.|\.com)\b|أونلاين|اونلاين|عبر الإنترنت/i,
    card: /\bcard\b|بطاقة|كارت/i,
};

// "ending 1234", "**1234", "xxxx1234", "رقم ***1234", "المنتهية بـ 1234"
const ACCOUNT_RE = /(?:ending(?: with| in)?|ends with|no\.?|number|acct\.?|account|card|a\/c|بطاقة|حساب|حسابكم|حسابك|رقم|المنتهي(?:ة)? (?:ب|بـ|برقم))\s*[:#]?\s*(?:[*xX•.]{2,}\s?)?(\d{3,4})\b|[*xX•]{2,}\s?(\d{3,4})\b/i;
const COUNTERPARTY_ACCOUNT_RE = /(?:to|from|إلى|الى|من)\s+(?:account|acct|a\/c|حساب|رقم)?\s*[:#]?\s*[*xX•]{2,}\s?(\d{3,4})\b/i;
const PHONE_RE = /\b(01[0125]\d{8}|\+?201[0125]\d{8})\b/;
const REF_RE = /(?:ref(?:erence)?(?: no\.?| number)?|trx(?: id)?|txn(?: id)?|transaction id|رقم العملية|رقم المرجع|مرجع)\s*[:#.]?\s*([A-Z0-9-]{5,24})/i;

// Merchant / counterparty after a preposition, in Latin or Arabic letters
const MERCHANT_RES = [
    /\b(?:at|@)\s+([A-Z0-9][A-Z0-9 &'.\-*/]{1,40}?)(?=\s+(?:on|at|in|for|via|using|with|ref|dated|card|\d{1,2}[/-])|[.,;]|$)/i,
    /(?:لدى|لدي|عند|في)\s+([A-Za-z0-9][A-Za-z0-9 &'.\-*/]{1,40}?)(?=\s+(?:في|بتاريخ|يوم|الساعة|رصيد)|[.,;،]|$)/,
    /(?:لدى|لدي|عند)\s+([؀-ۿ][؀-ۿ ]{1,30}?)(?=\s+(?:في|بتاريخ|يوم|الساعة|رصيد)|[.,;،]|$)/,
];
const PARTY_TO_RES = [
    /\b(?:to|sent to|transferred to|paid to)\s+([A-Z][A-Za-z .'-]{1,40}?|\d{11})(?=\s+(?:on|via|using|ref|from|at|account|\d{1,2}[/-])|[.,;]|$)/i,
    /(?:إلى|الى|لـ)\s+([؀-ۿA-Za-z][؀-ۿA-Za-z .'-]{1,40}?|\d{11})(?=\s+(?:عبر|بنجاح|في|بتاريخ|رقم|من|رصيد)|[.,;،]|$)/,
];
const PARTY_FROM_RES = [
    /\b(?:from|by)\s+([A-Z][A-Za-z .'-]{1,40}?|\d{11})(?=\s+(?:on|via|using|ref|to|account|\d{1,2}[/-])|[.,;]|$)/i,
    /(?:من)\s+([؀-ۿA-Za-z][؀-ۿA-Za-z .'-]{1,40}?|\d{11})(?=\s+(?:عبر|بنجاح|في|بتاريخ|رقم|إلى|الى|رصيد)|[.,;،]|$)/,
];

function firstMatch(text: string, res: RegExp[]): string | null {
    for (const re of res) {
        const m = text.match(re);
        const v = m?.[1]?.trim().replace(/\s{2,}/g, ' ').replace(/[*.-]+$/, '').trim();
        if (v && v.length >= 2 && !/^(your|the|you|حسابك|حسابكم|account)$/i.test(v)) return v;
    }
    return null;
}

// "05/11/26 14:22", "05-11-2026", "2026-11-05 14:22:05", "05NOV26", "5 Nov 2026"
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function dateIn(text: string, receivedAt: Date): { iso: string; fromText: boolean; issue?: string } {
    const time = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(am|pm|ص|م)?/i);
    let y: number | undefined, mo: number | undefined, d: number | undefined;
    let m = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    if (!m && (m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/))) {
        // Egyptian banks print day/month/year
        d = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    }
    if (!m && (m = text.match(/\b(\d{1,2})\s?-?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?-?(\d{2,4})?\b/i))) {
        d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : receivedAt.getFullYear();
    }
    if (y && mo && d && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        let hh = time ? +time[1] : 12;
        const mm = time ? +time[2] : 0;
        const ap = time?.[4]?.toLowerCase();
        if ((ap === 'pm' || ap === 'م') && hh < 12) hh += 12;
        if ((ap === 'am' || ap === 'ص') && hh === 12) hh = 0;
        // Message times are Cairo local time; build the instant from that wall-clock time
        const local = new Date(Date.UTC(y, mo - 1, d, hh, mm, time?.[3] ? +time[3] : 0));
        const iso = new Date(local.getTime() - cairoOffsetMinutes(local) * 60_000).toISOString();
        const drift = Math.abs(new Date(iso).getTime() - receivedAt.getTime());
        if (drift > 45 * 86_400_000) return { iso: receivedAt.toISOString(), fromText: false, issue: 'The date in the message is far from when it arrived, so the arrival time was used.' };
        return { iso, fromText: true };
    }
    return { iso: receivedAt.toISOString(), fromText: false };
}

/** Cairo's offset from UTC (minutes) at a moment, using the platform's time-zone data. */
function cairoOffsetMinutes(at: Date): number {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
        const g = (t: string) => Number(parts.find(p => p.type === t)?.value);
        const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
        return Math.round((asUtc - at.getTime()) / 60_000);
    } catch { return 120; }
}

// ─────────────────────────────────────────────────────────────── parse

export function parseMessage(rawText: string, senderId: string | null | undefined, receivedAt: Date = new Date()): ParsedMessage {
    const text = normaliseText(rawText);
    const sender = lookupSender(senderId);
    const language: 'ar' | 'en' = /[؀-ۿ]/.test(text) && (text.match(/[؀-ۿ]/g) || []).length > (text.match(/[A-Za-z]/g) || []).length ? 'ar' : 'en';
    const issues: string[] = [];
    const base: ParsedMessage = {
        kind: 'other', sender, direction: 'unknown', status: 'completed', channel: 'unknown',
        amountMinor: null, currency: null, counterparty: null, accountRef: null, counterpartyRef: null, reference: null,
        occurredAt: receivedAt.toISOString(), occurredAtFromText: false, balanceAfterMinor: null, feeMinor: null,
        language, confidence: 0, issues,
    };
    if (!text) return base;

    // Never treat codes or marketing as money, whatever amounts they mention
    if (has(text, RE.otp)) return { ...base, kind: 'otp' };
    const amounts = amountsIn(text);
    const debitWord = has(text, RE.debit), creditWord = has(text, RE.credit);
    if (has(text, RE.promo) && !(/\b(debited|credited|charged)\b|تم خصم|تم إيداع|تم ايداع/i.test(text))) return { ...base, kind: 'promo' };
    if (!amounts.length) return { ...base, kind: has(text, RE.balanceOnly) ? 'balance' : 'other' };
    if (has(text, RE.balanceOnly) && !debitWord && !creditWord) return { ...base, kind: 'balance' };
    const statusWord = has(text, RE.declined) || has(text, RE.pending);
    if (!debitWord && !creditWord && !statusWord && !has(text, RE.salary) && !has(text, RE.atm)) return { ...base, kind: 'other' };

    // ── amounts: the transaction amount comes first; a later one after "balance" is the balance
    const balIdx = text.search(/\b(available (?:balance|limit)|balance|bal\.?|avl\.? ?bal)\b|رصيد(?:ك|كم)? (?:الحالي|المتاح|المتبقي)?|الرصيد|الحد المتاح/i);
    const txAmounts = amounts.filter(a => balIdx < 0 || a.index < balIdx);
    const tx = txAmounts[0] ?? amounts[0];
    const balance = balIdx >= 0 ? amounts.find(a => a.index > balIdx) : undefined;
    const feeHit = text.match(/(?:fees?|commission|رسوم|عمولة)\s*[:]?\s*(?:of\s*)?/i);
    const fee = feeHit ? amounts.find(a => a.index > (feeHit.index ?? 0) && a !== tx) : undefined;

    // ── direction & status
    let direction: Direction = 'unknown';
    const debitPos = text.search(RE.debit), creditPos = text.search(RE.credit);
    if (debitWord && !creditWord) direction = 'debit';
    else if (creditWord && !debitWord) direction = 'credit';
    else if (debitWord && creditWord) {
        // "transferred to your account" / "credited back" read as credit; otherwise the first verb wins
        if (/to your (account|card|wallet)|إلى حسابك|الى حسابك|لحسابك|credited back/i.test(text)) direction = 'credit';
        else direction = debitPos <= creditPos ? 'debit' : 'credit';
        issues.push('The message mentions both money in and money out.');
    } else if (has(text, RE.salary)) direction = 'credit';
    else if (has(text, RE.atm)) direction = 'debit';
    else if (statusWord && /\b(at|transaction|purchase)\b|لدى|عملية/i.test(text)) direction = 'debit'; // "your transaction at X was declined / is pending"

    let status: TxStatus = 'completed';
    if (has(text, RE.declined)) status = 'declined';
    else if (has(text, RE.pending)) status = 'pending';
    else if (has(text, RE.reversed)) status = 'reversed';

    // ── channel
    let channel: Channel = 'unknown';
    if (status === 'reversed' || /\brefund/i.test(text) || /استرداد|مرتجع/.test(text)) channel = 'refund';
    else if (has(text, RE.salary)) channel = 'salary';
    else if (has(text, RE.cashback)) channel = 'cashback';
    else if (has(text, RE.interest) && direction === 'credit') channel = 'interest';
    else if (has(text, RE.atm)) channel = 'atm_withdrawal';
    else if (has(text, RE.cashDeposit)) channel = 'cash_deposit';
    else if (has(text, RE.loan) && direction === 'debit') channel = 'loan_installment';
    else if (has(text, RE.fee) && !has(text, RE.card) && direction === 'debit' && !feeHit?.index) channel = 'fee';
    else if (has(text, RE.recharge)) channel = 'mobile_recharge';
    else if (has(text, RE.bill)) channel = 'bill_payment';
    else if (has(text, RE.instapay)) channel = 'instapay';
    else if (has(text, RE.wallet) || sender?.kind === 'wallet') channel = 'wallet_transfer';
    else if (/transfer|حوال|تحويل/i.test(text)) channel = 'bank_transfer';
    else if (has(text, RE.online)) channel = 'online_purchase';
    else if (has(text, RE.card) || /\b(purchase|charged|pos)\b|شراء|مشتريات/i.test(text)) channel = 'card_purchase';
    else if (direction === 'debit' && firstMatch(text, MERCHANT_RES)) channel = 'card_purchase';
    if (channel === 'fee' && fee) channel = 'unknown';
    if (/^(?:fees?|رسوم)/i.test(text) || /\b(annual fee|card fee|account maintenance|stamp duty)\b|رسوم (?:سنوية|إدارية|ادارية|إصدار|اصدار|تجديد)/i.test(text)) channel = 'fee';

    // ── who / where / which account
    const counterparty = (channel === 'card_purchase' || channel === 'online_purchase' || channel === 'bill_payment' || channel === 'mobile_recharge' || channel === 'fee' || channel === 'refund' || channel === 'loan_installment')
        ? firstMatch(text, MERCHANT_RES) ?? (direction === 'debit' ? firstMatch(text, PARTY_TO_RES) : null)
        : direction === 'credit' ? firstMatch(text, PARTY_FROM_RES) : firstMatch(text, PARTY_TO_RES) ?? firstMatch(text, MERCHANT_RES);
    const acct = text.match(ACCOUNT_RE);
    const cpAcct = text.match(COUNTERPARTY_ACCOUNT_RE);
    const accountRef = acct ? (acct[1] || acct[2]) : null;
    const counterpartyRef = cpAcct && cpAcct[1] !== accountRef ? cpAcct[1] : (text.match(PHONE_RE)?.[1]?.slice(-4) ?? null);
    const reference = text.match(REF_RE)?.[1] ?? null;
    const when = dateIn(text, receivedAt);
    if (when.issue) issues.push(when.issue);

    // ── confidence: start from what's certain, take off for every gap
    let currency = tx.currency;
    if (!currency) { currency = sender?.currency ?? null; issues.push('No currency was printed.'); }
    let confidence = 0.95;
    if (!sender) { confidence -= 0.25; issues.push('The sender isn\'t one of the banks or wallets Zaylo knows.'); }
    if (direction === 'unknown') { confidence -= 0.4; issues.push('It isn\'t clear whether money came in or went out.'); }
    if (!tx.currency) confidence -= 0.15;
    if (channel === 'unknown') confidence -= 0.1;
    if (txAmounts.length > 1 && !fee) { confidence -= 0.15; issues.push('The message has more than one amount.'); }
    if (!counterparty && (channel === 'card_purchase' || channel === 'online_purchase')) { confidence -= 0.1; issues.push('No merchant name was found.'); }
    if (issues.includes('The message mentions both money in and money out.')) confidence -= 0.15;
    if (status !== 'completed') confidence -= 0.05;

    return {
        ...base,
        kind: 'transaction', direction, status, channel,
        amountMinor: tx.minor, currency, counterparty, accountRef, counterpartyRef, reference,
        occurredAt: when.iso, occurredAtFromText: when.fromText,
        balanceAfterMinor: balance?.minor ?? null, feeMinor: fee?.minor ?? null,
        confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)),
    };
}
