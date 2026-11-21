/**
 * Zaylo — Supabase Auth Provider
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
import { setRecovering } from './recovery';

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
        // Phone apps: Google through zaylo.cc, so Google's window names Zaylo instead of the Supabase project
        if (native && provider === 'google') {
            const { startAppGoogleSignIn } = await import('./googleSignIn');
            await startAppGoogleSignIn();
            return { success: true };
        }
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
    } catch (err: unknown) {
        return { success: false, error: (err instanceof Error ? err.message : '') || 'OAuth sign-in failed' };
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
    } catch (err: unknown) {
        return { success: false, error: (err instanceof Error ? err.message : '') || 'Sign-in failed' };
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
        // With email confirmation on, an email that already has an account comes back as a user with
        // no identities and no error (so addresses can't be probed). Say so instead of "check your inbox".
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            return { success: false, error: 'User already registered' };
        }

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
    } catch (err: unknown) {
        return { success: false, error: (err instanceof Error ? err.message : '') || 'Sign-up failed' };
    }
}

/** Sends the sign-up confirmation email again. */
export async function resendConfirmation(email: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseReady() || !supabase) return { success: true };
    const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: isNative() ? NATIVE_AUTH_REDIRECT : getOAuthRedirectTo() },
    });
    return error ? { success: false, error: error.message } : { success: true };
}

// ─── Password Reset / Recovery ───────────────────────────────────
export async function resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseReady() || !supabase) {
        return { success: true };
    }

    try {
        // The link must come back to where the request was made: the PKCE secret for it is kept there.
        // In the phone app that's the app itself (its deep link), not zaylo.cc in the phone's browser.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: isNative() ? NATIVE_AUTH_REDIRECT : window.location.origin + '/?type=recovery',
        });
        if (error) throw error;
        return { success: true };
    } catch (err: unknown) {
        return { success: false, error: (err instanceof Error ? err.message : '') || 'Failed to send reset email' };
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
    } catch (err: unknown) {
        return { success: false, error: (err instanceof Error ? err.message : '') || 'Failed to update password' };
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
    } catch (err: unknown) {
        return { success: false, error: (err instanceof Error ? err.message : '') || 'Failed to send OTP' };
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
    } catch (err: unknown) {
        return { success: false, error: (err instanceof Error ? err.message : '') || 'OTP verification failed' };
    }
}

// ─── Sign Out ────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
    if (isSupabaseReady() && supabase) {
        await supabase.auth.signOut();
    }
}

// ─── Auth State Listener ─────────────────────────────────────────
export function onAuthStateChange(callback: (event: string, user: import('@supabase/supabase-js').User | null) => void) {
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
                const idToken = params.get('id_token');
                if (idToken) {
                    const { finishAppGoogleSignIn } = await import('./googleSignIn');
                    const r = await finishAppGoogleSignIn(idToken, params.get('state') || '');
                    if (!r.success) throw new Error(r.error);
                } else if (code) {
                    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
                    if (error) throw error;
                    // A password-reset link: ask for the new password before opening the app
                    if ((data as { redirectType?: string | null }).redirectType === 'recovery' || params.get('type') === 'recovery') setRecovering(true);
                } else if (params.get('token_hash') && params.get('type')) {
                    await verifyEmailLink(params.get('token_hash')!, params.get('type')!);
                } else if (params.get('access_token') && params.get('refresh_token')) {
                    await supabase.auth.setSession({ access_token: params.get('access_token')!, refresh_token: params.get('refresh_token')! });
                }
                onSignedIn();
            } catch (err) {
                console.error('[Auth] Native OAuth exchange failed', err);
                import('react-hot-toast').then(({ default: toast }) => toast.error(friendlyAuthError((err as Error).message, 'Sign-in failed. Try again.'), { id: 'native-auth', duration: 8000 }));
            } finally {
                import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {}));
            }
        }).then(handle => { remove = () => handle.remove(); });
    });
    return () => remove?.();
}

// ─── Email links that carry a token_hash (work in any browser or device) ───
type EmailLinkType = 'recovery' | 'signup' | 'email' | 'invite' | 'magiclink' | 'email_change';
const EMAIL_LINK_TYPES: EmailLinkType[] = ['recovery', 'signup', 'email', 'invite', 'magiclink', 'email_change'];

/** Confirms an email link of the form ?token_hash=…&type=…  Unlike ?code= links, these don't depend on where the request was made. */
export async function verifyEmailLink(tokenHash: string, type: string): Promise<void> {
    if (!supabase) return;
    if (!EMAIL_LINK_TYPES.includes(type as EmailLinkType)) throw new Error('That link is not valid.');
    if (type === 'recovery') setRecovering(true);
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailLinkType });
    if (error) { if (type === 'recovery') setRecovering(false); throw error; }
}

