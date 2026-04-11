import { useStore } from '../store/useStore';
import type { CategoryKey } from '../store/useStore';

export interface ParsedExpense {
    amount: number;
    currency: string;
    merchant: string;
    category: CategoryKey;
    description: string;
    confidence: number;
}

export async function parseExpensesText(text: string, baseCurrency: string): Promise<ParsedExpense[]> {
    try {
        const geminiKey = useStore.getState().user?.geminiKey || import.meta.env.VITE_GEMINI_API_KEY || '';
        const prompt = `Extract expenses from this text. Base currency is ${baseCurrency}. Text: "${text}".
Return ONLY a valid JSON array of objects. Example: [{"amount":12.50,"currency":"USD","merchant":"Uber","category":"transport","description":"Ride home","confidence":0.95}]`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!response.ok) {
            throw new Error(`Failed to parse: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        // Cleanup markdown code blocks if any
        const jsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const expenses = JSON.parse(jsonText);
        
        return Array.isArray(expenses) ? expenses : [];
    } catch (error) {
        console.error('AI Parser Error:', error);
        
        // Very basic local fallback just in case the API is completely down/missing during dev
        const mockFallback: ParsedExpense = {
            amount: 0,
            currency: baseCurrency,
            merchant: 'Unknown',
            category: 'other',
            description: text.substring(0, 50),
            confidence: 0
        };
        
        // Simple regex attempt at an amount
        const amountMatch = text.match(/\$?\d+(\.\d{2})?/);
        if (amountMatch) {
            mockFallback.amount = parseFloat(amountMatch[0].replace('$', ''));
            mockFallback.confidence = 0.3;
        }
        
        return [mockFallback];
    }
}
