/**
 * Password-reset state.
 *
 * Opening a reset link gives the browser (or app) a real session. Without this flag the app would
 * treat that as a normal sign-in and open the dashboard, so the new password was never asked for.
 * While it's set, the app stays on the "Set a new password" screen and doesn't sign the account in.
 */
type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

function fromUrl(): boolean {
    if (typeof window === 'undefined') return false;
    const q = new URLSearchParams(window.location.search + '&' + window.location.hash.replace(/^#/, ''));
    return q.get('type') === 'recovery';
}

let recovering = fromUrl();

export const isRecovering = () => recovering;

export function setRecovering(on: boolean) {
    if (recovering === on) return;
    recovering = on;
    listeners.forEach(l => l(on));
}

export function onRecoveringChange(l: Listener) {
    listeners.add(l);
    return () => { listeners.delete(l); };
}
