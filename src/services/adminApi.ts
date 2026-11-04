import { supabase } from '../lib/supabase';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const IMPERSONATION_KEY = 'fva_admin_session';

/** Calls /api/admin with the signed-in admin's access token. Throws with a readable message. */
export async function adminCall<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!supabase) throw new Error('Not connected to the database');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sign in again to use the admin console');
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

// ─── Impersonation ───────────────────────────────────────────────
// The admin's own session is kept in sessionStorage (this tab only) while
// they act as the user; "Return to admin" restores it.

export interface ImpersonationInfo { name: string; email: string; adminEmail: string }

export function getImpersonation(): ImpersonationInfo | null {
    try {
        const raw = sessionStorage.getItem(IMPERSONATION_KEY);
        return raw ? JSON.parse(raw).info : null;
    } catch { return null; }
}

export async function startImpersonation(userId: string) {
    if (!supabase) throw new Error('Not connected');
    const { data: current } = await supabase.auth.getSession();
    const adminSession = current.session;
    if (!adminSession) throw new Error('Sign in again first');
    const res = await adminCall<{ tokenHash: string; email: string; name: string }>('impersonate', { id: userId });
    sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
        info: { name: res.name, email: res.email, adminEmail: adminSession.user.email },
    }));
    const { error } = await supabase.auth.verifyOtp({ token_hash: res.tokenHash, type: 'magiclink' });
    if (error) {
        sessionStorage.removeItem(IMPERSONATION_KEY);
        await supabase.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token });
        throw new Error(error.message);
    }
}

export async function stopImpersonation() {
    if (!supabase) return;
    const raw = sessionStorage.getItem(IMPERSONATION_KEY);
    sessionStorage.removeItem(IMPERSONATION_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const { error } = await supabase.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token });
    if (error) await supabase.auth.signOut();
}
