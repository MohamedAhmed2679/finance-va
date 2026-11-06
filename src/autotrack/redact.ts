/**
 * The only piece of an SMS AutoTrack ever keeps: a short excerpt with numbers that could identify
 * accounts, cards, phones or codes masked. Amounts stay readable so the user can recognise the alert.
 * Codes (OTP/PIN) never get this far: those messages are dropped before anything is stored.
 */
import { normaliseText } from './parse';

export function redactExcerpt(raw: string, max = 160): string {
    let s = normaliseText(raw);
    s = s.replace(/(?:\+?20|\b0)1[0125]\d{8}\b/g, m => `•••${m.slice(-2)}`);           // Egyptian mobiles
    s = s.replace(/\b\d{12,19}\b/g, m => `•••${m.slice(-4)}`);                       // full card / account numbers
    s = s.replace(/[*xX•]{2,}\s?(\d{3,4})\b/g, '••$1');                             // already-masked refs stay short
    s = s.replace(/\b(?:ref(?:erence)?|trx|txn|رقم العملية|مرجع)\s*[:#.]?\s*[A-Z0-9-]{5,24}/gi, m => m.replace(/[A-Z0-9-]{5,24}$/i, r => `•••${r.slice(-3)}`));
    s = s.replace(/\b(?:otp|pin|code|كود|رمز)\s*[:#]?\s*\d{3,8}\b/gi, m => m.replace(/\d{3,8}$/, '••••'));
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** For the optional AI reading: the same masking plus nothing beyond 400 characters. */
export const redactForAI = (raw: string) => redactExcerpt(raw, 400);
