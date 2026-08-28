// Themed basemap with automatic fallback.
// Primary: CARTO CDN — dark_all or light_all following the app theme, re-toned
// to the palette via `.tiles-carto` (whose filter is per-theme in styles.css).
// Every request to it carries the account key (lib/cartoKey.ts); keyless, the
// CDN answers with tiles stamped « API key required » rather than failing, so
// no fallback would ever trigger.
// A theme switch swaps the layer's URL in place, so every mounted map follows
// without remounting. When the CDN can't load (offline, firewalled network),
// the map swaps to OpenStreetMap tiles (through the dev-server proxy in dev),
// re-toned per theme with the `.tiles-dark` CSS filter so the app keeps its
// look. The first map that discovers the CDN is unreachable remembers it for
// the session, so the map, route and station views all switch together — and
// a reachability probe (the browser's `online` event, plus every new map)
// swaps them all back the moment the CDN answers again, instead of pinning
// the session on OSM after one blip.
//
// The service worker caches every tile the map loads (sw.js, cache-first),
// but only at the zooms actually visited: offline, zooming used to fall off
// the cached slice onto a blank background within a level or two. So after
// each settled move the prefetcher warms the ~4 tiles per OTHER zoom that
// cover the visible center (src/lib/tilePyramid.ts) — a whole pyramid, world
// view to street level, costs less than one screenful of panning.
import L from 'leaflet';
import { IS_DEV } from './env';
import { currentTheme, onThemeChange } from './colorScheme';
import { registerTileDebugSource, type TileLayerDebug } from './debugState';
import { isForcedOffline, isOffline, onConnectivityChange } from './connectivity';
import { pyramidTiles, tileUrl } from './tilePyramid';
import { cachedTileUrls } from './tileCache';
import { tileCacheKey, withCartoKey } from './cartoKey';
import {
  dropTileSnapshot,
  ensureTileSnapshot,
  isBlankTile,
  tileGateDebug,
  tileUrlFor,
} from './tileGate';

const cartoUrl = () =>
  withCartoKey(
    `https://{s}.basemaps.cartocdn.com/${currentTheme() === 'light' ? 'light_all' : 'dark_all'}/{z}/{x}/{y}{r}.png`,
  );
const CARTO_SUBDOMAINS = 'abcd';
const FALLBACK_URL = IS_DEV ? '/tiles/{z}/{x}/{y}.png' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** No CARTO tile managed to load within this window → assume unreachable */
const GIVE_UP_MS = 6000;

let cartoUnreachable = false;

// Session totals across every mounted map and both layers — the debug
// overlay's tile section. Counters only: no behavior hangs off them; the
// registration keeps this module's Leaflet import out of the snapshot code.
let tilesLoaded = 0;
let tilesErrored = 0;

registerTileDebugSource(
  (): TileLayerDebug => ({
    active: cartoUnreachable ? 'fallback' : 'carto',
    cartoUnreachable,
    tilesLoaded,
    tilesErrored,
    ...tileGateDebug(),
  }),
);

// Small pans shouldn't refetch tiles: keep a wide ring of off-screen tiles
// alive instead of Leaflet's default 2-tile buffer, and load new tiles while
// the finger is still dragging rather than waiting for the pan to settle.
// (Tiles already seen also come back from the service-worker cache — sw.js.)
const TILE_RETENTION: L.TileLayerOptions = {
  keepBuffer: 6,
  updateWhenIdle: false,
};

// Leaflet only loads the tiles that intersect the viewport, so even a slight
// pan lands on tiles that were never requested. Widen the layer's loading
// bounds by one tile ring around the view (the leaflet-edgebuffer trick):
// the surrounding tiles are fetched lazily ahead of time and a small move
// shows them instantly. The ring must not slow the visible map down, so it
// stays low-priority: Leaflet already creates the visible tiles first (its
// queue is sorted by distance to the map center), and the off-screen ones get
// `fetchpriority="low"` so the browser schedules them behind the visible
// requests instead of downloading everything at equal priority.
// `_getTiledPixelBounds`/`_pxBoundsToTileRange` are private but stable
// (leaflet pinned at 1.9.x).
const EDGE_BUFFER_TILES = 1;

interface GridLayerInternals {
  _getTiledPixelBounds(center: L.LatLng): L.Bounds;
  _pxBoundsToTileRange(bounds: L.Bounds): L.Bounds;
  getTileSize(): L.Point;
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement;
  getTileUrl(coords: L.Coords): string;
  /** Tile range of the real viewport (unpadded), refreshed on every update */
  _viewTileRange?: L.Bounds;
}

const proto = L.TileLayer.prototype as unknown as GridLayerInternals;

