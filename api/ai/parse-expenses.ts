export const config = { runtime: 'edge' };

const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const CATEGORIES = ['groceries', 'dining', 'transport', 'shopping', 'entertainment', 'utilities', 'healthcare', 'travel', 'education', 'other'];

function buildPrompt(text: string, baseCurrency: string, date: string) {
    return `Extract every expense from the text below (it may be a bank SMS, a spoken sentence, Arabic or English).
Today: ${date}. Default currency if none is stated: ${baseCurrency}.
Reply with JSON only, no markdown: {"expenses":[{"amount":number,"currency":"3-letter ISO code","merchant":string,"category":one of ${JSON.stringify(CATEGORIES)},"description":string,"confidence":number 0-1}]}
Ignore balances, OTPs and incoming credits.
Text: """${text.slice(0, 2000)}"""`;
}

function extractJson(content: string) {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}') + 1;
    if (start < 0 || end <= start) throw new Error('AI returned no JSON');
    const parsed = JSON.parse(content.slice(start, end));
    const list = Array.isArray(parsed.expenses) ? parsed.expenses : [];
    return list
        .filter((e: any) => Number(e.amount) > 0)
        .map((e: any) => ({
            amount: Number(e.amount),
            currency: String(e.currency || '').toUpperCase().slice(0, 3),
            merchant: String(e.merchant || 'Unknown').slice(0, 80),
            category: CATEGORIES.includes(e.category) ? e.category : 'other',
            description: String(e.description || '').slice(0, 140),
            confidence: Math.max(0, Math.min(1, Number(e.confidence) || 0.6)),
        }));
}

async function viaGemini(prompt: string, key: string) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || `Gemini ${res.status}`);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function viaAnthropic(prompt: string, key: string) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text || '';
}

export default async function handler(req: Request) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

    try {
        const { text, baseCurrency, dateContext } = await req.json();
        if (!text || typeof text !== 'string') {
            return new Response(JSON.stringify({ error: 'Text is required' }), { status: 400, headers: corsHeaders });
        }
        const prompt = buildPrompt(text, baseCurrency || 'USD', dateContext || new Date().toISOString().slice(0, 10));

        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!anthropicKey && !geminiKey) {
            return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 503, headers: corsHeaders });
        }
        const content = anthropicKey ? await viaAnthropic(prompt, anthropicKey) : await viaGemini(prompt, geminiKey!);
        return new Response(JSON.stringify({ expenses: extractJson(content) }), { status: 200, headers: corsHeaders });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), { status: 502, headers: corsHeaders });
    }
}
