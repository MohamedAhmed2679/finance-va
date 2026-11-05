/**
 * Safety net for Arabic: translates any UI text that reached the page in English without going through
 * tx() — text nodes, placeholders, titles and aria-labels — using the same AR dictionary.
 *
 * Only exact dictionary matches change (trimmed, surrounding spaces kept), so numbers, names and
 * amounts pass through untouched. Anything inside [translate="no"] (chat messages, people's names,
 * merchants, user-typed text) is left alone. Switching back to English restores the original text.
 */
import { AR } from './ar';

const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
const original = new WeakMap<Node, string>();             // text node -> its English
const originalAttr = new WeakMap<Element, Record<string, string>>();
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'svg', 'SVG']);

const MONTHS: Record<string, string> = {
    Jan: 'يناير', Feb: 'فبراير', Mar: 'مارس', Apr: 'أبريل', May: 'مايو', Jun: 'يونيو', Jul: 'يوليو', Aug: 'أغسطس', Sep: 'سبتمبر', Oct: 'أكتوبر', Nov: 'نوفمبر', Dec: 'ديسمبر',
    January: 'يناير', February: 'فبراير', March: 'مارس', April: 'أبريل', June: 'يونيو', July: 'يوليو', August: 'أغسطس', September: 'سبتمبر', October: 'أكتوبر', November: 'نوفمبر', December: 'ديسمبر',
};
const MON = Object.keys(MONTHS).join('|');
const ROLE: Record<string, string> = { admin: 'مشرفًا', member: 'عضوًا', viewer: 'مشاهدًا' };
const word = (s: string) => AR[s] ?? s;

