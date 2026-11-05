/**
 * Zaylo AI — one endpoint for every AI feature, powered by Google Gemini.
 *
 *   POST /api/ai/zaylo   Authorization: Bearer <Supabase access token>
 *   { action: 'extract' | 'insights' | 'chat', ... }
 *
 * - extract:  text, a voice recording, a receipt photo or a PDF → expenses to review
 * - insights: aggregated spending summary → health score, summary, tips, alerts
 * - chat:     "Ask Zaylo" — help using the app and questions about the user's own numbers
 *
 * Only signed-in Zaylo users can call it. The client sends aggregates, never raw account data.
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (optional, default gemini-3.5-flash-lite),
 *      VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (already set, used to verify the caller).
 */
// Node runtime: AI answers can take longer than the 25 s edge limit.
export const config = { maxDuration: 60 };
const TIME_BUDGET_MS = 52_000;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const CATEGORIES = ['groceries', 'dining', 'transport', 'shopping', 'entertainment', 'utilities', 'healthcare', 'travel', 'education', 'savings', 'other'];
const PAYMENT = ['cash', 'card', 'bank_transfer', 'wallet', 'other'];
const MAX_INLINE_BYTES = 3_500_000; // keep requests under Vercel's body limit

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

// ───────────────────────── Gemini ─────────────────────────
// Flash-Lite answers fastest; Flash is the backup when Lite is busy.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
const thinkingFor = (model: string) => (/lite/.test(model) ? 'minimal' : 'low');

async function gemini(parts: Part[], opts: { system: string; schema?: object; temperature?: number; history?: { role: 'user' | 'model'; text: string }[] }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw Object.assign(new Error('AI is not set up yet. Add GEMINI_API_KEY in Vercel.'), { status: 503 });
    const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    // Newest first; Google retires older models for new keys, so keep a few fallbacks.
    const models = [primary, ...FALLBACK_MODELS].filter((m, i, a) => a.indexOf(m) === i);

    const contents = [
        ...(opts.history || []).map(h => ({ role: h.role, parts: [{ text: h.text }] })),
        { role: 'user', parts },
    ];
    const body = {
        system_instruction: { parts: [{ text: opts.system }] },
        contents,
        generationConfig: {
            temperature: opts.temperature ?? 0.2,
            maxOutputTokens: 8192,
            ...(opts.schema ? { responseMimeType: 'application/json', responseSchema: opts.schema } : {}),
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
    };

    let lastError = 'AI is unavailable right now.';
    const started = Date.now();
    const tried: { model: string; status: number; ms: number; error?: string }[] = [];
    for (const model of models) {
        const left = TIME_BUDGET_MS - (Date.now() - started);
        if (left < 4000) break;
        // Gemini 3 models think before answering; keep that short so replies arrive quickly.
        const withThinking = { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: { thinkingLevel: thinkingFor(model) } } };
        const t0 = Date.now();
        let attempt = await callModel(model, withThinking, key, left);
        if (attempt.status === 400 && /thinking/i.test(attempt.error || '')) attempt = await callModel(model, body, key, TIME_BUDGET_MS - (Date.now() - started));
        tried.push({ model, status: attempt.status, ms: Date.now() - t0, error: attempt.error?.slice(0, 160) });
        if (attempt.text) { if (tried.length > 1) console.warn('[zaylo-ai] fallbacks', JSON.stringify(tried)); return { text: attempt.text, model, tried }; }
        lastError = attempt.error || lastError;
        // Busy, slow, rate-limited or retired model: try the next one; anything else is final.
        const retired = /no longer available|not found|not supported|deprecated/i.test(lastError);
        if (!retired && ![0, 404, 408, 429, 500, 503, 504].includes(attempt.status)) break;
    }
    console.error('[zaylo-ai] all models failed', JSON.stringify(tried));
    throw Object.assign(new Error(/quota|rate/i.test(lastError) ? 'Zaylo AI is busy. Try again in a minute.' : /took too long/i.test(lastError) ? 'Zaylo took too long to answer. Try a shorter question.' : lastError), { status: 502 });
}

