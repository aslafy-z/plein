// Minimal service worker: makes the PWA robustly installable and keeps the
// shell usable offline. Install precaches the shell and the assets it
// references (the page that registered this worker loaded BEFORE the worker
// controlled it, so lazy caching alone would leave a freshly-installed PWA
// with nothing to boot from offline). After that, hashed build assets are
// cache-first (immutable); navigations are network-first with the cached
// shell as offline fallback; basemap tiles are cached lazily (cache-first,
// capped) so panning around an already-seen area doesn't refetch every tile,
// and the vector basemap's style, sprite and glyphs are kept next to them so
// an offline map still has something to draw the tiles with.
//
// Prices are deliberately NOT cached here: the app keeps its own `fetchedAt`
// per fetched area and that has to stay the single source of truth about how
// old the numbers on screen are. An HTTP cache in front of the price APIs
// would make them older without anything knowing.
// v2: v1 stored any `ok` response under the asset's URL, and the host answers
// an unknown path with the app shell and a 200 (wrangler.jsonc,
// `not_found_handling: single-page-application`) — a chunk a deploy had
// removed could go in as index.html and keep answering cache-first. Only
// non-HTML responses are stored now (isHtml); the bump sweeps what the old
// rule let in.
// The name is mirrored in src/lib/swCaches.ts, which nothing here can import.
const ASSET_CACHE = 'plein-assets-v2';
const SHELL_CACHE = 'plein-shell-v1';
// v2: v1 was warmed while the app requested tiles keyless, and CARTO answers
// keyless requests with tiles stamped « API key required » — under the keyless
// cache identity below those would keep answering forever. The bump sweeps
// that generation on activation; the keyed requests refill the cache clean.
// v3: v2 was filled by no-cors requests, whose opaque responses hide their
// status — a 403, a 429 or a 5xx from the CDN went in like a good tile and
// kept answering cache-first. The app now asks for its tiles in CORS mode and
// only `ok` responses are stored (tileFromCacheFirst); the bump sweeps what
// the old rule let in.
// v4: the basemap moved from CARTO raster to VersaTiles vector tiles
// (src/lib/tiles.ts); not one v3 entry is ever asked for again, and the bump
// hands their space back on activation.
// The name is mirrored in src/lib/swCaches.ts, which nothing here can import.
const TILE_CACHE = 'plein-tiles-v4';
// The vector basemap's style, sprite and glyph ranges (VersaTiles /assets/):
// a few dozen stable URLs every map needs before it can draw a single tile.
// Kept apart from the tiles so the tile cap never evicts them, and out of
// « Clear offline data »'s sweep — they are the app's chrome, not user data.
// The name is mirrored in src/lib/swCaches.ts, which nothing here can import.
const BASEMAP_CACHE = 'plein-basemap-v1';
// Build-time data the app enriches its stations with. Separate from the assets
// because it is not content-hashed: it is revalidated, not immutable.
const DATA_CACHE = 'plein-data-v2';

// The hosts src/lib/tiles.ts draws from (VersaTiles primary, OSM fallback)
const VERSATILES_HOST = 'tiles.versatiles.org';
const OSM_TILE_HOST = 'tile.openstreetmap.org';
// A vector tile covers four 256 px raster tiles and is overzoomed past z14,
// so 600 of them ≈ a few cities plus the pyramids around them
const TILE_MAX_ENTRIES = 600;
// Build output is content-hashed: every deploy adds a fresh set of URLs that
// never overwrite the previous one, so without a cap the asset cache would
// keep every build ever visited. Entries go in in deploy order, so evicting
// the head drops the oldest deploy first; a current asset that gets evicted
// is simply refetched once. The ~40 brand logos share this budget — stable
// URLs, so they survive deploys, but they have to fit next to a few builds'
// worth of chunks for an offline list to keep its avatars.
const ASSET_MAX_ENTRIES = 160;

// A real tile URL carries no query at all; one that does marks a request
// that must NOT be answered from this cache — src/lib/tiles.ts probes the
// server's reachability with `?probe=<ts>`, and a cached tile would say
// nothing about the network.
const isTileRequest = (url) =>
  url.search === '' &&
  ((url.hostname === VERSATILES_HOST && url.pathname.startsWith('/tiles/')) ||
    url.hostname === OSM_TILE_HOST);

const isBasemapAsset = (url) =>
  url.search === '' && url.hostname === VERSATILES_HOST && url.pathname.startsWith('/assets/');

// The host's single-page-application fallback answers ANY unknown path with
// index.html and a 200, so `ok` alone does not say the response is the thing
// that was asked for: nothing under the cache-first prefixes is HTML, and the
// shell is nothing else.
const isHtml = (res) => (res.headers.get('content-type') ?? '').includes('text/html');

// cache.keys() preserves insertion order → dropping the head is FIFO eviction
async function trimCache(cache, max) {
  const keys = await cache.keys();
  const excess = keys.length - max;
  if (excess > 0) await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
}

async function tileFromCacheFirst(event, req) {
  const key = req.url;
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(key);
  if (hit) {
    // Refresh the entry's recency: cache.keys() is insertion-ordered, so
    // delete+put moves a hit to the tail and the cap below evicts the least
    // recently USED tile instead of the first ever seen — without this,
    // panning a new region evicts the home pyramid the session uses most.
    const copy = hit.clone();
    event.waitUntil(cache.delete(key).then(() => cache.put(key, copy)));
    return hit;
  }
  const res = await fetch(req);
  // Only a readable success is stored. The app requests its tiles in CORS
  // mode (MapLibre's fetches, crossOrigin on the fallback layer — see
  // src/lib/tiles.ts) precisely so
  // the status is visible here: an opaque response (status 0) could be a
  // 403/429/5xx as easily as a tile, and a cached error would answer
  // cache-first from then on — each hit refreshing its recency, so it would
  // also be the last entry evicted. An opaque response is passed through,
  // never cached.
  if (res.ok) {
    const copy = res.clone();
    event.waitUntil(cache.put(key, copy).then(() => trimCache(cache, TILE_MAX_ENTRIES)));
  }
  return res;
}

// The basemap's style, sprite and glyphs: served from the cache at once and
// refreshed behind the page, like the brand index below — they change when
// VersaTiles ships a new style, never between two loads, and an offline map
// without them draws nothing at all. A sprite or glyph range the server
// revises is picked up on the next visit.
async function basemapAssetFromCache(event, req) {
  const cache = await caches.open(BASEMAP_CACHE);
  const hit = await cache.match(req.url);
  const fromNetwork = fetch(req).then(async (res) => {
    if (res.ok) await cache.put(req.url, res.clone());
    return res;
  });
  if (!hit) return fromNetwork;
  event.waitUntil(fromNetwork.catch(() => {}));
  return hit;
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
      if (isHtml(asset)) throw new Error('asset precache got HTML ' + url);
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
      const keep = [ASSET_CACHE, SHELL_CACHE, TILE_CACHE, DATA_CACHE, BASEMAP_CACHE];
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
  if (isBasemapAsset(url)) {
    event.respondWith(basemapAssetFromCache(event, req));
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
        // The shell standing in for a file a deploy removed: not the asset, so
        // neither cached under its URL nor handed over as if it were — the
        // page gets the 404 the host did not send.
        if (res.ok && isHtml(res)) return new Response(null, { status: 404, statusText: 'Not Found' });
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
          // Nor is every successful navigation the app: /version.json or
          // /manifest.webmanifest opened in a tab is a navigation too, and
          // would become what every route boots from offline.
          if (res.ok && isHtml(res)) {
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
