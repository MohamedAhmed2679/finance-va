/**
 * Zaylo reports: Excel (.xlsx) and PDF builders for Expenses, Bills & Commitments and Income.
 *
 * Runs in the browser (downloads, desktop iCloud backups) and on the server (monthly cloud backups),
 * so it only depends on exceljs / jsPDF and takes everything else as input. Arabic reports are
 * right-to-left in both formats.
 */
import type { Expense, Income, MonthlyBill } from '../store/useStore';

export type ReportLang = 'en' | 'ar';
export type ReportSection = 'expenses' | 'bills' | 'income';

export interface ReportWorkspace {
    name: string;
    currency: string;
    expenses: Expense[];
    bills: MonthlyBill[];
    incomes: Income[];
    categoryLabels?: Record<string, string>;
    methodLabels?: Record<string, string>;
    memberNames?: Record<string, string>;
}

export interface ReportInput {
    lang: ReportLang;
    owner: string;
    sections: ReportSection[];
    /** yyyy-mm-dd, inclusive. Leave both out for everything. */
    from?: string;
    to?: string;
    periodLabel: string;
    workspaces: ReportWorkspace[];
    /** Today's rate, used only for entries saved without a workspace-currency value. */
    convert?: (amount: number, from: string, to: string) => number | null | undefined;
    generatedAt?: Date;
}

const STR = {
    en: {
        report: 'Financial report', summary: 'Summary', expenses: 'Expenses', bills: 'Bills & Commitments', income: 'Income',
        period: 'Period', generated: 'Generated', for: 'Prepared for', workspace: 'Workspace',
        date: 'Date', merchant: 'Merchant', description: 'Description', category: 'Category', method: 'Payment method', addedBy: 'Added by',
        tags: 'Tags', notes: 'Notes', amount: 'Amount', currency: 'Currency', value: 'Value', valueCur: 'Value currency', rate: 'Rate used',
        name: 'Name', dueDay: 'Due day', monthly: 'Monthly amount', lastPaid: 'Last paid', status: 'Status', paid: 'Paid', unpaid: 'Not paid yet',
        type: 'Type', fixed: 'Fixed (monthly)', variable: 'One-off',
        totalIncome: 'Income in period', totalSpent: 'Spent in period', net: 'Left over', commitments: 'Monthly commitments',
        fixedIncome: 'Fixed income (monthly)', variableIncome: 'One-off income', entries: 'Expenses recorded', billsPaid: 'Bills paid',
        byCategory: 'Spending by category', share: 'Share', total: 'Total', none: 'Nothing recorded in this period.',
        noRate: 'Entries without a saved exchange rate (left out of totals)', page: 'Page', of: 'of', months: 'months',
    },
    ar: {
        report: 'تقرير مالي', summary: 'الملخص', expenses: 'المصروفات', bills: 'الفواتير والالتزامات', income: 'الدخل',
        period: 'الفترة', generated: 'تاريخ الإنشاء', for: 'المستخدم', workspace: 'مساحة العمل',
        date: 'التاريخ', merchant: 'التاجر', description: 'الوصف', category: 'الفئة', method: 'طريقة الدفع', addedBy: 'أضافه',
        tags: 'الوسوم', notes: 'ملاحظات', amount: 'المبلغ', currency: 'العملة', value: 'القيمة', valueCur: 'عملة القيمة', rate: 'سعر الصرف',
        name: 'الاسم', dueDay: 'يوم الاستحقاق', monthly: 'المبلغ الشهري', lastPaid: 'آخر دفع', status: 'الحالة', paid: 'مدفوع', unpaid: 'لم يُدفع بعد',
        type: 'النوع', fixed: 'ثابت شهريًا', variable: 'مرة واحدة',
        totalIncome: 'الدخل خلال الفترة', totalSpent: 'المصروف خلال الفترة', net: 'المتبقي', commitments: 'الالتزامات الشهرية',
        fixedIncome: 'الدخل الثابت شهريًا', variableIncome: 'دخل لمرة واحدة', entries: 'عدد المصروفات', billsPaid: 'الفواتير المدفوعة',
        byCategory: 'الإنفاق حسب الفئة', share: 'النسبة', total: 'الإجمالي', none: 'لا يوجد شيء مسجل في هذه الفترة.',
        noRate: 'قيود بلا سعر صرف محفوظ، غير محسوبة في الإجماليات', page: 'صفحة', of: 'من', months: 'أشهر',
    },
};
type Strings = typeof STR.en;

