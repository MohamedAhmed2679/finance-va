export const config = { runtime: 'edge' };

const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req: Request) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        const { prompt } = await req.json();
        if (!prompt) {
            return new Response(JSON.stringify({ error: 'Prompt is required' }), { status: 400, headers: corsHeaders });
        }

        const geminiKey = process.env.GEMINI_API_KEY;
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (!geminiKey && !anthropicKey) {
            return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 503, headers: corsHeaders });
        }

        if (!geminiKey && anthropicKey) {
            const r = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: String(prompt).slice(0, 4000) }] }),
            });
            const d = await r.json();
            if (!r.ok) return new Response(JSON.stringify({ error: d.error?.message || 'AI error' }), { status: 502, headers: corsHeaders });
            return new Response(JSON.stringify({ text: d.content?.[0]?.text || '' }), { status: 200, headers: corsHeaders });
        }

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: String(prompt).slice(0, 4000) }] }] }),
            }
        );

        const data = await res.json();
        if (data.error) {
            return new Response(JSON.stringify({ error: data.error.message }), { status: 502, headers: corsHeaders });
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return new Response(JSON.stringify({ text }), { status: 200, headers: corsHeaders });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
    }
}
