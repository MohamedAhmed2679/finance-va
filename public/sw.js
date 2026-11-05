/* Zaylo service worker: shows push notifications and opens the right page when one is tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
    const title = data.title || 'Zaylo';
    const options = {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/favicon-48.png',
        tag: data.tag,
        renotify: Boolean(data.tag),
        data: { url: data.url || '/activity' },
        vibrate: [80, 40, 80],
    };
    event.waitUntil((async () => {
        // Someone looking at Zaylo right now already sees it in the app
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const watching = windows.some(c => c.visibilityState === 'visible' && c.focused);
        if (watching) {
            windows.forEach(c => c.postMessage({ type: 'zaylo-push', ...data }));
            return;
        }
        await self.registration.showNotification(title, options);
    })());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = new URL((event.notification.data && event.notification.data.url) || '/activity', self.location.origin).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const open = windows.find(c => new URL(c.url).origin === self.location.origin);
        if (open) { await open.focus(); open.postMessage({ type: 'zaylo-open', url }); return; }
        await self.clients.openWindow(url);
    })());
});