const BRAND = { midnight: '0B0F1A', blue: '2563FF', purple: '7C3AED', aqua: '22D3EE', gray: 'F4F6FA', ink: '1F2937', muted: '6B7280', line: 'E5E7EB', red: 'DC2626', green: '059669' };
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => (iso || '').slice(0, 10);
const monthOf = (iso: string) => (iso || '').slice(0, 7);

function monthsBetween(from: string, to: string) {
    const [fy, fm] = from.slice(0, 7).split('-').map(Number);
    const [ty, tm] = to.slice(0, 7).split('-').map(Number);
    return Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);
}

/** Everything a report shows for one workspace, computed once for both formats. */
export interface WorkspaceFigures {
    ws: ReportWorkspace;
    expenses: (Expense & { value: number | null })[];
    variableIncome: (Income & { value: number | null })[];
    fixedIncome: (Income & { value: number | null })[];
    bills: (MonthlyBill & { value: number | null; paid: boolean })[];
    months: number;
    spent: number; fixedMonthly: number; variableTotal: number; incomeTotal: number; net: number; commitments: number;
    billsPaid: number; missingRates: number;
    byCategory: { label: string; value: number; share: number }[];
}

export function computeFigures(input: ReportInput): WorkspaceFigures[] {
    const today = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
    return input.workspaces.map(ws => {
        const cur = ws.currency;
        const value = (e: { amount: number; currency: string; baseAmount?: number; baseCurrency?: string }): number | null => {
            if (e.currency === cur) return e.amount;
            if (e.baseCurrency === cur && e.baseAmount != null) return e.baseAmount;
            const c = input.convert?.(e.amount, e.currency, cur);
            return c == null || !isFinite(c) ? null : round2(c);
        };
        const inRange = (d: string) => (!input.from || d >= input.from) && (!input.to || d <= input.to);
        const expenses = ws.expenses.filter(e => !e.deleted && inRange(day(e.purchaseAt)))
            .sort((a, b) => a.purchaseAt.localeCompare(b.purchaseAt))
            .map(e => ({ ...e, value: value(e) }));
        const variableIncome = ws.incomes.filter(i => i.type === 'variable' && inRange(day(i.date)))
            .sort((a, b) => a.date.localeCompare(b.date)).map(i => ({ ...i, value: value(i) }));
        const fixedIncome = ws.incomes.filter(i => i.type === 'fixed').map(i => ({ ...i, value: value(i) }));

        // For "everything", count months from the first record
        const firstDate = [...ws.expenses.map(e => day(e.purchaseAt)), ...ws.incomes.map(i => day(i.date))].filter(Boolean).sort()[0] || today;
        const from = input.from || firstDate;
        const to = input.to && input.to < today ? input.to : today;
        const months = to < from ? 1 : monthsBetween(from, to);
        const endMonth = monthOf(input.to && input.to < today ? input.to : today);

        const bills = [...ws.bills].sort((a, b) => a.dueDate - b.dueDate)
            .map(b => ({ ...b, value: value(b), paid: Boolean(b.lastPaidMonth && b.lastPaidMonth >= endMonth) }));

        const sum = (xs: { value: number | null }[]) => round2(xs.reduce((s, x) => s + (x.value ?? 0), 0));
        const spent = sum(expenses);
        const fixedMonthly = sum(fixedIncome);
        const variableTotal = sum(variableIncome);
        const incomeTotal = round2(fixedMonthly * months + variableTotal);
        const commitments = sum(bills);
        const missingRates = [...expenses, ...variableIncome, ...fixedIncome, ...bills].filter(x => x.value == null).length;

        const cats = new Map<string, number>();
        for (const e of expenses) {
            const label = ws.categoryLabels?.[e.category] || e.category;
            cats.set(label, (cats.get(label) || 0) + (e.value ?? 0));
        }
        const byCategory = [...cats.entries()].map(([label, v]) => ({ label, value: round2(v), share: spent ? v / spent : 0 }))
            .sort((a, b) => b.value - a.value);

        return {
            ws, expenses, variableIncome, fixedIncome, bills, months,
            spent, fixedMonthly, variableTotal, incomeTotal, net: round2(incomeTotal - spent), commitments,
            billsPaid: bills.filter(b => b.paid).length, missingRates, byCategory,
        };
    });
}

