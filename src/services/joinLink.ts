/** A /join/<token> link is remembered across sign-in (and OAuth redirects). */
export const JOIN_KEY = 'zaylo_join_token';
const KEY = JOIN_KEY;

/** Called once at startup: a /join/<token> visit is remembered across sign-in (and OAuth redirects). */
export function captureJoinLink() {
    try {
        const m = window.location.pathname.match(/^\/join\/([A-Za-z0-9]{8,64})\/?$/);
        if (m) {
            localStorage.setItem(KEY, m[1]);
            window.history.replaceState({}, '', '/overview');
        }
    } catch { /* storage blocked: the link just won't survive sign-in */ }
}
export const hasPendingJoin = () => { try { return Boolean(localStorage.getItem(KEY)); } catch { return false; } };
