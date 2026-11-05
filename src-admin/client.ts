import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * The console keeps its own session (separate storage key), so signing in here
 * never touches a Zaylo app session in the same browser, and opening the
 * app as another user never signs the admin out of the console.
 */
export const sb = url && anon
    ? createClient(url, anon, { auth: { storageKey: 'fva-admin-console', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } })
    : null;

/** Where the member-facing app lives (used for impersonation and email links). */
export const MAIN_APP_URL: string = import.meta.env.VITE_MAIN_APP_URL
    || (/finance-va-admin/.test(window.location.hostname) ? 'https://finance-va.vercel.app' : window.location.origin);

/** Base path of the console on this host ("/console" on the app domain, "" on its own domain). */
export const CONSOLE_BASE = window.location.pathname.startsWith('/console') ? '/console' : '';

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE ?? (CONSOLE_BASE ? '' : MAIN_APP_URL);

/** Calls /api/admin with the console session's access token. */
export async function adminCall<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!sb) throw new Error('Not connected to the database');
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Your session ended. Sign in again.');
    const res = await fetch(`${API_BASE}/api/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...payload }),
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body as T;
}

/** Opens the app in a new tab, signed in as the chosen user. The console session is untouched. */
export async function openAsUser(userId: string) {
    const tab = window.open('about:blank', '_blank');
    try {
        const res = await adminCall<{ tokenHash: string; email: string; name: string }>('impersonate', { id: userId });
        const hash = new URLSearchParams({ impersonate: res.tokenHash, as: res.name || res.email || 'user', email: res.email || '' });
        const target = `${MAIN_APP_URL}/overview#${hash.toString()}`;
        if (tab) tab.location.href = target; else window.location.assign(target);
    } catch (e) {
        tab?.close();
        throw e;
    }
}

export interface Me { id: string; name: string; email: string }