async function callModel(model: string, body: object, key: string, timeoutMs: number): Promise<{ status: number; text?: string; error?: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1000, Math.min(timeoutMs, 40_000)));
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { status: res.status, error: data.error?.message || `AI error ${res.status}` };
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts || []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || '').join('');
        if (!text) return { status: 500, error: cand?.finishReason === 'SAFETY' ? 'That request was blocked.' : 'The AI returned an empty answer.' };
        return { status: 200, text };
    } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        return { status: aborted ? 504 : 0, error: aborted ? `${model} took too long to answer.` : (e as Error).message };
    } finally { clearTimeout(timer); }
}

function parseJson<T>(text: string): T {
    try { return JSON.parse(text); } catch {
        const s = text.indexOf('{'), e = text.lastIndexOf('}');
        return JSON.parse(text.slice(s, e + 1));
    }
}

// ───────────────────────── Auth ─────────────────────────
async function verifyUser(req: Request): Promise<string | null> {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!token || !url || !anon) return null;
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id || null;
}

// ───────────────────────── Actions ─────────────────────────
const EXTRACT_SCHEMA = {
    type: 'OBJECT',
    properties: {
        transcript: { type: 'STRING', description: 'For audio: what the person said, verbatim. Otherwise empty.' },
        note: { type: 'STRING', description: 'One short sentence for the user if nothing could be extracted or something is unclear. Otherwise empty.' },
        expenses: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    amount: { type: 'NUMBER' },
                    currency: { type: 'STRING', description: '3-letter ISO 4217 code' },
                    merchant: { type: 'STRING' },
                    category: { type: 'STRING', enum: CATEGORIES },
                    description: { type: 'STRING' },
                    date: { type: 'STRING', description: 'YYYY-MM-DD' },
                    paymentMethod: { type: 'STRING', enum: PAYMENT },
                    confidence: { type: 'NUMBER', description: '0 to 1' },
                },
                required: ['amount', 'currency', 'merchant', 'category', 'confidence'],
            },
        },
    },
    required: ['expenses'],
};

