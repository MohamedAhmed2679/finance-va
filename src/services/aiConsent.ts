/**
 * Permission to send data to the AI provider.
 *
 * Nothing goes to the AI provider until the person has said yes to the notice below. Each yes and
 * each withdrawal is recorded on the server (consent_events, append-only). The server checks the
 * latest record before every AI call, so this client-side gate is a courtesy, not the control.
 */
import { supabase, isSupabaseReady } from '../lib/supabase';
import { useStore } from '../store/useStore';

/** Change this whenever the notice text or the data sent changes: people are asked again. */
export const AI_NOTICE_VERSION = '2026-11-10';
export const AI_PROVIDER = 'Google (Gemini API)';
export const AI_PURPOSE = 'ai_processing';

export type AiSurface = 'assistant' | 'insights' | 'capture' | 'smart_cart' | 'autotrack' | 'settings';

/** What each AI feature sends. Shown in the notice; keep it in step with zayloAI.ts and api/ai/zaylo.ts. */
export const AI_DATA_SENT: { feature: string; sends: string }[] = [
    { feature: 'Zaylo AI Assistant', sends: 'Your question, earlier messages in the same conversation, and a summary of the current workspace: totals by category and month, your budget, your 15 most recent expenses (date, shop, category, amount), your bills and your savings goals.' },
    { feature: 'Money health summary', sends: 'The same workspace summary, without your questions.' },
    { feature: 'Voice notes, receipts and pasted text', sends: 'The recording, photo, PDF or text you choose to submit.' },
    { feature: 'Smart Cart price tags', sends: 'The photo of the price tag or packaging.' },
    { feature: 'AutoTrack AI reading (separate switch)', sends: 'An unrecognised bank alert with account numbers masked. Security codes are never sent.' },
];
export const AI_NEVER_SENT = 'Passwords, PINs, your email address or phone number, your name, card numbers, files from workspace chat, and your full transaction history are not sent.';

interface Cached { granted: boolean; version: string; at: string }
const key = () => `zaylo_ai_consent_${useStore.getState().user?.dbId || useStore.getState().user?.id || 'anon'}`;
const read = (): Cached | null => { try { return JSON.parse(localStorage.getItem(key()) || 'null'); } catch { return null; } };
const write = (c: Cached | null) => { try { if (c) localStorage.setItem(key(), JSON.stringify(c)); else localStorage.removeItem(key()); } catch { /* storage blocked */ } window.dispatchEvent(new Event('zaylo:ai-consent-changed')); };

/** True when this person has allowed AI processing under the current notice (as last known on this device). */
export function hasAiConsent(): boolean {
    const c = read();
    return Boolean(c?.granted && c.version === AI_NOTICE_VERSION);
}
export const aiConsentInfo = () => read();

export interface ConsentEvent { id: string; granted: boolean; notice_version: string; provider: string | null; surface: string | null; created_at: string }

/** Reads the latest record from the server and updates this device. Returns null if it can't be reached. */
export async function refreshAiConsent(): Promise<boolean | null> {
    const me = useStore.getState().user?.dbId;
    if (!me || !isSupabaseReady() || !supabase) return null;
    const { data, error } = await supabase.from('consent_events').select('granted, notice_version, created_at')
        .eq('user_id', me).eq('purpose', AI_PURPOSE).order('created_at', { ascending: false }).limit(1);
    if (error) return null;
    const last = data?.[0];
    write(last ? { granted: last.granted, version: last.notice_version, at: last.created_at } : null);
    return hasAiConsent();
}

export async function consentHistory(): Promise<ConsentEvent[]> {
    const me = useStore.getState().user?.dbId;
    if (!me || !supabase) return [];
    const { data } = await supabase.from('consent_events').select('id, granted, notice_version, provider, surface, created_at')
        .eq('user_id', me).eq('purpose', AI_PURPOSE).order('created_at', { ascending: false }).limit(50);
    return (data as ConsentEvent[]) || [];
}

/** Records a yes or a withdrawal. Throws if it can't be recorded, so a yes is never assumed. */
export async function setAiConsent(granted: boolean, surface: AiSurface): Promise<void> {
    const me = useStore.getState().user?.dbId;
    if (!granted) write({ granted: false, version: AI_NOTICE_VERSION, at: new Date().toISOString() }); // a withdrawal applies on this device at once
    if (!me || !isSupabaseReady() || !supabase) throw new Error(granted ? 'Connect to the internet and sign in to turn on AI features.' : 'AI features are off on this device. Connect to the internet so the change is saved to your account.');
    const { error } = await supabase.from('consent_events').insert({ user_id: me, purpose: AI_PURPOSE, granted, notice_version: AI_NOTICE_VERSION, provider: AI_PROVIDER, surface });
    if (error) throw new Error(granted ? 'Your choice couldn\'t be saved, so AI features stay off. Try again.' : 'AI features are off on this device, but the change couldn\'t be saved to your account. Try again when you\'re online.');
    write({ granted, version: AI_NOTICE_VERSION, at: new Date().toISOString() });
}

// ───────────────────────── Asking ─────────────────────────
type Ask = { surface: AiSurface; resolve: (ok: boolean) => void };
let pending: Ask | null = null;
const listeners = new Set<(a: Ask | null) => void>();
export const onConsentAsk = (fn: (a: Ask | null) => void) => { listeners.add(fn); fn(pending); return () => { listeners.delete(fn); }; };
export function answerConsentAsk(ok: boolean) { const p = pending; pending = null; listeners.forEach(l => l(null)); p?.resolve(ok); }

/**
 * Makes sure AI processing is allowed before a feature uses it. Shows the notice if needed.
 * Resolves false when the person declines; the feature must then stop without sending anything.
 */
export async function ensureAiConsent(surface: AiSurface): Promise<boolean> {
    if (hasAiConsent()) return true;
    const known = await refreshAiConsent();   // allowed earlier on another device?
    if (known) return true;
    if (pending) return new Promise(res => { const prev = pending!.resolve; pending!.resolve = ok => { prev(ok); res(ok); }; });
    return new Promise<boolean>(resolve => { pending = { surface, resolve }; listeners.forEach(l => l(pending)); });
}

export class AiConsentDeclined extends Error {
    constructor() { super('AI features are off. You can turn them on in Settings, under AI and data.'); this.name = 'AiConsentDeclined'; }
}
