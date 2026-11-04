/**
 * Finance VA — Supabase Auth Provider
 *
 * This module wraps Supabase Auth and provides fallback behaviour
 * when Supabase is not configured (local dev / offline mode).
 *
 * In production (Supabase configured): Uses real OAuth, OTP, and session management.
 * In dev mode (no Supabase): Falls back to simulated auth via Zustand store.
 */

import { supabase, isSupabaseReady } from '../lib/supabase';
import type { Provider } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

/** Deep link the native apps register (Android intent-filter / iOS URL type). */
export const NATIVE_AUTH_REDIRECT = 'com.financeva.app://auth-callback';
const isNative = () => Capacitor.isNativePlatform();

// ─── Types ───────────────────────────────────────────────────────
export interface AuthResult {
    success: boolean;
    user?: {
        id: string;
        name: string;
        email: string;
        phone?: string;
        provider?: string;
        avatarUrl?: string;
    };
    error?: string;
    needsConfirmation?: boolean;
}

// ─── OAuth Sign-In (Google / Apple / Microsoft) ──────────────────
export async function signInWithOAuth(provider: 'google' | 'apple' | 'azure'): Promise<AuthResult> {
    if (!isSupabaseReady() || !supabase) {
        // Fallback: simulate for local dev
        return simulateOAuth(provider);
    }

    try {
        const native = isNative();
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: provider as Provider,
            options: {
                redirectTo: native ? NATIVE_AUTH_REDIRECT : getOAuthRedirectTo(),
                // Native apps open the provider in the system browser (Google blocks embedded web views)
                skipBrowserRedirect: native,
                scopes: provider === 'google'
                    ? 'openid email profile'
                    : provider === 'azure'
                    ? 'openid profile email User.Read'
                    : 'openid name email',
            },
        });

        if (error) throw error;

        if (native && data?.url) {
            const { Browser } = await import('@capacitor/browser');
            await Browser.open({ url: data.url, presentationStyle: 'popover' });
        }
        // On the web the page redirects to the provider; the session is picked up on return.
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || 'OAuth sign-in failed' };
    }
}

function getOAuthRedirectTo(): string {
    const configuredRedirect = import.meta.env.VITE_AUTH_REDIRECT_URL;
    if (typeof configuredRedirect === 'string' && configuredRedirect.trim()) {
        return configuredRedirect.trim();
    }

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3000/';
    }

    return `${window.location.origin}/`;
}

// ─── Email/Password Sign-In ──────────────────────────────────────
export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    if (!isSupabaseReady() || !supabase) {
        return simulateEmailAuth(email);
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        return {
            success: true,
            user: {
                id: data.user.id,
                name: data.user.user_metadata?.full_name || email.split('@')[0],
                email: data.user.email || email,
                phone: data.user.phone,
            },
        };
    } catch (err: any) {
        return { success: false, error: err.message || 'Sign-in failed' };
    }
}

// ─── Email/Password Sign-Up ──────────────────────────────────────
export async function signUpWithEmail(
    email: string,
    password: string,
    name: string,
    phone?: string,
    country?: string
): Promise<AuthResult> {
    if (!isSupabaseReady() || !supabase) {
        return simulateEmailAuth(email, name);
    }

    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: isNative() ? NATIVE_AUTH_REDIRECT : getOAuthRedirectTo(),
                data: {
                    full_name: name,
                    phone,
                    country,
                },
            },
        });

        if (error) throw error;

        // When email confirmation is on, Supabase returns a user but no session yet.
        return {
            success: true,
            needsConfirmation: !data.session,
            user: {
                id: data.user?.id || '',
                name,
                email,
                phone,
            },
        };
    } catch (err: any) {
        return { success: false, error: err.message || 'Sign-up failed' };
    }
}

// ─── Password Reset / Recovery ───────────────────────────────────
export async function resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseReady() || !supabase) {
        return { success: true };
    }

    try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/?type=recovery',
        });
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || 'Failed to send reset email' };
    }
}

export async function updatePassword(password: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseReady() || !supabase) {
        return { success: true };
    }

    try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || 'Failed to update password' };
    }
}

