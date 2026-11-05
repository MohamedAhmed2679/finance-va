/**
 * "Continue with Google" on the web, through Google's own sign-in (Google Identity Services).
 *
 * The Google window then belongs to zaylo.cc ("to continue to zaylo.cc", or "Zaylo" once Google has
 * verified the branding) instead of the Supabase project address that the redirect flow shows.
 * Google returns an ID token, which Supabase turns into a normal session (signInWithIdToken).
 *
 * The phone apps and the desktop app keep the redirect flow: Google doesn't allow its sign-in
 * inside embedded web views, so those open the system browser.
 */
import { Capacitor } from '@capacitor/core';
import { supabase, isSupabaseReady } from '../lib/supabase';
import type { AuthResult } from './authProvider';

// The same OAuth client Supabase's Google provider uses (a public identifier, not a secret)
export const GOOGLE_WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)
    || '1047772281937-sjk6sj4gg0bk8n5anja51t57p0giteb4.apps.googleusercontent.com';

interface GsiId {
    initialize(cfg: Record<string, unknown>): void;
    renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
    cancel(): void;
}
declare global { interface Window { google?: { accounts?: { id?: GsiId } } } }

const isElectron = () => typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

/** True where Google's own button can be used (a normal browser on zaylo.cc or localhost). */
export function canUseGoogleButton() {
    if (typeof window === 'undefined' || !isSupabaseReady()) return false;
    if (Capacitor.isNativePlatform() || isElectron()) return false;
    return Boolean(GOOGLE_WEB_CLIENT_ID);
}

let loading: Promise<GsiId> | null = null;
function loadGsi(): Promise<GsiId> {
    if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
    if (loading) return loading;
    loading = new Promise<GsiId>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not load')));
        s.onerror = () => { loading = null; reject(new Error('Google sign-in could not load')); };
        document.head.appendChild(s);
    });
    return loading;
}

async function sha256Hex(text: string) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Renders Google's button into `el` (sized to `width`). Each mount gets a fresh nonce, which
 * Supabase checks against the ID token. Calls onResult after Supabase has created the session.
 */
export async function mountGoogleButton(el: HTMLElement, opts: { width: number; locale: string; theme?: string; onStart?: () => void; onResult: (r: AuthResult) => void }) {
    const gsi = await loadGsi();
    const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
    const hashed = await sha256Hex(raw);
    gsi.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        nonce: hashed,
        ux_mode: 'popup',
        auto_select: false,
        itp_support: true,
        use_fedcm_for_button: true,
        callback: async (resp: { credential?: string }) => {
            opts.onStart?.();
            opts.onResult(await signInWithGoogleIdToken(resp.credential, raw));
        },
    });
    el.innerHTML = '';
    gsi.renderButton(el, { type: 'standard', theme: opts.theme || 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center', width: Math.max(200, Math.min(400, Math.round(opts.width))), locale: opts.locale });
}

export async function signInWithGoogleIdToken(token: string | undefined, nonce: string): Promise<AuthResult> {
    if (!token || !supabase) return { success: false, error: 'Google sign-in was cancelled.' };
    try {
        const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token, nonce });
        if (error) throw error;
        const u = data.user;
        return {
            success: true,
            user: {
                id: u.id,
                name: u.user_metadata?.full_name || u.user_metadata?.name || (u.email || '').split('@')[0],
                email: u.email || '',
                provider: 'google',
                avatarUrl: u.user_metadata?.avatar_url || u.user_metadata?.picture,
            },
        };
    } catch (err) {
        return { success: false, error: (err as Error).message || 'Google sign-in failed' };
    }
}
