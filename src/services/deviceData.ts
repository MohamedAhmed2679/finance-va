/**
 * What this device keeps for a signed-in person, and wiping it at sign-out.
 * Changes that still haven't reached the cloud are the only thing kept (so nothing typed offline is lost);
 * they're sent the next time the same person signs in here.
 */
const USER_PREFIXES = ['zaylo_smart_cart_v1_', 'zaylo_health_', 'zaylo_last_ws_', 'zaylo_chat_', 'zaylo_ai_consent_', 'zaylo_support_draft_', 'zaylo_nav_'];
const USER_KEYS = ['fva_impersonation', 'zaylo_desktop_backup_v1', 'zaylo_new_ws', 'zaylo_push_prompt_dismissed', 'zaylo_sync_cursor_v1', 'zaylo_autotrack_outbox_v1'];

function wipe(store: Storage | undefined) {
    if (!store) return;
    try {
        const keys: string[] = [];
        for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k) keys.push(k); }
        for (const k of keys) if (USER_KEYS.includes(k) || USER_PREFIXES.some(p => k.startsWith(p))) store.removeItem(k);
    } catch { /* storage blocked */ }
}

export function clearLocalUserData() {
    wipe(typeof localStorage !== 'undefined' ? localStorage : undefined);
    wipe(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
}

/** Resolves after `ms` at the latest. */
export const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<void>(r => setTimeout(r, ms))]);
