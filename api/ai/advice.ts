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

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 503, headers: corsHeaders });
        }

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
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