export function reportFileName(input: ReportInput, ext: 'xlsx' | 'pdf') {
    const ws = input.workspaces.length === 1 ? input.workspaces[0].name : 'All workspaces';
    const safe = `Zaylo report - ${ws} - ${input.periodLabel}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    return `${safe}.${ext}`;
}

const label = (map: Record<string, string> | undefined, key?: string) => (key ? map?.[key] || key : '');

// ---------------------------------------------------------------- Excel

export async function buildXlsx(input: ReportInput): Promise<Uint8Array> {
    const mod = await import('exceljs');
    const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const S: Strings = STR[input.lang];
    const rtl = input.lang === 'ar';
    const figures = computeFigures(input);
    const multi = figures.length > 1;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Zaylo';
    wb.created = input.generatedAt ?? new Date();

    const head = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF' + BRAND.blue } }, alignment: { vertical: 'middle' as const } };
    const money = '#,##0.00';
    const view = (frozen = 1) => [{ state: 'frozen' as const, ySplit: frozen, rightToLeft: rtl }];

    // Summary
    const sum = wb.addWorksheet(S.summary, { views: [{ rightToLeft: rtl }], properties: { tabColor: { argb: 'FF' + BRAND.midnight } } });
    sum.columns = [{ width: 34 }, { width: 22 }, { width: 14 }];
    const t = sum.addRow([`Zaylo · ${S.report}`]);
    t.font = { bold: true, size: 18, color: { argb: 'FF' + BRAND.midnight } };
    sum.addRow([S.period, input.periodLabel]);
    sum.addRow([S.for, input.owner]);
    sum.addRow([S.generated, (input.generatedAt ?? new Date()).toISOString().slice(0, 16).replace('T', ' ')]);
    for (const f of figures) {
        sum.addRow([]);
        const h = sum.addRow([`${f.ws.name} · ${f.ws.currency}`, '', '']);
        sum.mergeCells(h.number, 1, h.number, 3);
        h.height = 22;
        h.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
        h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND.midnight } }; });
        const rows: [string, number | string][] = [];
        if (input.sections.includes('income')) rows.push([S.totalIncome, f.incomeTotal], [S.fixedIncome, f.fixedMonthly], [S.variableIncome, f.variableTotal]);
        if (input.sections.includes('expenses')) rows.push([S.totalSpent, f.spent], [S.entries, f.expenses.length]);
        if (input.sections.includes('income') && input.sections.includes('expenses')) rows.push([S.net, f.net]);
        if (input.sections.includes('bills')) rows.push([S.commitments, f.commitments], [S.billsPaid, `${f.billsPaid} / ${f.bills.length}`]);
        for (const [k, v] of rows) {
            const r = sum.addRow([k, v]);
            if (typeof v === 'number' && k !== S.entries) r.getCell(2).numFmt = money;
            r.getCell(1).font = { color: { argb: 'FF' + BRAND.muted } };
            r.getCell(2).font = { bold: true, color: { argb: 'FF' + (k === S.net && f.net < 0 ? BRAND.red : BRAND.ink) } };
        }
        if (input.sections.includes('expenses') && f.byCategory.length) {
            sum.addRow([]);
            const ch = sum.addRow([S.byCategory, `${S.value} (${f.ws.currency})`, S.share]);
            ch.eachCell(c => Object.assign(c, head));
            for (const c of f.byCategory) {
                const r = sum.addRow([c.label, c.value, c.share]);
                r.getCell(2).numFmt = money; r.getCell(3).numFmt = '0.0%';
            }
        }
        if (f.missingRates) sum.addRow([`* ${S.noRate}: ${f.missingRates}`]).font = { italic: true, color: { argb: 'FF' + BRAND.muted } };
    }

    const table = (name: string, columns: { header: string; width: number; numFmt?: string }[], rows: unknown[][], totalCol?: number) => {
        const sh = wb.addWorksheet(name, { views: view() });
        sh.columns = columns.map(c => ({ header: c.header, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
        sh.getRow(1).eachCell(c => Object.assign(c, head));
        sh.getRow(1).height = 22;
        rows.forEach(r => sh.addRow(r));
        if (!rows.length) sh.addRow([S.none]);
        sh.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
        if (totalCol && rows.length && !multi) {
            const col = sh.getColumn(totalCol).letter;
            const r = sh.addRow([]);
            r.getCell(1).value = S.total;
            r.getCell(totalCol).value = { formula: `SUBTOTAL(9,${col}2:${col}${rows.length + 1})` };
            r.getCell(totalCol).numFmt = money;
            r.font = { bold: true };
            r.eachCell(c => { c.border = { top: { style: 'thin', color: { argb: 'FF' + BRAND.blue } } }; });
        }
        return sh;
    };
    const wsCol = multi ? [{ header: S.workspace, width: 20 }] : [];
    const wsCell = (f: WorkspaceFigures) => (multi ? [f.ws.name] : []);
    const asDate = (iso: string) => { const d = new Date(day(iso) + 'T00:00:00Z'); return isNaN(+d) ? iso : d; };

    if (input.sections.includes('expenses')) {
        const cols = [...wsCol, { header: S.date, width: 12, numFmt: 'yyyy-mm-dd' }, { header: S.merchant, width: 24 }, { header: S.description, width: 30 },
            { header: S.category, width: 16 }, { header: S.method, width: 16 }, { header: S.addedBy, width: 16 }, { header: S.tags, width: 14 }, { header: S.notes, width: 24 },
            { header: S.amount, width: 13, numFmt: money }, { header: S.currency, width: 9 }, { header: S.value, width: 14, numFmt: money }, { header: S.valueCur, width: 10 }, { header: S.rate, width: 10 }];
        const rows = figures.flatMap(f => f.expenses.map(e => [...wsCell(f), asDate(e.purchaseAt), e.merchant, e.description, label(f.ws.categoryLabels, e.category),
            label(f.ws.methodLabels, e.paymentMethod), e.createdByName || label(f.ws.memberNames, e.createdByUid), e.tags.join(', '), e.notes,
            e.amount, e.currency, e.value, f.ws.currency, e.currency === f.ws.currency ? 1 : (e.fxRate ?? null)]));
        table(S.expenses, cols, rows, cols.length - 2);
    }
    if (input.sections.includes('bills')) {
        const cols = [...wsCol, { header: S.name, width: 26 }, { header: S.category, width: 16 }, { header: S.method, width: 16 }, { header: S.dueDay, width: 10 },
            { header: S.amount, width: 13, numFmt: money }, { header: S.currency, width: 9 }, { header: S.monthly, width: 15, numFmt: money }, { header: S.valueCur, width: 10 },
            { header: S.lastPaid, width: 11 }, { header: S.status, width: 14 }];
        const rows = figures.flatMap(f => f.bills.map(b => [...wsCell(f), b.name, label(f.ws.categoryLabels, b.category), label(f.ws.methodLabels, b.paymentMethod), b.dueDate,
            b.amount, b.currency, b.value, f.ws.currency, b.lastPaidMonth || '', b.paid ? S.paid : S.unpaid]));
        const sh = table(S.bills, cols, rows, cols.length - 3);
        sh.eachRow((r, i) => { if (i > 1) { const c = r.getCell(cols.length); if (c.value === S.paid) c.font = { color: { argb: 'FF' + BRAND.green } }; else if (c.value === S.unpaid) c.font = { color: { argb: 'FF' + BRAND.red } }; } });
    }
    if (input.sections.includes('income')) {
        const cols = [...wsCol, { header: S.name, width: 26 }, { header: S.type, width: 16 }, { header: S.date, width: 12, numFmt: 'yyyy-mm-dd' },
            { header: S.amount, width: 13, numFmt: money }, { header: S.currency, width: 9 }, { header: S.value, width: 14, numFmt: money }, { header: S.valueCur, width: 10 }];
        const rows = figures.flatMap(f => [...f.fixedIncome, ...f.variableIncome].map(i => [...wsCell(f), i.name, i.type === 'fixed' ? S.fixed : S.variable,
            i.type === 'fixed' ? null : asDate(i.date), i.amount, i.currency, i.value, f.ws.currency]));
        table(S.income, cols, rows);
    }
    const buf = await wb.xlsx.writeBuffer();
    return new Uint8Array(buf as ArrayBuffer);
}

// ---------------------------------------------------------------- PDF

export interface ReportFonts { regular: string; semibold: string }

export async function buildPdf(input: ReportInput, fonts: ReportFonts): Promise<Uint8Array> {
    const { jsPDF } = await import('jspdf');
    const { autoTable } = await import('jspdf-autotable');
    const S: Strings = STR[input.lang];
    const rtl = input.lang === 'ar';
    const figures = computeFigures(input);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.addFileToVFS('Plex-Regular.ttf', fonts.regular);
    doc.addFont('Plex-Regular.ttf', 'Plex', 'normal');
    doc.addFileToVFS('Plex-SemiBold.ttf', fonts.semibold);
    doc.addFont('Plex-SemiBold.ttf', 'Plex', 'bold');
    doc.setFont('Plex', 'normal');

    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 14;
    const hex = (h: string) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as [number, number, number];
    const X = (x: number) => (rtl ? W - x : x);
    const align = rtl ? 'right' : 'left';
    const text = (s: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' } = {}) => {
        doc.setFont('Plex', opts.bold ? 'bold' : 'normal');
        doc.setFontSize(opts.size ?? 10);
        doc.setTextColor(...hex(opts.color ?? BRAND.ink));
        doc.text(s, x, y, { align: opts.align ?? align });
    };

    /** "Label: value" — drawn as two pieces in Arabic so numbers and dates keep their order. */
    const pair = (k: string, v: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right'; vColor?: string; vBold?: boolean } = {}) => {
        if (!rtl) { text(`${k}: ${v}`, x, y, opts); return; }
        doc.setFontSize(opts.size ?? 10);
        doc.setFont('Plex', opts.bold ? 'bold' : 'normal');
        const lw = doc.getTextWidth(k), cw = doc.getTextWidth(':');
        const kw = lw + cw + 1.6;
        doc.setFont('Plex', opts.vBold ? 'bold' : 'normal');
        const vw = doc.getTextWidth(v);
        const right = (opts.align ?? align) === 'right' ? x : x + kw + vw;
        text(k, right, y, { ...opts, align: 'right' });
        text(':', right - lw, y, { ...opts, align: 'right' });
        text(v, right - kw, y, { ...opts, bold: opts.vBold ?? opts.bold, color: opts.vColor ?? opts.color, align: 'right' });
    };

    // Header band
    doc.setFillColor(...hex(BRAND.midnight));
    doc.rect(0, 0, W, 40, 'F');
    doc.setFillColor(...hex(BRAND.blue));
    doc.rect(0, 40, W, 1.2, 'F');
    text('Zaylo', X(M), 15, { size: 20, bold: true, color: 'FFFFFF' });
    text(S.report, X(M), 25, { size: 13, color: BRAND.aqua });
    pair(S.period, input.periodLabel, X(M), 33, { size: 9.5, color: 'C7CEDB' });
    pair(S.for, input.owner, X(W - M), 25, { size: 9, color: 'C7CEDB', align: rtl ? 'left' : 'right' });
    pair(S.generated, (input.generatedAt ?? new Date()).toISOString().slice(0, 10), X(W - M), 33, { size: 9, color: 'C7CEDB', align: rtl ? 'left' : 'right' });

    let y = 52;
    const ensure = (h: number) => { if (y + h > H - 18) { doc.addPage(); y = 20; } };
    const tableStyles = {
        styles: { font: 'Plex', fontSize: 8.5, cellPadding: 1.8, textColor: hex(BRAND.ink), halign: (rtl ? 'right' : 'left') as 'right' | 'left', lineColor: hex(BRAND.line), lineWidth: 0.1 },
        headStyles: { font: 'Plex', fontStyle: 'bold' as const, fillColor: hex(BRAND.blue), textColor: [255, 255, 255] as [number, number, number] },
        alternateRowStyles: { fillColor: hex(BRAND.gray) },
        margin: { left: M, right: M, top: 18, bottom: 18 },
    };
    const run = (head: string[], body: (string | number)[][], foot?: string[], numCols: number[] = []) => {
        const flip = <T,>(r: T[]) => (rtl ? [...r].reverse() : r);
        const n = head.length;
        const columnStyles: Record<number, { halign?: 'right' | 'left'; minCellWidth?: number }> = {};
        numCols.forEach(c => { columnStyles[rtl ? n - 1 - c : c] = { halign: rtl ? 'left' : 'right' }; });
        if (!numCols.includes(0)) columnStyles[rtl ? n - 1 : 0] = { ...(columnStyles[rtl ? n - 1 : 0] || {}), minCellWidth: 26 };
        autoTable(doc, {
            ...tableStyles, startY: y, head: [flip(head)], body: body.map(flip), foot: foot ? [flip(foot)] : undefined, columnStyles,
            footStyles: { font: 'Plex', fontStyle: 'bold', fillColor: hex(BRAND.gray), textColor: hex(BRAND.midnight) }, showFoot: 'lastPage',
        });
        y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 8;
    };
    const heading = (s: string, count: number) => {
        ensure(14);
        text(s, X(M), y, { size: 12.5, bold: true, color: BRAND.midnight });
        doc.setFont('Plex', 'bold'); doc.setFontSize(12.5);
        const w = doc.getTextWidth(s) + 3;
        text(String(count), rtl ? W - M - w : M + w, y, { size: 10, color: BRAND.muted, align: rtl ? 'right' : 'left' });
        y += 5;
    };
    const money = (v: number | null, cur?: string) => (v == null ? '—' : `${fmt(v)}${cur ? ' ' + cur : ''}`);

    for (const f of figures) {
        const cur = f.ws.currency;
        ensure(40);
        text(f.ws.name, X(M), y, { size: 15, bold: true, color: BRAND.midnight });
        text(cur, X(W - M), y, { size: 10, color: BRAND.muted, align: rtl ? 'left' : 'right' });
        y += 6;

        // Summary tiles
        const tiles: { k: string; v: string; c: string }[] = [];
        if (input.sections.includes('income')) tiles.push({ k: S.totalIncome, v: fmt(f.incomeTotal), c: BRAND.green });
        if (input.sections.includes('expenses')) tiles.push({ k: S.totalSpent, v: fmt(f.spent), c: BRAND.blue });
        if (input.sections.includes('income') && input.sections.includes('expenses')) tiles.push({ k: S.net, v: fmt(f.net), c: f.net < 0 ? BRAND.red : BRAND.purple });
        if (input.sections.includes('bills')) tiles.push({ k: S.commitments, v: fmt(f.commitments), c: BRAND.midnight });
        const gap = 4, tw = (W - 2 * M - gap * (tiles.length - 1)) / Math.max(1, tiles.length);
        tiles.forEach((tl, i) => {
            const x0 = rtl ? W - M - tw - i * (tw + gap) : M + i * (tw + gap);
            doc.setFillColor(...hex(BRAND.gray));
            doc.roundedRect(x0, y, tw, 20, 2.5, 2.5, 'F');
            doc.setFillColor(...hex(tl.c));
            doc.rect(rtl ? x0 + tw - 1.4 : x0, y + 3, 1.4, 14, 'F');
            const tx = rtl ? x0 + tw - 5 : x0 + 5;
            text(tl.k, tx, y + 7.5, { size: 8, color: BRAND.muted });
            text(`${tl.v} ${cur}`, tx, y + 15, { size: tl.v.length > 12 ? 10 : 12, bold: true, color: tl.c });
        });
        if (tiles.length) y += 27;
        if (f.missingRates) { pair(`* ${S.noRate}`, String(f.missingRates), X(M), y, { size: 8, color: BRAND.muted }); y += 6; }

        if (input.sections.includes('expenses')) {
            heading(S.expenses, f.expenses.length);
            if (f.byCategory.length) {
                run([S.category, `${S.value} (${cur})`, S.share], f.byCategory.map(c => [c.label, fmt(c.value), `${(c.share * 100).toFixed(1)}%`]),
                    [S.total, fmt(f.spent), '100%'], [1, 2]);
            }
            if (f.expenses.length) {
                run([S.date, S.merchant, S.category, S.method, S.amount, `${S.value} (${cur})`],
                    f.expenses.map(e => [day(e.purchaseAt), e.merchant || e.description || '—', label(f.ws.categoryLabels, e.category), label(f.ws.methodLabels, e.paymentMethod),
                        money(e.amount, e.currency), money(e.value)]),
                    ['', '', '', '', S.total, fmt(f.spent)], [4, 5]);
            } else { text(S.none, X(M), y + 2, { size: 9, color: BRAND.muted }); y += 10; }
        }
        if (input.sections.includes('bills')) {
            heading(S.bills, f.bills.length);
            if (f.bills.length) {
                run([S.name, S.category, S.dueDay, S.amount, `${S.monthly} (${cur})`, S.lastPaid, S.status],
                    f.bills.map(b => [b.name, label(f.ws.categoryLabels, b.category), String(b.dueDate), money(b.amount, b.currency), money(b.value), b.lastPaidMonth || '—', b.paid ? S.paid : S.unpaid]),
                    ['', '', '', S.total, fmt(f.commitments), '', `${f.billsPaid}/${f.bills.length}`], [3, 4]);
            } else { text(S.none, X(M), y + 2, { size: 9, color: BRAND.muted }); y += 10; }
        }
        if (input.sections.includes('income')) {
            const all = [...f.fixedIncome, ...f.variableIncome];
            heading(S.income, all.length);
            if (all.length) {
                run([S.name, S.type, S.date, S.amount, `${S.value} (${cur})`],
                    all.map(i => [i.name, i.type === 'fixed' ? S.fixed : S.variable, i.type === 'fixed' ? '—' : day(i.date), money(i.amount, i.currency), money(i.value)]),
                    ['', '', '', S.totalIncome, fmt(f.incomeTotal)], [3, 4]);
                if (f.months > 1 && f.fixedMonthly) { pair(S.fixedIncome, `${fmt(f.fixedMonthly)} ${cur} × ${f.months}`, X(M), y - 3, { size: 8, color: BRAND.muted }); y += 4; }
            } else { text(S.none, X(M), y + 2, { size: 9, color: BRAND.muted }); y += 10; }
        }
        y += 4;
    }

    // Footer on every page
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setDrawColor(...hex(BRAND.line));
        doc.line(M, H - 12, W - M, H - 12);
        pair(S.page, `${p} / ${pages}`, X(W - M), H - 7, { size: 8, color: BRAND.muted, align: rtl ? 'left' : 'right' });
        text('zaylo.cc', X(M), H - 7, { size: 8, color: BRAND.muted });
    }
    return new Uint8Array(doc.output('arraybuffer'));
}
