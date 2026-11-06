/**
 * Registers the service worker that lets Zaylo start offline (web, the phone apps and the desktop
 * app all load zaylo.cc). Production builds only, member app only, and only on secure origins.
 */
export function registerOfflineSupport() {
    if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!window.isSecureContext || /^admin\./.test(location.hostname)) return;
    const go = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* offline start just isn't available */ });
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}
