// Minimal service worker: makes the PWA robustly installable and keeps the
// shell usable offline. Install precaches the shell and the assets it
// references (the page that registered this worker loaded BEFORE the worker
// controlled it, so lazy caching alone would leave a freshly-installed PWA
// with nothing to boot from offline). After that, hashed build assets are
// cache-first (immutable); navigations are network-first with the cached
// shell as offline fallback; basemap tiles are cached lazily (cache-first,
// capped) so panning around an already-seen area doesn't refetch every tile.
//
// Prices are deliberately NOT cached here: the app keeps its own `fetchedAt`
// per fetched area and that has to stay the single source of truth about how
// old the numbers on screen are. An HTTP cache in front of the price APIs
// would make them older without anything knowing.
const ASSET_CACHE = 'plein-assets-v1';
const SHELL_CACHE = 'plein-shell-v1';
const TILE_CACHE = 'plein-tiles-v1';
// Build-time data the app enriches its stations with. Separate from the assets
// because it is not content-hashed: it is revalidated, not immutable.
const DATA_CACHE = 'plein-data-v2';

// Tile hosts used by src/lib/tiles.ts (CARTO primary, OSM fallback)
const TILE_HOSTS = ['basemaps.cartocdn.com', 'tile.openstreetmap.org'];
// ~256×256 PNGs are small; 600 tiles ≈ a handful of city neighbourhoods
const TILE_MAX_ENTRIES = 600;
// Build output is content-hashed: every deploy adds a fresh set of URLs that
// never overwrite the previous one, so without a cap the asset cache would
// keep every build ever visited. Entries go in in deploy order, so evicting
// the head drops the oldest deploy first; a current asset that gets evicted
// is simply refetched once. The ~40 brand logos share this budget — stable
// URLs, so they survive deploys, but they have to fit next to a few builds'
// worth of chunks for an offline list to keep its avatars.
const ASSET_MAX_ENTRIES = 160;

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

// The brand index is a ~110 kB build-time snapshot that changes between
// deploys but never between two loads: serve the cached copy at once and
// refresh it behind the page. Without it an offline reload loses every
// enseigne name, and the list falls back to bare initials.
async function brandIndexFromCache(event, req) {
  const cache = await caches.open(DATA_CACHE);
  const hit = await cache.match(req);
  const fromNetwork = fetch(req).then(async (res) => {
    if (res.ok) await cache.put(req, res.clone());
    return res;
  });
  if (!hit) return fromNetwork;
  // The page already has its answer; the refresh must still be tracked, or the
  // worker can be killed before the new copy lands.
  event.waitUntil(fromNetwork.catch(() => {}));
  return hit;
}

// Everything the built index.html references under the cache-first prefixes:
// the entry chunks, the stylesheet, the preloaded fonts and the app icons.
const PRECACHE_ASSET_RE = /(?:src|href)="(\/(?:assets|icons|fonts)\/[^"]+)"/g;

// The first navigation ever happens before this worker controls the page, so
// without an install-time precache a PWA installed after a single visit opens
// on Response.error() the first time it launches offline. A rejected precache
// rejects the install: the browser drops this worker and the next (online)
// registration retries, which beats installing a worker that would serve a
// half-cached shell.
async function precacheShell() {
  // no-cache: revalidate — precaching a stale HTML would pin a shell whose
  // asset URLs a deploy has already replaced.
  const res = await fetch('/', { cache: 'no-cache' });
  if (!res.ok) throw new Error('shell precache HTTP ' + res.status);
  const html = await res.clone().text();
  const shell = await caches.open(SHELL_CACHE);
  await shell.put('/', res);

  const assets = await caches.open(ASSET_CACHE);
  const urls = [...new Set([...html.matchAll(PRECACHE_ASSET_RE)].map((m) => m[1]))];
  await Promise.all(
    urls.map(async (url) => {
      if (await assets.match(url)) return;
      const asset = await fetch(url);
      if (!asset.ok) throw new Error('asset precache HTTP ' + asset.status + ' ' + url);
      await assets.put(url, asset);
    }),
  );

  // The brand index is not needed to boot — best effort, never fails install.
  await (async () => {
    const data = await caches.open(DATA_CACHE);
    const brands = await fetch('/brands-fr.json');
    if (brands.ok) await data.put('/brands-fr.json', brands);
  })().catch(() => {});
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [ASSET_CACHE, SHELL_CACHE, TILE_CACHE, DATA_CACHE];
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

  if (url.pathname === '/brands-fr.json') {
    event.respondWith(brandIndexFromCache(event, req));
    return;
  }

  // Immutable build output + icons + self-hosted fonts: cache-first. Brand
  // logos join them: they are as static as the app icons, and without them a
  // station list read offline shows initials where it showed a logo.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/brand-icons/') ||
    url.pathname.startsWith('/fonts/')
  ) {
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
