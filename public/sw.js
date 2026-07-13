// Minimal service worker: makes the PWA robustly installable and keeps the
// shell usable offline. Hashed build assets are cache-first (immutable);
// navigations are network-first with the cached shell as offline fallback.
const ASSET_CACHE = 'plein-assets-v1';
const SHELL_CACHE = 'plein-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [ASSET_CACHE, SHELL_CACHE];
      for (const key of await caches.keys()) {
        if (!keep.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // APIs/tiles: straight to network

  // Immutable build output + icons: cache-first
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // App navigations: network-first, cached shell offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) ?? Response.error()),
    );
  }
});