const BufferedTileLayer = L.TileLayer.extend({
  _getTiledPixelBounds(this: GridLayerInternals, center: L.LatLng): L.Bounds {
    const bounds = proto._getTiledPixelBounds.call(this, center);
    this._viewTileRange = this._pxBoundsToTileRange(bounds);
    const pad = this.getTileSize().multiplyBy(EDGE_BUFFER_TILES);
    return L.bounds(bounds.min!.subtract(pad), bounds.max!.add(pad));
  },
  createTile(this: GridLayerInternals, coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = proto.createTile.call(this, coords, done);
    if (this._viewTileRange && !this._viewTileRange.contains(L.point(coords.x, coords.y))) {
      tile.setAttribute('fetchpriority', 'low');
    }
    return tile;
  },
  // Every basemap request in the app is born here — Leaflet asks the layer
  // for an address and puts it on an <img>. Declining a tile while « Force
  // offline mode » holds is therefore a matter of handing back a blank, and
  // no request is ever issued (see lib/tileGate.ts).
  getTileUrl(this: GridLayerInternals, coords: L.Coords): string {
    return tileUrlFor(proto.getTileUrl.call(this, coords));
  },
}) as unknown as new (url: string, opts: L.TileLayerOptions) => L.TileLayer;

const bufferedTileLayer = (url: string, opts: L.TileLayerOptions): L.TileLayer =>
  new BufferedTileLayer(url, opts);

/** true when this event is about a tile the offline gate declined — those are
 *  neither loads worth counting nor evidence about the CDN */
const declined = (e: L.TileEvent): boolean => isBlankTile((e.tile as HTMLImageElement).src);

// ── The offline gate, across every mounted map ───────────────────────────────
// Layers are tracked so that RELEASING « Force offline mode » puts back the
// tiles it blanked. Turning it ON deliberately redraws nothing: what is
// already painted was already downloaded and costs nothing to keep — the mode
// is about the requests that would come next.
const liveLayers = new Set<L.TileLayer>();

const redrawAll = (): void => {
  for (const layer of liveLayers) layer.redraw();
};

function track(layer: L.TileLayer): void {
  liveLayers.add(layer);
  layer.on('remove', () => liveLayers.delete(layer));
  // Mounted while the gate holds (a map opened in the mode, or a reload with
  // the session flag still on): anything asked for before the snapshot lands
  // is blanked, so redraw once it is in and the cached tiles paint.
  if (isForcedOffline()) void ensureTileSnapshot().then(() => layer.redraw());
}

// Browser online/offline events come through this subscription too; they
// change nothing here, so the previous reading is what tells a real flip of
// the switch apart from one of those.
let gated = isForcedOffline();
onConnectivityChange(() => {
  const forced = isForcedOffline();
  if (forced === gated) return;
  gated = forced;
  if (forced) void ensureTileSnapshot();
  else {
    dropTileSnapshot();
    redrawAll();
  }
});


// ── The live basemaps, one handle per map ────────────────────────────────────
// The recovery probe needs to find every map currently sitting on the
// fallback to swap it back, the theme listener needs the CURRENT carto layer
// across those swaps, and the prefetcher needs the map's visible center; a
// handle registers on mount, leaves on unload.

interface BasemapHandle {
  map: L.Map;
  layer: L.TileLayer | null;
  onFallback: boolean;
  /** Center the pyramid warms around — the VISIBLE center when overlays
      cover part of the stage, the raw map center otherwise */
  center: () => L.LatLng;
}

const handles = new Set<BasemapHandle>();

function mountFallback(handle: BasemapHandle): void {
  const layer = bufferedTileLayer(FALLBACK_URL, {
    ...TILE_RETENTION,
    attribution: '© OpenStreetMap · © CARTO',
    maxZoom: 19,
    // The dev proxy serves CARTO (already dark); the prod fallback is raw OSM
    // and needs the darkening filter.
    className: IS_DEV ? 'tiles-carto' : 'tiles-dark',
  });
  layer.on('tileload', (e) => {
    if (!declined(e)) tilesLoaded++;
  });
  layer.on('tileerror', () => tilesErrored++);
  track(layer);
  layer.addTo(handle.map);
  handle.layer = layer;
  handle.onFallback = true;
}

