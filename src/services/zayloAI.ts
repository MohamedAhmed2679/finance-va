/**
 * Zaylo AI client — talks to /api/ai/zaylo (Google Gemini behind it).
 * Sends aggregated snapshots for insights and chat, and files/recordings for extraction.
 * Every call that sends data first passes the permission check in aiConsent.ts.
 */
import { supabase } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { getActiveCycleDates } from '../constants';
import { convertAmountSync } from './exchangeRates';
import type { ParsedExpense } from './aiExpenseParser';
import { ensureAiConsent, AiConsentDeclined, type AiSurface } from './aiConsent';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
export type CaptureSource = 'voice' | 'scan' | 'upload' | 'sms' | 'text';

export class AIError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }

const SURFACE: Record<string, AiSurface> = { chat: 'assistant', insights: 'insights', extract: 'capture' };

async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
    // Nothing is sent to the AI provider until the person has allowed it ('status' sends no data).
    if (action !== 'status' && !(await ensureAiConsent(SURFACE[action] || 'assistant'))) throw new AiConsentDeclined();
    if (!supabase) throw new AIError('Zaylo AI needs an internet connection and a signed-in account.', 0);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new AIError('Sign in again to use Zaylo AI.', 401);
    let res: Response;
    try {
        res = await fetch(`${API_BASE}/api/ai/zaylo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action, ...payload }),
        });
    } catch { throw new AIError('Can\'t reach Zaylo AI. Check your connection.', 0); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new AIError(body.error || `Zaylo AI error (${res.status})`, res.status);
    return body as T;
}

// ───────────────────────── Files ─────────────────────────
const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Couldn\'t read the file.'));
    r.readAsDataURL(blob);
});

/** Shrinks photos to ≤1600px JPEG (receipts stay legible, uploads stay small). PDFs pass through. */
export async function prepareFile(file: Blob): Promise<{ mime: string; data: string }> {
    const type = file.type || 'application/octet-stream';
    if (type === 'application/pdf') {
        if (file.size > 3_500_000) throw new AIError('That PDF is over 3 MB. Export just the receipt page and try again.', 413);
        return { mime: type, data: await toBase64(file) };
    }
    if (type.startsWith('audio/')) return { mime: type.split(';')[0], data: await toBase64(file) };
    if (!type.startsWith('image/')) throw new AIError('Use a photo (JPG, PNG, HEIC) or a PDF.', 415);
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', 0.84));
        return { mime: 'image/jpeg', data: await toBase64(blob) };
    } catch {
        // Formats the browser can't decode (e.g. HEIC on some devices) go as-is.
        if (file.size > 3_500_000) throw new AIError('That photo is too large. Try a smaller one.', 413);
        return { mime: type, data: await toBase64(file) };
    }
}

// ───────────────────────── Extraction ─────────────────────────
export interface ExtractResult { expenses: ParsedExpense[]; transcript: string; note: string }

export async function extractExpenses(input: { source: CaptureSource; text?: string; file?: Blob }): Promise<ExtractResult> {
    const s = useStore.getState();
    const payload: Record<string, unknown> = {
        source: input.source,
        text: input.text,
        baseCurrency: s.workspaces.find(w => w.id === s.activeWorkspaceId)?.currency || s.currency,
        today: new Date().toISOString().slice(0, 10),
    };
    if (input.file) payload.file = await prepareFile(input.file);
    return call<ExtractResult>('extract', payload);
}

// ───────────────────────── Snapshot (aggregates only) ─────────────────────────
const round = (n: number) => Math.round(n * 100) / 100;

export function buildSnapshot() {
    const s = useStore.getState();
    const ws = s.workspaces.find(w => w.id === s.activeWorkspaceId);
    const cur = ws?.currency || s.currency;
    const conv = (amount: number, from: string) => convertAmountSync(amount, from, cur) ?? amount;
    const today = new Date();
    const cycle = getActiveCycleDates(today, ws?.cycleStartDay ?? 1);
    const prevDate = new Date(cycle.start); prevDate.setDate(prevDate.getDate() - 1);
    const prev = getActiveCycleDates(prevDate, ws?.cycleStartDay ?? 1);
    const exp = s.expenses.filter(e => e.workspaceId === s.activeWorkspaceId && !e.deleted);
    const inRange = (d: string, r: { start: string; end: string }) => d.slice(0, 10) >= r.start && d.slice(0, 10) <= r.end;

    const sumBy = (list: typeof exp, key: (e: typeof exp[number]) => string) => {
        const m: Record<string, number> = {};
        for (const e of list) m[key(e)] = (m[key(e)] || 0) + conv(e.amount, e.currency);
        return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round(v)]));
    };
    const thisCycle = exp.filter(e => inRange(e.purchaseAt, cycle));
    const lastCycle = exp.filter(e => inRange(e.purchaseAt, prev));
    const total = (l: typeof exp) => round(l.reduce((a, e) => a + conv(e.amount, e.currency), 0));
    const daysIn = Math.max(1, Math.round((today.getTime() - new Date(cycle.start).getTime()) / 864e5) + 1);
    const cycleLen = Math.round((new Date(cycle.end).getTime() - new Date(cycle.start).getTime()) / 864e5) + 1;

    const months: Record<string, number> = {};
    for (const e of exp) {
        const k = e.purchaseAt.slice(0, 7);
        months[k] = (months[k] || 0) + conv(e.amount, e.currency);
    }
    const monthKeys = Object.keys(months).sort().slice(-6);
    const ym = today.toISOString().slice(0, 7);
    const incomes = s.incomes.filter(i => i.workspaceId === s.activeWorkspaceId);
    const incomeThisCycle = incomes.filter(i => i.type === 'fixed' || inRange(i.date, cycle)).reduce((a, i) => a + conv(i.amount, i.currency), 0);

    return {
        currency: cur,
        workspace: ws?.type === 'shared' ? 'shared workspace' : 'personal',
        today: today.toISOString().slice(0, 10),
        cycle: { ...cycle, dayOfCycle: daysIn, lengthDays: cycleLen },
        monthlyBudget: s.user?.monthlyBudget || null,
        spentThisCycle: total(thisCycle),
        spentLastCycle: total(lastCycle),
        projectedThisCycle: round((total(thisCycle) / daysIn) * cycleLen),
        incomeThisCycle: round(incomeThisCycle),
        byCategoryThisCycle: sumBy(thisCycle, e => e.category),
        byCategoryLastCycle: sumBy(lastCycle, e => e.category),
        topMerchantsThisCycle: Object.fromEntries(Object.entries(sumBy(thisCycle, e => e.merchant || 'Unknown')).slice(0, 8)),
        monthlyTotals: Object.fromEntries(monthKeys.map(k => [k, round(months[k])])),
        transactionsThisCycle: thisCycle.length,
        recent: exp.slice().sort((a, b) => b.purchaseAt.localeCompare(a.purchaseAt)).slice(0, 15)
            .map(e => ({ date: e.purchaseAt.slice(0, 10), merchant: e.merchant, category: e.category, amount: round(conv(e.amount, e.currency)) })),
        bills: s.bills.filter(b => b.workspaceId === s.activeWorkspaceId).map(b => ({
            name: b.name, amount: round(conv(b.amount, b.currency)), dueDay: b.dueDate, paidThisMonth: b.lastPaidMonth === ym,
        })),
        savingsGoals: s.savingsGoals.filter(g => g.workspaceId === s.activeWorkspaceId).map(g => ({
            name: g.name, target: round(conv(g.targetAmount, g.currency)), saved: round(conv(g.savedAmount, g.currency)),
        })),
    };
}

// ───────────────────────── Insights + chat ─────────────────────────
export interface HealthReport { score: number; headline: string; summary: string; tips: { title: string; detail: string; saving?: number }[]; alerts: string[] }

export function getHealthReport(): Promise<HealthReport> {
    const s = useStore.getState();
    const snapshot = buildSnapshot();
    return call<HealthReport>('insights', { snapshot, currency: snapshot.currency, language: s.user?.language || 'en' });
}

/** `local` marks a note written by the app on this device (not by AI, and never sent to it). */
export interface ChatMessage { role: 'user' | 'assistant'; text: string; local?: boolean }

export async function askZaylo(messages: ChatMessage[]): Promise<string> {
    const s = useStore.getState();
    const r = await call<{ reply: string }>('chat', { messages, snapshot: buildSnapshot(), language: s.user?.language || 'en' });
    return r.reply;
}

export async function aiStatus(): Promise<{ ready: boolean }> {
    try { return await call<{ ready: boolean }>('status', {}); } catch { return { ready: false }; }
}
