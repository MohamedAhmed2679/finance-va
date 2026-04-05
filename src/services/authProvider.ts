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
}

// ─── OAuth Sign-In (Google / Apple / Microsoft) ──────────────────
export async function signInWithOAuth(provider: 'google' | 'apple' | 'azure'): Promise<AuthResult> {
    if (!isSupabaseReady() || !supabase) {
        // Fallback: simulate for local dev
        return simulateOAuth(provider);
    }

    try {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: provider as Provider,
            options: {
                redirectTo: `${window.location.origin}/`,
                scopes: provider === 'google'
                    ? 'openid email profile https://www.googleapis.com/auth/drive.appdata'
                    : provider === 'azure'
                    ? 'openid profile email User.Read Files.ReadWrite.AppFolder'
                    : 'openid name email',
            },
        });

        if (error) throw error;

        // OAuth redirects the browser — this line only runs if using popup mode
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || 'OAuth sign-in failed' };
    }
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
                data: {
                    full_name: name,
                    phone,
                    country,
                },
            },
        });

        if (error) throw error;

        return {
            success: true,
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
