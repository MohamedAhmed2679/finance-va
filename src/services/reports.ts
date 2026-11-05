/**
 * Building and saving reports in the app: gathers the active workspace's data from the store,
 * builds the file with src/reports/report.ts (loaded on demand, it is large) and hands it to the user
 * in the way that works on their device.
 */
import { Capacitor } from '@capacitor/core';
import { useStore } from '../store/useStore';
import { tx } from '../i18n/translations';
import { convertAmountSync } from './exchangeRates';
import type { ReportInput, ReportSection } from '../reports/report';

export type PeriodKey = 'this_month' | 'last_month' | 'this_year' | 'all' | 'custom';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const locale = (lang: string) => (lang === 'ar' ? 'ar-u-nu-latn' : 'en-US');

export function periodRange(key: PeriodKey, lang: string, custom?: { from?: string; to?: string }, now = new Date()) {
    const monthLabel = (d: Date) => d.toLocaleDateString(locale(lang), { month: 'long', year: 'numeric' });
    switch (key) {
        case 'this_month': {
            const a = new Date(now.getFullYear(), now.getMonth(), 1), b = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            return { from: ymd(a), to: ymd(b), label: monthLabel(a) };
        }
        case 'last_month': {
            const a = new Date(now.getFullYear(), now.getMonth() - 1, 1), b = new Date(now.getFullYear(), now.getMonth(), 0);
            return { from: ymd(a), to: ymd(b), label: monthLabel(a) };
        }
        case 'this_year':
            return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31`, label: String(now.getFullYear()) };
        case 'custom': {
            const from = custom?.from || undefined, to = custom?.to || undefined;
            const label = from && to ? `${from} – ${to}` : from ? `${tx('From')} ${from}` : to ? `${tx('Until')} ${to}` : tx('All time');
            return { from, to, label };
        }
        default:
            return { from: undefined, to: undefined, label: tx('All time') };
    }
}

/** The report input for the active workspace, straight from the store. */
export function reportInputFromStore(sections: ReportSection[], period: { from?: string; to?: string; label: string }): ReportInput {
    const s = useStore.getState();
    const lang = (s.user?.language === 'ar' ? 'ar' : 'en') as 'ar' | 'en';
    const ws = s.workspaces.find(w => w.id === s.activeWorkspaceId) || s.workspaces[0];
    const wsId = ws?.id;
    const tr = (v: string) => (lang === 'ar' ? tx(v) : v);
    return {
        lang,
        owner: s.user?.name || s.user?.email || 'Zaylo',
        sections,
        from: period.from,
        to: period.to,
        periodLabel: period.label,
        generatedAt: new Date(),
        convert: (a, f, t) => convertAmountSync(a, f, t),
        workspaces: [{
            name: ws?.name || 'Zaylo',
            currency: ws?.currency || s.user?.defaultCurrency || 'USD',
            expenses: s.expenses.filter(e => e.workspaceId === wsId),
            bills: s.bills.filter(b => b.workspaceId === wsId),
            incomes: s.incomes.filter(i => i.workspaceId === wsId),
            categoryLabels: Object.fromEntries(s.categories.map(c => [c.key, tr(c.label)])),
            methodLabels: Object.fromEntries(s.paymentMethods.map(p => [p.key, tr(p.label)])),
            memberNames: Object.fromEntries((ws?.members || []).map(m => [m.uid, m.name])),
        }],
    };
}

export async function buildReportFile(input: ReportInput, format: 'xlsx' | 'pdf') {
    const r = await import('../reports/report');
    if (format === 'xlsx') return { bytes: await r.buildXlsx(input), name: r.reportFileName(input, 'xlsx'), mime: MIME.xlsx };
    const f = await import('../reports/reportFonts');
    return { bytes: await r.buildPdf(input, { regular: f.PLEX_REGULAR, semibold: f.PLEX_SEMIBOLD }), name: r.reportFileName(input, 'pdf'), mime: MIME.pdf };
}

export const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };

function toBase64(bytes: Uint8Array) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

export const isAppleDevice = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && ('ontouchend' in document || Capacitor.getPlatform() === 'ios');

type OutFile = { bytes: Uint8Array; name: string; mime: string };

/**
 * Gives files to the user:
 *  - in the phone apps, the system share sheet (Save to Files / iCloud Drive / Google Drive / OneDrive…)
 *  - in a browser on a phone or tablet, the share sheet too when `share` is set
 *  - everywhere else, a normal download.
 */
export async function deliverFiles(files: OutFile[], opts: { share?: boolean } = {}): Promise<'shared' | 'downloaded' | 'cancelled'> {
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Filesystem') && Capacitor.isPluginAvailable('Share')) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');
        const uris: string[] = [];
        for (const f of files) uris.push((await Filesystem.writeFile({ path: f.name, data: toBase64(f.bytes), directory: Directory.Cache })).uri);
        try { await Share.share({ title: files[0].name, files: uris, dialogTitle: tx('Save or send the report') }); return 'shared'; }
        catch { return 'cancelled'; }
    }
    if (opts.share || Capacitor.isNativePlatform()) {
        const list = files.map(f => new File([f.bytes as BlobPart], f.name, { type: f.mime }));
        if (navigator.canShare?.({ files: list })) {
            try { await navigator.share({ files: list, title: files[0].name }); return 'shared'; }
            catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
        }
    }
    for (const f of files) {
        const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }));
        const a = document.createElement('a');
        a.href = url; a.download = f.name; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        if (files.length > 1) await new Promise(r => setTimeout(r, 400));
    }
    return 'downloaded';
}
export const deliverFile = (file: OutFile, opts: { share?: boolean } = {}) => deliverFiles([file], opts);