// Phrases built around a number, a date or a name (including notifications written by the server)
const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
    [new RegExp(`^(${MON})$`), m => MONTHS[m[1]]],
    [new RegExp(`^(${MON}) (\\d{1,2})$`), m => `${m[2]} ${MONTHS[m[1]]}`],
    [new RegExp(`^(${MON}) (\\d{1,2}), (\\d{4})$`), m => `${m[2]} ${MONTHS[m[1]]} ${m[3]}`],
    [new RegExp(`^(${MON}) (\\d{4})$`), m => `${MONTHS[m[1]]} ${m[2]}`],
    [/^(.+) added you to "(.+)"\. It's now in your workspaces\.$/, m => `أضافك ${m[1]} إلى "${m[2]}". أصبحت الآن ضمن مساحاتك.`],
    [/^(.+) added you to "(.+)"\.$/, m => `أضافك ${m[1]} إلى "${m[2]}".`],
    [/^(.+) removed you from "(.+)"\.$/, m => `أزالك ${m[1]} من "${m[2]}".`],
    [/^(.+) left "(.+)"\.$/, m => `غادر ${m[1]} "${m[2]}".`],
    [/^(.+) joined "(.+)" with your invite link\.$/, m => `انضم ${m[1]} إلى "${m[2]}" عبر رابط دعوتك.`],
    [/^You joined "(.+)"\.$/, m => `انضممت إلى "${m[1]}".`],
    [/^(.+) made you an? (admin|member|viewer) in "(.+)"\.$/, m => `جعلك ${m[1]} ${ROLE[m[2]]} في "${m[3]}".`],
    [/^(.+) is due (today|tomorrow): ([A-Z]{3}) ([\d,.]+)(?: \((.+)\))?$/, m => `${m[1]} مستحق ${m[2] === 'today' ? 'اليوم' : 'غدًا'}: ${m[3]} ${m[4]}${m[5] ? ` (${m[5]})` : ''}`],
    [/^Payday for "(.+)": ([A-Z]{3}) ([\d,.]+) expected\. A new budget cycle starts today\.$/, m => `يوم الراتب في "${m[1]}": متوقع ${m[2]} ${m[3]}. تبدأ دورة ميزانية جديدة اليوم.`],
    [/^A new budget cycle starts today in "(.+)"\. Add this month's income to plan ahead\.$/, m => `تبدأ دورة ميزانية جديدة اليوم في "${m[1]}". أضف دخل هذا الشهر لتخطط مسبقًا.`],
    [/^New expense of ([\d,.]+) ([A-Z]{3}) added in "(.+)" by (.+)\.$/, m => `مصروف جديد بقيمة ${m[1]} ${m[2]} أُضيف في "${m[3]}" بواسطة ${m[4]}.`],
    [/^(Remove|Archive|Unarchive|Delete|Edit|Open|Add people to) (.+)$/, m => `${{ Remove: 'إزالة', Archive: 'أرشفة', Unarchive: 'إلغاء أرشفة', Delete: 'حذف', Edit: 'تعديل', Open: 'فتح', 'Add people to': 'إضافة أشخاص إلى' }[m[1]]} ${m[2]}`],
    [/^Role for (.+)$/, m => `دور ${m[1]}`],
    [/^Members of (.+)$/, m => `أعضاء ${m[1]}`],
    [/^Workspace: (.+)\. Switch or create$/, m => `مساحة العمل: ${m[1]}. تبديل أو إنشاء`],
    [/^Notifications, (\d+) unread$/, m => `الإشعارات، ${m[1]} غير مقروءة`],
    [/^Converted at 1 ([A-Z]{3}) = ([\d.]+) ([A-Z]{3})$/, m => `حُوّل بسعر 1 ${m[1]} = ${m[2]} ${m[3]}`],
    [/^· (.+)$/, m => (AR[m[1]] ? `· ${word(m[1])}` : `· ${m[1]}`)],
    [/^Good (morning|afternoon|evening), (.+)$/, m => `${{ morning: 'صباح الخير', afternoon: 'مساء الخير', evening: 'مساء الخير' }[m[1] as 'morning']}، ${m[2]}`],
    [/^(\d+)m ago$/, m => `منذ ${m[1]} د`],
    [/^(\d+)h ago$/, m => `منذ ${m[1]} س`],
    [/^(\d+)d ago$/, m => `منذ ${m[1]} يوم`],
    [/^events (\d+)$/i, m => `${m[1]} أحداث`],
    [/^(\d+) members?$/, m => `${m[1]} ${Number(m[1]) === 1 ? 'عضو' : 'أعضاء'}`],
];

function translateString(s: string): string | null {
    const core = s.trim();
    if (!core || !/[A-Za-z]/.test(core)) return null;
    const hit = AR[core] ?? AR[core.replace(/\s+/g, ' ')];
    let out = hit;
    if (out === undefined) for (const [re, fn] of PATTERNS) { const m = core.match(re); if (m) { out = fn(m); break; } }
    if (out === undefined || out === core) return null;
    const lead = s.match(/^\s*/)![0], trail = s.match(/\s*$/)![0];
    return lead + out + trail;
}

const skipped = (el: Element | null) => !el || SKIP_TAGS.has(el.tagName) || Boolean(el.closest('[translate="no"], [contenteditable="true"]'));

function doText(node: Text) {
    if (skipped(node.parentElement)) return;
    const cur = node.nodeValue || '';
    // React may have written new English since we last translated it
    const known = original.get(node);
    const english = known !== undefined && translateString(known) === cur ? known : cur;
    const ar = translateString(english);
    if (ar !== null && ar !== cur) { original.set(node, english); node.nodeValue = ar; }
}
function doAttrs(el: Element) {
    if (skipped(el) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    if (el.closest('[translate="no"]')) return;
    for (const a of ATTRS) {
        const v = el.getAttribute(a); if (!v) continue;
        const ar = translateString(v);
        if (ar !== null && ar !== v) {
            const store = originalAttr.get(el) || {};
            store[a] = v; originalAttr.set(el, store);
            el.setAttribute(a, ar);
        }
    }
}
function walk(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const el = root as Element;
    if (el.closest('[translate="no"]')) return;
    doAttrs(el);
    el.querySelectorAll('[placeholder],[title],[aria-label]').forEach(doAttrs);
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) doText(n as Text);
}
function restore(root: Element) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { const o = original.get(n); if (o !== undefined) { n.nodeValue = o; original.delete(n); } }
    root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el => {
        const o = originalAttr.get(el); if (!o) return;
        for (const [a, v] of Object.entries(o)) el.setAttribute(a, v);
        originalAttr.delete(el);
    });
}

/** Starts (for 'ar') or stops translating the page. Returns a cleanup function. */
export function startDomTranslation(lang: string): () => void {
    if (typeof document === 'undefined') return () => {};
    if (lang !== 'ar') { restore(document.body); return () => {}; }
    walk(document.body);
    let pending = new Set<Node>();
    let scheduled = false;
    const flush = () => { scheduled = false; const nodes = pending; pending = new Set(); nodes.forEach(n => { if (n.isConnected) walk(n); }); };
    const obs = new MutationObserver(muts => {
        for (const m of muts) {
            if (m.type === 'characterData') pending.add(m.target);
            else if (m.type === 'attributes') pending.add(m.target);
            else m.addedNodes.forEach(n => pending.add(n));
        }
        if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    return () => obs.disconnect();
}
