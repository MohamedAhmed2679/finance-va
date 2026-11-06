/**
 * Runs before anything else loads (first import in main.tsx), because the app reads its saved data
 * as soon as the store module is imported.
 *
 * "Keep me signed in" was off: the last session ended when the app or browser closed, so that
 * account's data leaves this device as well.
 */
try {
    if (localStorage.getItem('zaylo_keep_signed_in') === '0' && !sessionStorage.getItem('zaylo_session_alive')) {
        localStorage.removeItem('financeva-store');
        for (const k of Object.keys(localStorage)) {
            if (/^(sb-.*-auth-token|zaylo_smart_cart_v1_|zaylo_health_|zaylo_sync_cursor_v1|zaylo_autotrack_outbox_v1)/.test(k)) localStorage.removeItem(k);
        }
    }
} catch { /* storage blocked */ }
export {};
