import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Supabase client - used for all database operations, auth, and storage.
 *
 * When VITE_SUPABASE_URL is not set (local dev without Supabase), the app
 * falls back to Zustand's localStorage persistence for offline-first behaviour.
 */
export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
              autoRefreshToken: true,
              persistSession: true,
              detectSessionInUrl: true,
              // Use PKCE for enhanced security on all platforms
              flowType: 'pkce',
          },
      })
    : null;

/**
 * Returns true when Supabase is properly configured and available.
 */
export function isSupabaseReady(): boolean {
    return supabase !== null;
}

/**
 * Convenience function to get the current authenticated user.
 */
export async function getCurrentUser() {
    if (!supabase) return null;
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

/**
 * Convenience function to get the current session.
 */
export async function getCurrentSession() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}
