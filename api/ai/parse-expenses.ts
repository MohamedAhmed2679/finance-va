export const config = {
    runtime: 'edge', // Using Edge runtime
};

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { text, baseCurrency, dateContext } = await req.json();

        if (!text) {
            return new Response(JSON.stringify({ error: 'Text is required' }), { status: 400 });
        }

        const prompt = `
You are a financial AI agent. Extract expenses from the following text.
Current Date: ${dateContext || new Date().toISOString().split('T')[0]}
Base Currency: ${baseCurrency || 'USD'}

Respond STRICTLY in JSON format without markdown wrapping, using exactly this schema:
{
  "expenses": [
    {
      "amount": (number),
      "currency": (string, 3-letter code),
      "merchant": (string),
      "category": (string: one of 'dining', 'groceries', 'transport', 'shopping', 'entertainment', 'utilities', 'healthcare', 'housing', 'education', 'personal', 'travel', 'other'),
      "description": (string, short description),
      "confidence": (number between 0 and 1, where <0.7 means you are unsure)
    }
  ]
}

Text: "${text}"
`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY || '',
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1024,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Anthropic API error: ${response.status} ${err}`);
        }

        const data = await response.json();
        const content = data.content?.[0]?.text || '';
        
        // Attempt to parse JSON
        let parsed = { expenses: [] };
        try {
            const start = content.indexOf('{');
            const end = content.lastIndexOf('}') + 1;
            parsed = JSON.parse(content.slice(start, end));
        } catch (e) {
            console.error('Failed to parse AI response:', content);
            throw new Error('AI returned malformed JSON');
        }

        return new Response(JSON.stringify(parsed), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