async function extract(b: Record<string, any>) {
    const today = String(b.today || new Date().toISOString().slice(0, 10));
    const currency = String(b.baseCurrency || 'USD').toUpperCase().slice(0, 3);
    const source = String(b.source || 'text');
    const system = `You turn messy money evidence into clean expense entries for Zaylo, a personal finance app used in Arabic and English.
Today is ${today}. If no currency is stated, use ${currency}. Egyptian "جنيه"/"LE"/"EGP" = EGP; "ريال" = SAR unless context says otherwise.
Rules:
- One entry per real purchase or payment. A receipt is ONE entry for its grand total (not per line), unless it clearly contains several separate payments.
- Ignore account balances, OTP codes, refunds, salary or money received, and promotional text.
- merchant: the shop or payee as a person would say it ("Carrefour", "Uber", "Electricity bill").
- description: a short useful note (e.g. main items on a receipt), in the user's language.
- date: the purchase date if shown or said ("yesterday" = the day before today), otherwise today.
- category must be one of: ${CATEGORIES.join(', ')}.
- confidence: how sure you are the amount and merchant are right.
- If nothing usable is present, return an empty list and explain briefly in "note".`;

    const parts: Part[] = [];
    const add = (mime: string, data: string) => {
        if (data.length * 0.75 > MAX_INLINE_BYTES) throw Object.assign(new Error('That file is too large. Use a photo or PDF under 3 MB.'), { status: 413 });
        parts.push({ inline_data: { mime_type: mime, data } });
    };
    if (b.file?.data && b.file?.mime) add(String(b.file.mime), String(b.file.data));
    const instruction = source === 'voice' ? 'This is a voice note of someone describing what they spent. Transcribe it, then extract the expenses.'
        : source === 'scan' || source === 'upload' ? 'This is a receipt, invoice or bill. Extract the payment.'
        : source === 'sms' ? 'These are bank or wallet SMS messages. Extract only the debits/purchases.'
        : 'Extract the expenses from this text.';
    parts.push({ text: `${instruction}${b.text ? `\n\nText:\n"""${String(b.text).slice(0, 6000)}"""` : ''}` });
    if (parts.length === 1 && !b.text) throw Object.assign(new Error('Nothing to read.'), { status: 400 });

    const { text } = await gemini(parts, { system, schema: EXTRACT_SCHEMA, temperature: 0 });
    const out = parseJson<{ expenses: any[]; transcript?: string; note?: string }>(text);
    const expenses = (out.expenses || []).filter(e => Number(e.amount) > 0).map(e => ({
        amount: Math.round(Number(e.amount) * 100) / 100,
        currency: /^[A-Z]{3}$/.test(String(e.currency).toUpperCase()) ? String(e.currency).toUpperCase() : currency,
        merchant: String(e.merchant || 'Unknown').slice(0, 80),
        category: CATEGORIES.includes(e.category) ? e.category : 'other',
        description: String(e.description || '').slice(0, 200),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) ? e.date : today,
        paymentMethod: PAYMENT.includes(e.paymentMethod) ? e.paymentMethod : undefined,
        confidence: Math.max(0, Math.min(1, Number(e.confidence) || 0.6)),
    }));
    return { expenses, transcript: out.transcript || '', note: out.note || '' };
}

const INSIGHTS_SCHEMA = {
    type: 'OBJECT',
    properties: {
        score: { type: 'INTEGER', description: 'Money health 0-100' },
        headline: { type: 'STRING', description: 'Max 8 words' },
        summary: { type: 'STRING', description: '2 short sentences' },
        tips: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, detail: { type: 'STRING' }, saving: { type: 'NUMBER', description: 'Estimated monthly saving in the base currency, 0 if unknown' } }, required: ['title', 'detail'] } },
        alerts: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['score', 'headline', 'summary', 'tips'],
};

async function insights(b: Record<string, any>) {
    const lang = b.language === 'ar' ? 'Arabic' : 'English';
    const system = `You are Zaylo's money coach. Voice: simple, secure, optimistic. Short sentences, plain words, no jargon, never preachy.
Write in ${lang}. Base every statement on the numbers given; do not invent figures. Amounts are in ${b.currency || 'the base currency'}.
Score guide: 80+ spending under budget and stable, savings growing; 50-79 mixed; below 50 overspending, rising costs or missed bills.
Give exactly 3 tips, each specific to a category, merchant or bill in the data, with a realistic monthly saving.
Alerts: only real issues (budget passed, bill due within 3 days, a category up >40% vs last cycle). Empty list if none.`;
    const { text } = await gemini([{ text: `Spending snapshot (JSON):\n${JSON.stringify(b.snapshot).slice(0, 12000)}` }], { system, schema: INSIGHTS_SCHEMA, temperature: 0.4 });
    const out = parseJson<any>(text);
    return {
        score: Math.max(0, Math.min(100, Math.round(Number(out.score) || 0))),
        headline: String(out.headline || ''),
        summary: String(out.summary || ''),
        tips: (out.tips || []).filter((t: { title?: string }) => t?.title).slice(0, 3),
        alerts: (out.alerts || []).slice(0, 4),
    };
}