/** Web: handles a token_hash link in the address bar. Returns an error sentence when the link didn't work. */
export async function consumeEmailLinkFromUrl(): Promise<string | null> {
    if (typeof window === 'undefined' || !supabase) return null;
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get('token_hash');
    const type = url.searchParams.get('type');
    if (!tokenHash || !type) return null;
    url.searchParams.delete('token_hash');
    if (type !== 'recovery') url.searchParams.delete('type');
    window.history.replaceState({}, '', url.pathname + (url.search || ''));
    try { await verifyEmailLink(tokenHash, type); return null; }
    catch (err) { return friendlyAuthError((err as Error).message, 'That link didn\'t work. Request a new one.'); }
}

// ─── Which sign-in methods are switched on in Supabase ───────────
export interface AuthAvailability {
    reachable: boolean;
    google: boolean; apple: boolean; azure: boolean;
    phone: boolean; email: boolean; signupDisabled: boolean;
}

let availability: Promise<AuthAvailability> | null = null;

/** Reads GoTrue's public /settings so the UI only offers methods that will work. */
export function getAuthAvailability(): Promise<AuthAvailability> {
    if (availability) return availability;
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const none: AuthAvailability = { reachable: false, google: false, apple: false, azure: false, phone: false, email: false, signupDisabled: false };
    if (!url || !key) return Promise.resolve({ ...none, reachable: true, google: true, apple: true, azure: true, phone: true, email: true });
    availability = fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
        .then((s: { external?: Record<string, boolean>; disable_signup?: boolean }) => ({
            reachable: true,
            google: Boolean(s.external?.google),
            apple: Boolean(s.external?.apple),
            azure: Boolean(s.external?.azure),
            phone: Boolean(s.external?.phone),
            email: s.external?.email !== false,
            signupDisabled: Boolean(s.disable_signup),
        }))
        .catch(() => { availability = null; return none; });
    return availability;
}

/** Turns Supabase/network errors into sentences a person can act on. */
export function friendlyAuthError(message: string | undefined, fallback: string): string {
    const m = message || '';
    if (/failed to fetch|networkerror|load failed/i.test(m)) return "Can't reach the Zaylo server. Check your connection and try again.";
    if (/unsupported phone provider|phone.*(disabled|not enabled)|sms.*provider/i.test(m)) return 'Phone sign-in is not switched on yet. Use email for now.';
    if (/provider is not enabled|unsupported provider/i.test(m)) return 'That sign-in option is not switched on yet. Use email for now.';
    if (/signups? not allowed|signup is disabled/i.test(m)) return 'New sign-ups are closed right now.';
    if (/database error saving new user/i.test(m)) return "Your account couldn't be set up. Please try again in a minute.";
    if (/unable to exchange external code|invalid_client|AADSTS7000215|AADSTS7000222/i.test(m)) return "That sign-in provider isn't set up correctly yet, so it couldn't finish signing you in. Use email for now.";
    if (/AADSTS50020|AADSTS50194/i.test(m)) return 'Microsoft sign-in only accepts accounts from one organisation right now. Use email instead.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    if (/invalid.*phone|phone.*invalid/i.test(m)) return 'That phone number is not valid. Include the country code, for example +20 100 123 4567.';
    if (/code verifier|flow state|both auth code and code verifier/i.test(m)) return 'That link was opened in a different browser or app from the one you started in, or it has expired. If you were confirming your email, it is confirmed now: sign in. For a password reset, request a new link and open it on this device.';
    if (/email link is invalid|link.*expired|otp_expired/i.test(m)) return 'That link has expired or was already used. Request a new one.';
    if (/token has expired|otp.*(expired|invalid)/i.test(m)) return 'That code is wrong or has expired. Request a new one.';
    if (/email not confirmed/i.test(m)) return 'Confirm your email first. The link is in your inbox (check spam too).';
    if (/user already registered|already been registered/i.test(m)) return 'An account with this email already exists. Sign in instead.';
    if (/new password should be different/i.test(m)) return 'Choose a password you haven\'t used for this account before.';
    if (/password.*(weak|pwned|leaked|known)/i.test(m)) return 'That password appears in known data leaks. Choose a different one.';
    if (/aal2|mfa/i.test(m)) return 'Enter your two-step verification code first.';
    return m || fallback;
}
