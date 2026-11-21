/** A sentence about a sign-in or email link that didn't work, shown on the sign-in screen. */
type Listener = (msg: string) => void;
let pending = '';
const listeners = new Set<Listener>();

export function setAuthLinkError(msg: string) {
    pending = msg;
    listeners.forEach(l => l(msg));
}

/** Returns the waiting message once and clears it. */
export function takeAuthLinkError() {
    const m = pending; pending = ''; return m;
}

export function onAuthLinkError(l: Listener) {
    listeners.add(l);
    return () => { listeners.delete(l); };
}
