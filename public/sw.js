// Minimal service worker: makes the PWA robustly installable and keeps the
// shell usable offline. Hashed build assets are cache-first (immutable);
// navigations are network-first with the cached shell as offline fallback;
// basemap tiles are cached lazily (cache-first, capped) so panning around
// an already-seen area doesn't refetch every tile.
const ASSET_CACHE = 'plein-assets-v1';
const SHELL_CACHE = 'plein-shell-v1';
const TILE_CACHE = 'plein-tiles-v1';

// Tile hosts used by src/lib/tiles.ts (CARTO primary, OSM fallback)
const TILE_HOSTS = ['basemaps.cartocdn.com', 'tile.openstreetmap.org'];
// ~256×256 PNGs are small; 600 tiles ≈ a handful of city neighbourhoods
const TILE_MAX_ENTRIES = 600;
// Build output is content-hashed: every deploy adds a fresh set of URLs that
// never overwrite the previous one, so without a cap the asset cache would
// keep every build ever visited. Entries go in in deploy order, so evicting
// the head drops the oldest deploy first; a current asset that gets evicted
// is simply refetched once.
const ASSET_MAX_ENTRIES = 100;

const isTileRequest = (url) =>
  TILE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));

// cache.keys() preserves insertion order → dropping the head is FIFO eviction
async function trimCache(cache, max) {
  const keys = await cache.keys();
  const excess = keys.length - max;
  if (excess > 0) await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
}

async function tileFromCacheFirst(event, req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Leaflet loads tiles via <img> (no-cors) → opaque responses (status 0);
  // those are the ones we actually get in prod, so cache them too.
  if (res.ok || res.type === 'opaque') {
    const copy = res.clone();
    event.waitUntil(cache.put(req, copy).then(() => trimCache(cache, TILE_MAX_ENTRIES)));
  }
  return res;
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [ASSET_CACHE, SHELL_CACHE, TILE_CACHE];
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

  // Basemap tiles: lazy cache-first, so a slight map move (or coming back to
  // an area) reuses tiles instead of hitting the CDN again.
  if (isTileRequest(url)) {
    event.respondWith(tileFromCacheFirst(event, req));
    return;
  }

  if (url.origin !== self.location.origin) return; // other APIs: straight to network

  // Immutable build output + icons: cache-first
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(cache.put(req, copy).then(() => trimCache(cache, ASSET_MAX_ENTRIES)));
        }
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
          // fetch() only rejects on a network failure: a 500 from the edge or a
          // maintenance page resolves like any other response. Caching one would
          // overwrite the good shell and make the error page *the* offline
          // experience until the next successful navigation.
          if (res.ok) {
            const copy = res.clone();
            // Not floating: the worker may be killed as soon as the response is
            // returned, and the write has to survive that.
            event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)));
          }
          return res;
        })
        .catch(async () => (await caches.match('/')) ?? Response.error()),
    );
  }
});