const APP_GUIDE = `How Zaylo works (use this to answer "how do I" questions):
- Add an expense: the + button. Options: type it, "Say it" (voice note in any language), "Scan a receipt" (camera photo), "Upload a receipt or PDF", "Paste bank SMS". Zaylo fills the details; the user reviews before saving.
- Income: the + button → Add income, or Income & Earnings.
- Bills & Commitments: recurring bills with due-day reminders.
- Savings: goals with target amounts and progress.
- Insights: charts by category and month, plus the AI health summary.
- Workspaces: personal or shared (family/team). Owners and admins add or remove members; each shared workspace has a chat.
- Converter: live currency conversion. Settings: profile, language (Arabic/English), currency, theme, PIN and Face ID / fingerprint lock, budget, export to CSV/PDF, backups.
- Messages: private conversation with the Zaylo team.`;

async function chat(b: Record<string, any>) {
    const lang = b.language === 'ar' ? 'Arabic' : 'the language the user writes in';
    const system = `You are Zaylo, the assistant inside the Zaylo personal finance app. Tagline: "Your money. Your move."
Voice: simple, secure, optimistic. Short answers (under 120 words unless asked for detail), plain words, use bullet points for lists. Reply in ${lang}.
You can: answer questions about the user's own numbers using ONLY the snapshot below, explain app features, suggest budgets and savings plans, and explain money concepts.
You cannot: see anything outside the snapshot, move money, or give regulated investment, tax or legal advice — say so briefly and suggest a qualified professional when relevant.
If the snapshot doesn't contain what's needed, say what's missing instead of guessing. Format amounts with the currency code.

${APP_GUIDE}

User's snapshot (aggregated, current workspace):
${JSON.stringify(b.snapshot || {}).slice(0, 12000)}`;
    const msgs: { role: string; text: string }[] = Array.isArray(b.messages) ? b.messages.slice(-12) : [];
    const last = msgs.pop();
    if (!last?.text) throw Object.assign(new Error('Ask a question first.'), { status: 400 });
    const history = msgs.map(m => ({ role: m.role === 'assistant' ? 'model' as const : 'user' as const, text: String(m.text).slice(0, 2000) }));
    const { text } = await gemini([{ text: String(last.text).slice(0, 2000) }], { system, history, temperature: 0.5 });
    return { reply: text.trim() };
}

// ───────────────────────── Handler ─────────────────────────
async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    try {
        const userId = await verifyUser(req);
        if (!userId) return json({ error: 'Sign in to use Zaylo AI.' }, 401);
        const body = await req.json().catch(() => ({}));
        switch (body.action) {
            case 'status': return json({ ready: Boolean(process.env.GEMINI_API_KEY), model: process.env.GEMINI_MODEL || DEFAULT_MODEL });
            case 'extract': return json(await extract(body));
            case 'insights': return json(await insights(body));
            case 'chat': return json(await chat(body));
            default: return json({ error: 'Unknown action' }, 400);
        }
    } catch (e) {
        const err = e as Error & { status?: number };
        return json({ error: err.message || 'Something went wrong' }, err.status || 500);
    }
}

// A tiny unauthenticated check that the AI answers (one short call, throttled per instance).
let lastCheck = { at: 0, result: null as null | object };
async function healthCheck(): Promise<Response> {
    if (Date.now() - lastCheck.at < 30_000 && lastCheck.result) return json({ ...lastCheck.result, cached: true });
    const t = Date.now();
    try {
        const { text, model, tried } = await gemini([{ text: 'Reply with the single word OK.' }], { system: 'You are a health check. Reply OK.' });
        lastCheck = { at: Date.now(), result: { ok: /ok/i.test(text), model, ms: Date.now() - t, tried: tried.map(x => ({ model: x.model, status: x.status, ms: x.ms, error: x.error })) } };
    } catch (e) {
        lastCheck = { at: Date.now(), result: { ok: false, error: (e as Error).message, ms: Date.now() - t } };
    }
    return json(lastCheck.result);
}

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
export function POST(req: Request) { return handler(req); }
export function GET(req: Request) {
    return new URL(req.url).searchParams.has('check') ? healthCheck() : json({ error: 'Method not allowed' }, 405);
}
