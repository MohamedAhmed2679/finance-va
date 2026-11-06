/* Zaylo service worker
 *  - Offline start: the app's own files are cached, so Zaylo opens without a connection and shows
 *    the data saved on the device. Each release caches only what is needed to start; other screens
 *    are cached the first time they're opened.
 *  - Less traffic: built files have content hashes and are served from the cache until a release
 *    changes them; only the small start page is checked with the network on each launch.
 *  - Never cached here: your financial data, sign-in, /api calls and anything from other sites
 *    except fonts. (Data is kept by the app itself, per account, and cleared on sign-out.)
 *  - Push notifications (below).
 * __VERSION__ and __PRECACHE__ are filled in by the build (vite.config.ts).
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `zaylo-shell-${VERSION}`;
const ASSETS = 'zaylo-assets-v1';
const STATIC = 'zaylo-static-v1';
const MAX_ASSETS = 120;

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL);
        // one file failing must not block the update; the rest is cached on use
        await Promise.all(['/', ...PRECACHE].map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const k of await caches.keys()) if (k.startsWith('zaylo-shell-') && k !== SHELL) await caches.delete(k);
        // keep the hashed-file cache bounded: oldest entries go first
        const assets = await caches.open(ASSETS);
        const keys = await assets.keys();
        for (const r of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await assets.delete(r);
        await self.clients.claim();
    })());
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // fonts from Google: cache so text looks right offline
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(staleWhileRevalidate(req, STATIC));
        return;
    }
    if (url.origin !== self.location.origin) return;                         // Supabase, Google sign-in, etc.: untouched
    if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return; // live data and this file: always the network

    if (req.mode === 'navigate') {
        // the start page: fresh when online (so releases arrive), the saved copy when offline or slow
        event.respondWith((async () => {
            const shell = await caches.open(SHELL);
            try {
                const res = await Promise.race([fetch(req), timeout(4000)]);
                if (res.ok && (res.headers.get('content-type') || '').includes('text/html') && !url.pathname.endsWith('.html')) shell.put('/', res.clone());
                return res;
            } catch {
                return (await shell.match(url.pathname.endsWith('.html') ? req : '/', { ignoreVary: true })) || (await shell.match('/', { ignoreVary: true })) || Response.error();
            }
        })());
        return;
    }
    if (url.pathname.startsWith('/assets/')) {
        // content-hashed: a cached copy is always right
        event.respondWith((async () => {
            const hit = (await caches.match(req, { ignoreVary: true, ignoreSearch: true })) || null;
            if (hit) return hit;
            const res = await fetch(req);
            if (res.ok) (await caches.open(ASSETS)).put(req, res.clone());
            return res;
        })());
        return;
    }
    if (/\.(png|svg|ico|webp|jpg|woff2?)$/.test(url.pathname)) event.respondWith(staleWhileRevalidate(req, STATIC));
});

async function staleWhileRevalidate(req, name) {
    const cache = await caches.open(name);
    const hit = await cache.match(req, { ignoreVary: true });
    const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit || Response.error());
    return hit || net;
}

// ─── push notifications

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
