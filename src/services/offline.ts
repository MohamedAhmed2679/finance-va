/**
 * Registers the service worker that lets Zaylo start offline (web, the phone apps and the desktop
 * app all load zaylo.cc). Production builds only, member app only, and only on secure origins.
 *
 * It also keeps the app current: the phone apps stay open in the background for days, so whenever
 * Zaylo comes back to the screen it checks for a new release, and when one has been installed it
 * reloads once (never while the person is typing or has a dialog open).
 */
export function registerOfflineSupport() {
    if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!window.isSecureContext || /^admin\./.test(location.hostname)) return;
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reg: ServiceWorkerRegistration | null = null;
    let pending = false;

    const busy = () => {
        const a = document.activeElement as HTMLElement | null;
        const typing = !!a && (a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName));
        return typing || !!document.querySelector('.modal-overlay, [role="dialog"]');
    };
    const reloadWhenIdle = () => {
        if (!pending) return;
        if (document.visibilityState === 'visible' && busy()) return;   // try again on the next return to the app
        pending = false;
        location.reload();
    };

    // a new release took over this page: reload once, at a safe moment
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;   // first install: this page is already the newest
        pending = true;
        reloadWhenIdle();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        reg?.update().catch(() => {});
        reloadWhenIdle();
    });
    setInterval(() => { if (document.visibilityState === 'visible') reg?.update().catch(() => {}); }, 30 * 60_000);

    const go = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(r => { reg = r; }).catch(() => { /* offline start just isn't available */ });
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}
