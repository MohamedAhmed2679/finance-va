import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { rememberAccount } from '../services/savedSignIn';

/**
 * Once signed in (any method, including Google/Microsoft redirects), remember the account on this
 * device for quick sign-in, and mark this app session as alive (see main.tsx: "Keep me signed in" off).
 */
export function useRememberSignedInAccount() {
    const email = useStore(s => s.user?.email);
    const name = useStore(s => s.user?.name);
    useEffect(() => {
        if (!email && !name) return;
        try { sessionStorage.setItem('zaylo_session_alive', '1'); } catch { /* ignore */ }
        supabase?.auth.getSession().then(({ data }) => {
            const u = data.session?.user;
            if (!u) return;
            const p = String(u.app_metadata?.provider ?? '');
            const ident = u.email || u.phone || email;
            if (ident) rememberAccount({ email: ident, name: name || ident, method: p === 'google' || p === 'azure' || p === 'apple' ? p : u.email ? 'email' : 'phone' });
        }).catch(() => {});
    }, [email, name]);
}