function mountCarto(handle: BasemapHandle): void {
  // When swapping back from the fallback, keep it underneath until the first
  // CARTO tile actually lands — a recovery that turns out premature (captive
  // portal, half-restored network) must not flash a blank map.
  const previous = handle.onFallback ? handle.layer : null;
  const carto = bufferedTileLayer(cartoUrl(), {
    ...TILE_RETENTION,
    attribution: '© OpenStreetMap · © CARTO',
    subdomains: CARTO_SUBDOMAINS,
    maxZoom: 19,
    className: 'tiles-carto',
  });
  handle.layer = carto;
  handle.onFallback = false;

  let loaded = 0;
  let errored = 0;
  let settled = false;

  const swap = () => {
    if (settled) return;
    settled = true;
    cartoUnreachable = true;
    handle.map.removeLayer(carto);
    if (previous) {
      // the fallback never left — hand the handle back to it
      handle.layer = previous;
      handle.onFallback = true;
    } else {
      mountFallback(handle);
    }
    armRecovery();
  };

  // Zoom changes abort pending tiles without firing tileerror, so a count
  // alone can miss the failure — the timer catches that case. The offline
  // gate is never grounds for the swap: « CARTO is unreachable » lasts the
  // whole session, and releasing the switch has to find the CDN where it left
  // it rather than on a verdict the app's own blanking produced.
  const giveUp = setTimeout(() => {
    if (loaded === 0 && !isForcedOffline()) swap();
  }, GIVE_UP_MS);

  carto.on('tileload', (e) => {
    if (declined(e)) return;
    loaded++;
    tilesLoaded++;
    clearTimeout(giveUp);
    if (!settled) {
      settled = true;
      if (previous) handle.map.removeLayer(previous);
    }
  });
  carto.on('tileerror', () => {
    errored++;
    tilesErrored++;
    if (loaded === 0 && errored >= 2 && !isForcedOffline()) swap();
  });
  handle.map.on('unload', () => clearTimeout(giveUp));

  track(carto);
  carto.addTo(handle.map);
}

export function addBasemap(map: L.Map, visibleCenter?: () => L.LatLng): void {
  const handle: BasemapHandle = {
    map,
    layer: null,
    onFallback: false,
    center: visibleCenter ?? (() => map.getCenter()),
  };
  handles.add(handle);
  // Follow a theme switch in place — the tile filters in styles.css flip on
  // their own; only the tile set itself has to be refetched. The handle is
  // read live, so the listener survives a fallback swap and a recovery: it
  // always retunes whatever carto layer currently stands.
  const offTheme = onThemeChange(() => {
    if (!handle.onFallback) handle.layer?.setUrl(cartoUrl());
  });
  map.on('unload', () => {
    offTheme();
    handles.delete(handle);
  });
  installPyramidPrefetch(handle);

  if (cartoUnreachable) {
    mountFallback(handle);
    // A new view is a natural moment to re-check the CDN — it covers networks
    // where no `online` event ever fires (a firewall rule lifted, a VPN up).
    void attemptRecovery();
    return;
  }
  mountCarto(handle);
}

// ── Recovery: swap back to CARTO when it answers again ───────────────────────

/** One fixed low-zoom CARTO tile the reachability probe fetches (the palette
    doesn't matter — reachability is per host, not per style) */
const PROBE_URL = 'https://a.basemaps.cartocdn.com/dark_all/3/4/2.png';
/** Two probes never run closer together than this */
const PROBE_MIN_INTERVAL_MS = 30_000;

let recoveryArmed = false;
let probing = false;
let lastProbeAt = 0;

function armRecovery(): void {
  if (recoveryArmed) return;
  recoveryArmed = true;
  window.addEventListener('online', onOnline);
}

function onOnline(): void {
  void attemptRecovery();
}

async function attemptRecovery(): Promise<void> {
  if (!cartoUnreachable || probing) return;
  // The probe is a request like any other: « Force offline mode » forbids it,
  // and the browser knowing it has no network makes it pointless.
  if (isOffline()) return;
  const now = Date.now();
  if (now - lastProbeAt < PROBE_MIN_INTERVAL_MS) return;
  lastProbeAt = now;
  probing = true;
  try {
    // The unique query bypasses the service worker's tile cache (sw.js only
    // intercepts tile URLs carrying nothing but the CARTO key) and, with
    // no-store, the HTTP cache — a cached tile answering the probe would say
    // nothing about the network.
    await fetch(withCartoKey(`${PROBE_URL}?probe=${now}`), {
      mode: 'no-cors',
      cache: 'no-store',
    });
  } catch {
    return; // still unreachable — the next online event or new map retries
  } finally {
    probing = false;
  }
  cartoUnreachable = false;
  recoveryArmed = false;
  window.removeEventListener('online', onOnline);
  // Every live fallback map swaps back; each re-runs the reachability check,
  // so a probe fooled by a captive portal just lands back on the fallback.
  for (const handle of [...handles]) {
    if (handle.onFallback) mountCarto(handle);
  }
}