// ─── Phone OTP ───────────────────────────────────────────────────
export async function sendPhoneOtp(phone: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseReady() || !supabase) {
        // Simulate OTP delivery
        return { success: true };
    }

    try {
        const { error } = await supabase.auth.signInWithOtp({ phone });
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || 'Failed to send OTP' };
    }
}

export async function verifyPhoneOtp(phone: string, token: string): Promise<AuthResult> {
    if (!isSupabaseReady() || !supabase) {
        return {
            success: true,
            user: {
                id: `user_${Date.now()}`,
                name: 'Phone User',
                email: phone,
                phone,
                provider: 'phone',
            },
        };
    }

    try {
        const { data, error } = await supabase.auth.verifyOtp({
            phone,
            token,
            type: 'sms',
        });

        if (error) throw error;

        return {
            success: true,
            user: {
                id: data.user?.id || '',
                name: data.user?.user_metadata?.full_name || 'Phone User',
                email: data.user?.email || phone,
                phone,
                provider: 'phone',
            },
        };
    } catch (err: any) {
        return { success: false, error: err.message || 'OTP verification failed' };
    }
}

// ─── Sign Out ────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
    if (isSupabaseReady() && supabase) {
        await supabase.auth.signOut();
    }
}

// ─── Auth State Listener ─────────────────────────────────────────
export function onAuthStateChange(callback: (event: string, user: any) => void) {
    if (!isSupabaseReady() || !supabase) return { unsubscribe: () => {} };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
        callback(event, session?.user ?? null);
    });

    return { unsubscribe: () => data.subscription.unsubscribe() };
}

// ─── Get Provider Token (for cloud backup) ───────────────────────
export async function getProviderToken(): Promise<string | null> {
    if (!isSupabaseReady() || !supabase) return null;

    const { data } = await supabase.auth.getSession();
    return data.session?.provider_token ?? null;
}

// ─── Simulation Helpers (for local dev without Supabase) ─────────
function simulateOAuth(provider: string): Promise<AuthResult> {
    return new Promise((resolve) => {
        setTimeout(() => {
            const providerNames: Record<string, string> = {
                google: 'Google User',
                apple: 'Apple User',
                azure: 'Microsoft User',
            };
            const providerEmails: Record<string, string> = {
                google: 'google@example.com',
                apple: 'apple@icloud.com',
                azure: 'user@office365.com',
            };

            resolve({
                success: true,
                user: {
                    id: `user_${Date.now()}`,
                    name: providerNames[provider] || 'OAuth User',
                    email: providerEmails[provider] || 'user@example.com',
                    provider,
                },
            });
        }, 1000);
    });
}

function simulateEmailAuth(email: string, name?: string): Promise<AuthResult> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                success: true,
                user: {
                    id: `user_${Date.now()}`,
                    name: name || email.split('@')[0],
                    email,
                },
            });
        }, 800);
    });
}

// ─── Native deep-link OAuth return (Android / iOS) ───────────────
/**
 * Listens for com.financeva.app://auth-callback?code=… and exchanges the PKCE code
 * for a session inside the app's web view. Returns an unsubscribe function.
 */
export function initNativeAuthListener(onSignedIn: () => void): () => void {
    if (!isNative() || !supabase) return () => {};
    let remove: (() => void) | undefined;
    import('@capacitor/app').then(({ App }) => {
        App.addListener('appUrlOpen', async ({ url }) => {
            if (!url.startsWith(NATIVE_AUTH_REDIRECT) || !supabase) return;
            const params = new URL(url.replace('#', '?')).searchParams;
            const code = params.get('code');
            try {
                if (code) {
                    const { error } = await supabase.auth.exchangeCodeForSession(code);
                    if (error) throw error;
                } else if (params.get('access_token') && params.get('refresh_token')) {
                    await supabase.auth.setSession({ access_token: params.get('access_token')!, refresh_token: params.get('refresh_token')! });
                }
                onSignedIn();
            } catch (err) {
                console.error('[Auth] Native OAuth exchange failed', err);
            } finally {
                import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {}));
            }
        }).then(handle => { remove = () => handle.remove(); });
    });
    return () => remove?.();
}
