import { supabase } from '../lib/supabase';

/**
 * Admin "open app as user" support. The admin console (a separate app with its
 * own session) opens this app in a new tab at /overview#impersonate=<token>.
 * We exchange the one-time token for that user's session here; the console's
 * own session is never touched.
 */
const KEY = 'fva_impersonation';

export interface ImpersonationInfo { name: string; email: string }

export function getImpersonation(): ImpersonationInfo | null {
    try { const raw = sessionStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Consumes an #impersonate=… link if present. Safe to call on every boot. */
export async function consumeImpersonationLink(): Promise<void> {
    if (!supabase || !window.location.hash.includes('impersonate=')) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const tokenHash = params.get('impersonate');
    // Remove the token from the address bar before anything else.
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
    if (!tokenHash) return;
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) { console.error('[Admin] Could not open the app as this user:', error.message); return; }
    try {
        sessionStorage.setItem(KEY, JSON.stringify({ name: params.get('as') || data.user?.email || 'user', email: params.get('email') || data.user?.email || '' }));
    } catch { /* storage unavailable */ }
}

/** Signs this tab out of the user's account and closes it. */
export async function endImpersonation() {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    await supabase?.auth.signOut();
    window.close();
    window.location.assign('/');
}