// ── Offline zoom pyramid ─────────────────────────────────────────────────────
// After each settled move, warm the service-worker tile cache with the ~4
// tiles per OTHER zoom that cover the map center — down to the world view so
// zooming out never falls off the cached slice, and up to the layers' max so
// zooming in on the center keeps drawing too. The fetches take the exact
// URLs Leaflet would request (subdomain rule, retina suffix — tilePyramid.ts)
// and the same no-cors mode as its <img> loads, so sw.js caches them on its
// normal lazy path.
//
// Each run plans against the cache itself (one key enumeration) rather than
// against a session memory of what was fetched before: what the LRU cap
// evicted is re-downloaded, so the pyramid self-repairs — and what is still
// held costs nothing at all, where a blind re-issue would push ~60 requests
// through the worker per settled move and re-write every one of them to
// refresh its recency.

/** Below this zoom the whole world is a handful of tiles — nothing to warm */
const PREFETCH_MIN_ZOOM = 5;
/** The layers' maxZoom — the deepest a zoom-in gesture can go */
const PREFETCH_MAX_ZOOM = 19;
/** A pan mid-gesture fires moveend repeatedly; only the settled view counts */
const PREFETCH_DEBOUNCE_MS = 2000;
/** An idle slot is a preference, not a precondition: on a busy mobile page
    (map compositing, animations) requestIdleCallback can starve until the
    tab goes to background, so without the timeout the warm-up would fire
    almost only there. The view already settled through the debounce; this
    bounds the extra politeness wait. */
const IDLE_TIMEOUT_MS = 2000;

/** Every other level, nearest first — the first tiles to land are the ones a
    small zoom gesture (either direction) hits. The visited level itself is
    already cached by the normal tile loads. */
function prefetchZooms(current: number): number[] {
  const zooms: number[] = [];
  for (let d = 1; current - d >= PREFETCH_MIN_ZOOM || current + d <= PREFETCH_MAX_ZOOM; d += 1) {
    if (current - d >= PREFETCH_MIN_ZOOM) zooms.push(current - d);
    if (current + d <= PREFETCH_MAX_ZOOM) zooms.push(current + d);
  }
  return zooms;
}

/** The prefetch must never compete with visible tiles for the connection */
const runWhenIdle = (fn: () => void): void => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(fn, 250); // Safari has no requestIdleCallback
  }
};

function installPyramidPrefetch(handle: BasemapHandle): void {
  let timer: number | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(
      () => runWhenIdle(() => void prefetchPyramid(handle)),
      PREFETCH_DEBOUNCE_MS,
    );
  };
  handle.map.on('moveend zoomend', schedule);
  // A theme switch refetches the visible tiles in the other palette; re-warm
  // the pyramid too, or the offline coverage silently stays in the old one.
  const offTheme = onThemeChange(schedule);
  handle.map.on('unload', () => {
    clearTimeout(timer);
    offTheme();
  });
}

async function prefetchPyramid(handle: BasemapHandle): Promise<void> {
  if (!handles.has(handle)) return; // the map went away while we idled
  // Offline is when the cache is SPENT, not fed — and « Force offline mode »
  // means no request at all: these fetches are raw, so the tile layer's own
  // gate (getTileUrl) never sees them and cannot decline them for us.
  if (isOffline()) return;
  // The VISIBLE center, not the raw one: the floating panel (desktop) and the
  // bottom sheet (phone) cover part of the stage, and every fit centers its
  // content in what remains — a pyramid on the raw center would sit half a
  // panel off what the user is actually looking at.
  const center = handle.center();
  const zooms = prefetchZooms(Math.round(handle.map.getZoom()));
  // The theme-matching template, resolved at fetch time: each palette caches
  // under its own URLs, so a switch just warms the other set.
  const template = handle.onFallback ? FALLBACK_URL : cartoUrl();
  const held = await cachedTileUrls();
  if (!handles.has(handle) || isOffline()) return; // both can change during the read
  for (const tile of pyramidTiles(center.lat, center.lng, zooms)) {
    const url = tileUrl(template, tile, {
      subdomains: CARTO_SUBDOMAINS,
      retina: L.Browser.retina,
    });
    // The cache keys are absolute and keyless; the dev proxy's template is
    // relative and the CARTO one carries the key.
    if (held.has(new URL(tileCacheKey(url), location.href).href)) continue;
    // Best effort: a failed warm-up changes nothing on screen, and the next
    // settled move simply tries again. priority:'low' keeps the burst behind
    // anything the page needs even when the idle timeout forced the run
    // (browsers without the Fetch Priority API ignore the field).
    fetch(url, { mode: 'no-cors', priority: 'low' }).catch(() => {});
  }
}
