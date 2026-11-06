/**
 * Banks and wallets whose SMS alerts AutoTrack reads. Everything else is ignored on the device.
 *
 * Sender IDs differ by carrier and change over time, so matching is by normalised name with
 * several spellings. Users can add a sender themselves (Settings → AutoTrack → Senders);
 * those are passed in as `extra`.
 *
 * NOTE: these spellings are based on publicly known brand names, not on a verified list of the
 * exact sender IDs each bank uses. Unknown senders are never auto-added (classify.ts).
 */
export type SenderKind = 'bank' | 'wallet' | 'card' | 'payments';
export interface SenderInfo { id: string; name: string; kind: SenderKind; currency: string; custom?: boolean }

const KNOWN: { id: string; name: string; kind: SenderKind; match: string[] }[] = [
    { id: 'nbe', name: 'National Bank of Egypt', kind: 'bank', match: ['nbe', 'nationalbank', 'albankalahly', 'ahly', 'nbeegypt', 'البنكالأهلي', 'البنكالاهلي'] },
    { id: 'banquemisr', name: 'Banque Misr', kind: 'bank', match: ['banquemisr', 'bm', 'bmisr', 'bankmisr', 'بنكمصر'] },
    { id: 'cib', name: 'CIB', kind: 'bank', match: ['cib', 'cibegypt', 'cibbank'] },
    { id: 'qnb', name: 'QNB', kind: 'bank', match: ['qnb', 'qnbalahli', 'qnbegypt'] },
    { id: 'hsbc', name: 'HSBC', kind: 'bank', match: ['hsbc', 'hsbceg', 'hsbcegypt'] },
    { id: 'aaib', name: 'AAIB', kind: 'bank', match: ['aaib', 'arabafrican'] },
    { id: 'alexbank', name: 'Alexbank', kind: 'bank', match: ['alexbank', 'bankofalex', 'alex'] },
    { id: 'adib', name: 'ADIB', kind: 'bank', match: ['adib', 'adibegypt'] },
    { id: 'enbd', name: 'Emirates NBD', kind: 'bank', match: ['emiratesnbd', 'enbd'] },
    { id: 'fab', name: 'FAB', kind: 'bank', match: ['fab', 'fabmisr'] },
    { id: 'saib', name: 'SAIB', kind: 'bank', match: ['saib'] },
    { id: 'cae', name: 'Crédit Agricole', kind: 'bank', match: ['ca-egypt', 'caegypt', 'creditagricole', 'cae'] },
    { id: 'mashreq', name: 'Mashreq', kind: 'bank', match: ['mashreq', 'mashreqeg'] },
    { id: 'faisal', name: 'Faisal Islamic Bank', kind: 'bank', match: ['faisal', 'fibe'] },
    { id: 'bdc', name: 'Banque du Caire', kind: 'bank', match: ['bdc', 'banqueducaire', 'bankducaire', 'بنكالقاهرة'] },
    { id: 'abk', name: 'ABK', kind: 'bank', match: ['abk', 'abkegypt'] },
    { id: 'instapay', name: 'InstaPay', kind: 'payments', match: ['instapay', 'ipn', 'انستاباي'] },
    { id: 'vfcash', name: 'Vodafone Cash', kind: 'wallet', match: ['vfcash', 'vodafonecash', 'vf-cash', 'vodafone', 'فودافونكاش'] },
    { id: 'etisalatcash', name: 'e& money', kind: 'wallet', match: ['etisalatcash', 'e&money', 'emoney', 'etisalat', 'e&cash'] },
    { id: 'orangecash', name: 'Orange Cash', kind: 'wallet', match: ['orangecash', 'orangemoney', 'orange'] },
    { id: 'wepay', name: 'WE Pay', kind: 'wallet', match: ['wepay', 'wecash', 'we'] },
    { id: 'telda', name: 'Telda', kind: 'card', match: ['telda'] },
    { id: 'valu', name: 'valU', kind: 'payments', match: ['valu'] },
    { id: 'fawry', name: 'Fawry', kind: 'payments', match: ['fawry', 'myfawry', 'فوري'] },
    { id: 'halan', name: 'MNT-Halan', kind: 'wallet', match: ['halan', 'mnthalan'] },
];

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[\s_.]/g, '').replace(/[أإآ]/g, 'ا');

export function lookupSender(senderId: string | null | undefined, extra: SenderInfo[] = []): SenderInfo | null {
    const s = norm(senderId ?? '');
    if (!s || /^\+?\d{6,}$/.test(s)) return null; // ordinary phone numbers are people, not banks
    for (const e of extra) if (norm(e.id) === s || norm(e.name) === s) return { ...e, custom: true };
    for (const k of KNOWN) if (k.match.some(m => norm(m) === s)) return { id: k.id, name: k.name, kind: k.kind, currency: 'EGP' };
    // "CIB-Alerts", "NBE_SMS", "QNBAA"… → prefix match on the longer names only
    for (const k of KNOWN) if (k.match.some(m => m.length >= 3 && s.startsWith(norm(m)) && s.length - norm(m).length <= 8)) return { id: k.id, name: k.name, kind: k.kind, currency: 'EGP' };
    return null;
}

export const knownSenders = () => KNOWN.map(k => ({ id: k.id, name: k.name, kind: k.kind }));
