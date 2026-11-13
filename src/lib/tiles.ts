// Themed basemap with automatic fallback.
// Primary: VersaTiles (https://versatiles.org) — OpenStreetMap vector tiles,
// no account, no key, no tracking. Leaflet cannot draw vector tiles, so the
// basemap is a MapLibre GL map living inside a Leaflet layer
// (`@maplibre/maplibre-gl-leaflet`): Leaflet keeps the view, the gestures and
// every layer the app draws (pins, circle, route), MapLibre only paints the
// ground underneath, kept in sync on every move. Both are loaded on demand,
// so the WebGL renderer never weighs on the app's first paint.
// The style follows the app theme (`gray` / `gray-dark`, re-toned to the
// palette via `.basemap-vector` in styles.css). The TILES are the same in
// both themes — a theme switch swaps the style in place, every mounted map
// follows without remounting, and nothing is refetched but the style itself.
//
// When the vector map can't draw — VersaTiles unreachable (offline,
// firewalled network), or no WebGL on this device — the map swaps to
// OpenStreetMap raster tiles (through the dev-server proxy in dev), re-toned
// per theme with the `.tiles-dark` CSS filter so the app keeps its look. The
// first map that discovers VersaTiles is unreachable remembers it for the
// session, so the map, route and station views all switch together — and a
// reachability probe (the browser's `online` event, plus every new map) swaps
// them all back the moment it answers again, instead of pinning the session
// on OSM after one blip. A device without WebGL stays on the fallback.
//
// The service worker caches every tile the map loads (sw.js, cache-first),
// but only at the zooms actually visited: offline, zooming used to fall off
// the cached slice onto a blank background within a level or two. So after
// each settled move the prefetcher warms the ~4 tiles per OTHER zoom that
// cover the visible center (src/lib/tilePyramid.ts). Vector tiles stop at
// z14 and are overzoomed past it, so the whole pyramid, world view to street
// level, is a dozen levels at most.
import L from 'leaflet';
import type { Map as GlMap, RequestParameters, ResourceType } from 'maplibre-gl';
import { IS_DEV } from './env';
import { currentTheme, onThemeChange } from './colorScheme';
import { registerTileDebugSource, type TileLayerDebug } from './debugState';
import { isForcedOffline, isOffline, onConnectivityChange } from './connectivity';
import { pyramidTiles, tileUrl, vectorPyramidZooms, type TileCoords } from './tilePyramid';
import { cachedTileUrls } from './tileCache';
import {
  BLANK_PBF,
  dropTileSnapshot,
  ensureTileSnapshot,
  isBlankTile,
  tileGateDebug,
  tileUrlFor,
} from './tileGate';

/** The public VersaTiles server: tiles under /tiles/, style, sprite and
    glyphs under /assets/ (public/sw.js caches the two apart) */
export const VERSATILES = 'https://tiles.versatiles.org';

/** The style per theme. `gray` is the closest to the neutral basemap the
    palette is built on — the price pins carry the color, the ground does not. */
const styleUrl = (): string =>
  `${VERSATILES}/assets/styles/${currentTheme() === 'light' ? 'gray' : 'gray-dark'}/style.json`;

/** The two vector sources the VersaTiles styles draw from, with the deepest
    level each serves (tiles.json) — the pyramid prefetch warms both */
const VECTOR_SOURCES = [
  { template: `${VERSATILES}/tiles/osm/{z}/{x}/{y}`, maxZoom: 14 },
  { template: `${VERSATILES}/tiles/landcover-vectors/{z}/{x}/{y}`, maxZoom: 10 },
] as const;

const FALLBACK_URL = IS_DEV ? '/tiles/{z}/{x}/{y}.png' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** VersaTiles has not answered — not even the style — within this window
    after the layer went on the map → assume it is unreachable. */
const STYLE_GIVE_UP_MS = 12_000;
/** The style arrived (the server answers) but no tile has, this long after:
    something between here and the tiles is broken. Generous on purpose — a
    first visit on a phone network still has the sprite, the fonts, the
    worker start-up and the tiles themselves to get through, and a swap lasts
    the whole session. */
const TILE_GIVE_UP_MS = 25_000;

const ATTRIBUTION = '© OpenStreetMap · VersaTiles';

let vectorUnreachable = false;

/** Why the last map that fell back did — the debug overlay's answer to « why
    is this OpenStreetMap? », which no screenshot can tell */
export type FallbackReason =
  | 'no-webgl'
  | 'renderer-chunk'
  | 'renderer-refused'
  | 'style-error'
  | 'style-timeout'
  | 'tile-errors'
  | 'tiles-timeout';
let lastFallback: { reason: FallbackReason; detail?: string } | null = null;

function noteFallback(reason: FallbackReason, detail?: string): void {
  lastFallback = { reason, ...(detail ? { detail } : null) };
  // Debug chrome, English only: one line per swap, for whoever has DevTools open
  console.warn(`[basemap] VersaTiles → OpenStreetMap fallback: ${reason}${detail ? ` (${detail})` : ''}`);
}
/** Null until a map has tried; false sticks for the session — a browser
    without WebGL does not grow one */
let webgl: boolean | null = null;

// Session totals across every mounted map and both layers — the debug
// overlay's tile section. Counters only: no behavior hangs off them; the
// registration keeps this module's Leaflet import out of the snapshot code.
let tilesLoaded = 0;
let tilesErrored = 0;

registerTileDebugSource(
  (): TileLayerDebug => ({
    active: vectorUnreachable || webgl === false ? 'fallback' : 'vector',
    vectorUnreachable,
    webgl,
    fallbackReason: lastFallback ? `${lastFallback.reason}${lastFallback.detail ? `: ${lastFallback.detail}` : ''}` : null,
    tilesLoaded,
    tilesErrored,
    ...tileGateDebug(),
  }),
);

/** Whether this browser can create a WebGL context at all — MapLibre's own
    constructor throws without one, and the check is cheaper than the throw */
function hasWebGl(): boolean {
  if (webgl != null) return webgl;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    webgl = ctx != null;
    // Hand the probe context straight back: browsers cap live contexts, and
    // every map on screen is about to want one of its own.
    ctx?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

// ── The raster fallback ──────────────────────────────────────────────────────
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
  // Every fallback request is born here — Leaflet asks the layer for an
  // address and puts it on an <img>. Declining a tile while « Force offline
  // mode » holds is therefore a matter of handing back a blank, and no
  // request is ever issued (see lib/tileGate.ts).
  getTileUrl(this: GridLayerInternals, coords: L.Coords): string {
    return tileUrlFor(proto.getTileUrl.call(this, coords));
  },
}) as unknown as new (url: string, opts: L.TileLayerOptions) => L.TileLayer;

// Raster tiles are requested in CORS mode (OSM sends
// `Access-Control-Allow-Origin: *`), never as plain no-cors <img> loads: a
// no-cors response is opaque, its status hidden, and the service worker
// could not tell a tile from a 403/429/5xx — it would cache the error and
// serve it cache-first from then on. With CORS the worker sees the status
// and stores only successes (sw.js, tileFromCacheFirst). MapLibre fetches its
// vector tiles in CORS mode on its own, and the pyramid prefetch below
// fetches in the same mode, for the same reason.
const TILE_CROSS_ORIGIN = 'anonymous';

/** true when this event is about a tile the offline gate declined — those are
 *  neither loads worth counting nor evidence about the server */
const declined = (e: L.TileEvent): boolean => isBlankTile((e.tile as HTMLImageElement).src);

// ── The vector layer ─────────────────────────────────────────────────────────

type GlLayer = L.Layer & { getMaplibreMap(): GlMap };
type GlLayerFactory = (options: Record<string, unknown>) => GlLayer;

/** The plugin layer's private surface the guards below wrap (0.1.x) */
interface GlLayerInternals {
  _map: L.Map | null;
  _glMap: (GlMap & { _actualCanvas?: HTMLElement }) | null;
  _container?: HTMLElement;
  _update(e?: unknown): void;
  _pinchZoom(e?: unknown): void;
  _animateZoom(e: unknown): void;
  _zoomEnd(): void;
  _resizeContainer(): void;
  _transitionEnd(e?: unknown): void;
  onRemove(map: L.Map): void;
}

/**
 * Whether MapLibre can follow this map's view right now. Its transform has
 * no inverse at a zero size or a non-finite zoom, and `jumpTo` throws on
 * either — where Leaflet just carries on: a map mounted behind a skeleton
 * has no size yet, and a fit on a single point with no zoom ceiling lands
 * on Infinity (lib/leafletMap.ts sets one now; this stays the guard).
 */
const drawable = (map: L.Map | null | undefined): boolean => {
  if (!map || !(map as unknown as { _loaded?: boolean })._loaded) return false;
  const size = map.getSize();
  return size.x > 0 && size.y > 0 && Number.isFinite(map.getZoom());
};

/**
 * The plugin's layer, made safe for how this app mounts maps. The plugin
 * assumes a map that is on screen for its whole life; here a map is born in
 * a container that has no size yet, at no usable zoom (the route map
 * behind the awaited-trip skeleton), hidden, and torn down mid-animation by
 * a screen change. Each case threw from a Leaflet event handler: `jumpTo` on
 * a transform with no inverse, a zoom end reaching a canvas that was never
 * set, a deferred frame reaching a map already removed. Every sync entry
 * point now stands down while the map is gone or not drawable — the next
 * move or resize re-syncs it.
 */
function guardedLayer(Base: typeof L.Layer): GlLayerFactory {
  const base = Base.prototype as unknown as GlLayerInternals;
  const live = (layer: GlLayerInternals) => layer._glMap != null && drawable(layer._map);
  const Guarded = Base.extend({
    _update(this: GlLayerInternals, e?: unknown) {
      if (live(this)) base._update.call(this, e);
    },
    _pinchZoom(this: GlLayerInternals, e?: unknown) {
      if (live(this)) base._pinchZoom.call(this, e);
    },
    _animateZoom(this: GlLayerInternals, e: unknown) {
      if (live(this) && this._glMap?._actualCanvas) base._animateZoom.call(this, e);
    },
    _zoomEnd(this: GlLayerInternals) {
      if (live(this) && this._glMap?._actualCanvas) base._zoomEnd.call(this);
    },
    // The plugin's version defers to a frame that may land after removal
    _transitionEnd(this: GlLayerInternals) {
      L.Util.requestAnimFrame(() => {
        const map = this._map;
        const gl = this._glMap;
        if (!map || !gl?._actualCanvas || !drawable(map)) return;
        const center = map.getCenter();
        const offset = map.latLngToContainerPoint(map.getBounds().getNorthWest());
        this._resizeContainer();
        L.DomUtil.setTransform(gl._actualCanvas, offset, 1);
        gl.once('moveend', () => this._zoomEnd());
        gl.jumpTo({ center, zoom: map.getZoom() - 1 });
      });
    },
    _resize(this: GlLayerInternals, e?: unknown) {
      this._transitionEnd(e);
    },
    onRemove(this: GlLayerInternals, map: L.Map) {
      if (this._glMap) {
        base.onRemove.call(this, map);
        return;
      }
      // An add that failed halfway: only the container may be standing
      this._container?.remove();
    },
  });
  return (options) => new (Guarded as unknown as new (o: Record<string, unknown>) => GlLayer)(options);
}

/** The renderer chunk, imported once for every map of the session */
let glFactory: Promise<GlLayerFactory> | null = null;

function loadGl(): Promise<GlLayerFactory> {
  glFactory ??= Promise.all([
    import('maplibre-gl'),
    import('@maplibre/maplibre-gl-leaflet'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]).then(([, plugin]) => guardedLayer(plugin.MaplibreGL as unknown as typeof L.Layer));
  // A failed import (offline on a first visit: the chunk was never cached)
  // must not poison the session — the next attempt re-imports.
  glFactory.catch(() => {
    glFactory = null;
  });
  return glFactory;
}

/**
 * MapLibre's hook on every request it makes — the vector map's counterpart
 * of the fallback layer's getTileUrl. Tiles and glyph ranges go through the
 * « Force offline mode » gate; the style and the sprite pass (lib/tileGate.ts
 * says why).
 */
function gateRequest(url: string, type?: ResourceType): RequestParameters {
  if (type === 'Tile' || type === 'Glyphs') return { url: tileUrlFor(url, BLANK_PBF) };
  return { url };
}

// ── The offline gate, across every mounted map ───────────────────────────────
// Layers are tracked so that RELEASING « Force offline mode » puts back the
// tiles it blanked. Turning it ON deliberately redraws nothing: what is
// already painted was already downloaded and costs nothing to keep — the mode
// is about the requests that would come next.

/** Refetch everything a layer may have blanked */
function reload(layer: L.Layer): void {
  if (layer instanceof L.TileLayer) {
    layer.redraw();
    return;
  }
  const gl = (layer as GlLayer).getMaplibreMap?.();
  if (!gl?.style) return;
  // A vector source keeps its loaded tiles, blanked ones included; clearing
  // them makes the source ask for every visible tile again, through the gate.
  for (const id of Object.keys(gl.getStyle()?.sources ?? {})) {
    (gl.getSource(id) as { reload?: () => void } | undefined)?.reload?.();
  }
}

const liveLayers = new Set<L.Layer>();

const reloadAll = (): void => {
  for (const layer of liveLayers) reload(layer);
};

function track(layer: L.Layer): void {
  liveLayers.add(layer);
  layer.on('remove', () => liveLayers.delete(layer));
  // Mounted while the gate holds (a map opened in the mode, or a reload with
  // the session flag still on): anything asked for before the snapshot lands
  // is blanked, so reload once it is in and the cached tiles paint.
  if (isForcedOffline()) void ensureTileSnapshot().then(() => reload(layer));
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
    reloadAll();
  }
});

// ── The live basemaps, one handle per map ────────────────────────────────────
// The recovery probe needs to find every map currently sitting on the
// fallback to swap it back, the theme listener needs the CURRENT vector layer
// across those swaps, and the prefetcher needs the map's visible center; a
// handle registers on mount, leaves on unload.

interface BasemapHandle {
  map: L.Map;
  layer: L.Layer | null;
  onFallback: boolean;
  /** Bumped by every mount, so a renderer import that resolves after the
      handle moved on (unload, swap, recovery) knows it lost the slot */
  generation: number;
  /** Center the pyramid warms around — the VISIBLE center when overlays
      cover part of the stage, the raw map center otherwise */
  center: () => L.LatLng;
}

const handles = new Set<BasemapHandle>();

function mountFallback(handle: BasemapHandle): void {
  handle.generation++;
  const layer = new BufferedTileLayer(FALLBACK_URL, {
    ...TILE_RETENTION,
    attribution: '© OpenStreetMap',
    maxZoom: 19,
    crossOrigin: TILE_CROSS_ORIGIN,
    className: 'tiles-dark',
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

function mountVector(handle: BasemapHandle): void {
  if (!hasWebGl()) {
    if (!handle.onFallback) {
      noteFallback('no-webgl');
      mountFallback(handle);
    }
    return;
  }
  const generation = ++handle.generation;
  // When swapping back from the fallback, keep it underneath until the first
  // vector tile actually lands — a recovery that turns out premature (captive
  // portal, half-restored network) must not flash a blank map.
  const previous = handle.onFallback ? handle.layer : null;
  const { map } = handle;

  let settled = false;
  let loaded = 0;
  let errored = 0;
  /** The style answered: the server is reachable, whatever the tiles do */
  let styleArrived = false;
  let layer: GlLayer | null = null;
  // Zoom changes abort pending tiles without an error, so a count alone can
  // miss the failure — the timers catch that case. Two of them, because «
  // nothing answered » and « the tiles are slow » are not the same verdict:
  // the first is short, the second is long (a first visit on a phone network
  // is slow, and a swap is for the session). They start once the layer is on
  // the map, not before: a map can wait a long time for an area to draw in
  // (a route behind its skeleton), which says nothing about the server. The
  // offline gate is never grounds for the swap: « VersaTiles is unreachable »
  // lasts the whole session, and releasing the switch has to find the server
  // where it left it rather than on a verdict the app's own blanking produced.
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, reason: FallbackReason) => {
    clearTimeout(giveUp);
    giveUp = setTimeout(() => {
      if (loaded === 0 && !isForcedOffline()) swap(reason);
    }, ms);
  };
  map.on('unload', () => clearTimeout(giveUp));

  // Stands the fallback back up — or hands the handle back to the one that
  // never left — when the vector layer cannot draw this map
  const giveBack = () => {
    if (previous) {
      handle.layer = previous;
      handle.onFallback = true;
    } else mountFallback(handle);
  };

  const swap = (reason: FallbackReason, detail?: string) => {
    if (settled || handle.generation !== generation) return;
    settled = true;
    vectorUnreachable = true;
    noteFallback(reason, detail);
    clearTimeout(giveUp);
    if (layer) map.removeLayer(layer);
    giveBack();
    armRecovery();
  };

  const add = (maplibreGL: GlLayerFactory) => {
    // The map unloaded, or another mount took the slot, while we waited
    if (handle.generation !== generation || !handles.has(handle)) return;
    try {
      layer = maplibreGL({
        style: styleUrl(),
        transformRequest: gateRequest,
        className: 'basemap-vector',
        // A tile that expires while on screen is not worth a refetch: the
        // ground does not move, and the worker answers cache-first anyway.
        refreshExpiredTiles: false,
        attributionControl: false,
      });
      // Leaflet's attribution control reads the layer, not the style
      (layer as unknown as { getAttribution(): string }).getAttribution = () => ATTRIBUTION;
      track(layer);
      layer.addTo(map);
      arm(STYLE_GIVE_UP_MS, 'style-timeout');
    } catch (err) {
      // The renderer refused this map (a context the browser would not
      // create, a blocklisted GPU). This map keeps the fallback; the next
      // one tries again.
      clearTimeout(giveUp);
      settled = true;
      noteFallback('renderer-refused', (err as Error)?.message);
      if (layer) map.removeLayer(layer);
      layer = null;
      giveBack();
      return;
    }
    handle.layer = layer;
    handle.onFallback = false;
    const gl = layer.getMaplibreMap();
    gl.on('styledata', () => {
      if (styleArrived || settled) return;
      styleArrived = true;
      // Reachable: from here only the tiles can still let the map down
      arm(TILE_GIVE_UP_MS, 'tiles-timeout');
    });
    gl.on('data', (e: { dataType?: string; tile?: unknown }) => {
      if (e.dataType !== 'source' || !e.tile || isForcedOffline()) return;
      loaded++;
      tilesLoaded++;
      if (!settled) {
        settled = true;
        clearTimeout(giveUp);
        if (previous) map.removeLayer(previous);
      }
    });
    gl.on('error', (e: { error?: Error; tile?: unknown; sourceId?: string }) => {
      tilesErrored++;
      if (settled || isForcedOffline()) return;
      const detail = e.error?.message;
      // A tile error only counts once it repeats, like the raster layer's did
      if (e.tile || e.sourceId) {
        errored++;
        if (loaded === 0 && errored >= 2) swap('tile-errors', detail);
        return;
      }
      // Anything else before the style arrived IS the style: nothing will
      // ever draw, swap at once. After it, it is a sprite or a font range —
      // a map without a few icons or labels is still the map.
      if (!styleArrived) swap('style-error', detail);
    });
  };

  void loadGl().then(
    (maplibreGL) => {
      if (handle.generation !== generation || !handles.has(handle)) return;
      // MapLibre cannot be born on a map it cannot follow (no size yet, no
      // view yet): wait for the resize or the first fit that gives it one.
      if (drawable(map)) {
        add(maplibreGL);
        return;
      }
      const onView = () => {
        if (!drawable(map)) return;
        map.off('resize viewreset moveend zoomend', onView);
        add(maplibreGL);
      };
      map.on('resize viewreset moveend zoomend', onView);
    },
    () => {
      // The renderer chunk did not load (offline on a first visit): this is
      // reachability like any other — the fallback, and the recovery probe.
      if (handle.generation === generation && handles.has(handle)) swap('renderer-chunk');
    },
  );
}

// ── Preload: start the map before there is one ───────────────────────────────
// A first visit opens on the onboarding screen, and the map only mounts once
// it is dismissed — which used to be when the renderer chunk (~270 kB gzip),
// the style, the sprite and the fonts all started downloading, one after the
// other, in front of a blank stage. The onboarding screen calls this as it
// mounts, so they download while the pitch is being read: the chunk through
// the same dynamic import the map will await, the assets as plain requests
// the HTTP cache (and the service worker, once it controls the page) hands
// straight back to MapLibre. Tiles are left alone: where the map will open
// depends on the answer to the location prompt that screen is about to ask.

/** The style's own font stacks, at the range every Latin label starts with */
const PRELOAD_GLYPHS = ['noto_sans_regular', 'noto_sans_bold'].map(
  (font) => `${VERSATILES}/assets/glyphs/${font}/0-255.pbf`,
);

let preloaded = false;

export function preloadBasemap(): void {
  if (preloaded) return;
  // Nothing to gain offline, and a device without WebGL never draws it
  if (isOffline() || !hasWebGl()) return;
  preloaded = true;
  loadGl().catch(() => {}); // the map's own mount retries a failed import
  // MapLibre asks for the @2x sprite on any screen denser than 1
  const sprite = `${VERSATILES}/assets/sprites/base${window.devicePixelRatio > 1 ? '@2x' : ''}`;
  for (const url of [styleUrl(), `${sprite}.json`, `${sprite}.png`, ...PRELOAD_GLYPHS]) {
    fetch(url, { mode: 'cors', credentials: 'omit', priority: 'low' }).catch(() => {});
  }
}

export function addBasemap(map: L.Map, visibleCenter?: () => L.LatLng): void {
  const handle: BasemapHandle = {
    map,
    layer: null,
    onFallback: false,
    generation: 0,
    center: visibleCenter ?? (() => map.getCenter()),
  };
  handles.add(handle);
  // Follow a theme switch in place — the fallback's filter in styles.css
  // flips on its own; the vector map swaps its style (the tiles stay). The
  // handle is read live, so the listener survives a fallback swap and a
  // recovery: it always retunes whatever vector layer currently stands.
  const offTheme = onThemeChange(() => {
    if (handle.onFallback || !handle.layer) return;
    (handle.layer as GlLayer).getMaplibreMap?.()?.setStyle(styleUrl());
  });
  map.on('unload', () => {
    offTheme();
    handles.delete(handle);
    handle.generation++;
  });
  installPyramidPrefetch(handle);
  // A map sitting on the fallback re-checks the server as it is used, not
  // only on the next `online` event or the next map: a swap that a slow
  // first load caused must not pin the whole session on OSM. The probe is
  // rate-limited (PROBE_MIN_INTERVAL_MS), so a pan costs nothing extra.
  map.on('moveend', () => {
    if (handle.onFallback) void attemptRecovery();
  });

  if (vectorUnreachable || webgl === false) {
    mountFallback(handle);
    // A new view is a natural moment to re-check the server — it covers
    // networks where no `online` event ever fires (a firewall rule lifted, a
    // VPN up).
    void attemptRecovery();
    return;
  }
  mountVector(handle);
}

// ── Recovery: swap back to VersaTiles when it answers again ──────────────────

/** One fixed low-zoom tile the reachability probe fetches */
const PROBE_URL = `${VERSATILES}/tiles/osm/3/4/2`;
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
  if (!vectorUnreachable || webgl === false || probing) return;
  // The probe is a request like any other: « Force offline mode » forbids it,
  // and the browser knowing it has no network makes it pointless.
  if (isOffline()) return;
  const now = Date.now();
  if (now - lastProbeAt < PROBE_MIN_INTERVAL_MS) return;
  lastProbeAt = now;
  probing = true;
  try {
    // The query string bypasses the service worker's tile cache (sw.js only
    // intercepts tile URLs carrying no query at all) and, with no-store, the
    // HTTP cache — a cached tile answering the probe would say nothing about
    // the network.
    await fetch(`${PROBE_URL}?probe=${now}`, { mode: 'no-cors', cache: 'no-store' });
  } catch {
    return; // still unreachable — the next online event or new map retries
  } finally {
    probing = false;
  }
  vectorUnreachable = false;
  recoveryArmed = false;
  window.removeEventListener('online', onOnline);
  // Every live fallback map swaps back; each re-runs the reachability check,
  // so a probe fooled by a captive portal just lands back on the fallback.
  for (const handle of [...handles]) {
    if (handle.onFallback) mountVector(handle);
  }
}

// ── Offline zoom pyramid ─────────────────────────────────────────────────────
// After each settled move, warm the service-worker tile cache with the ~4
// tiles per OTHER zoom that cover the map center — down to the world view so
// zooming out never falls off the cached slice, and up to the deepest level
// so zooming in on the center keeps drawing too. For the vector map that is
// the deepest level each SOURCE serves (z14, z10 for the landcover): past it
// the tiles are overzoomed, and street level costs nothing more. The fetches
// take the exact URLs the map requests (tilePyramid.ts) in CORS mode, so
// sw.js caches them on its normal lazy path — successes only.
//
// Each run plans against the cache itself (one key enumeration) rather than
// against a session memory of what was fetched before: what the LRU cap
// evicted is re-downloaded, so the pyramid self-repairs — and what is still
// held costs nothing at all, where a blind re-issue would push dozens of
// requests through the worker per settled move and re-write every one of
// them to refresh its recency.

/** Below this zoom the whole world is a handful of tiles — nothing to warm */
const PREFETCH_MIN_ZOOM = 5;
/** The map's maxZoom (lib/leafletMap.ts) — the deepest a zoom-in can go */
const PREFETCH_MAX_ZOOM = 19;
/** A pan mid-gesture fires moveend repeatedly; only the settled view counts */
const PREFETCH_DEBOUNCE_MS = 2000;
/** An idle slot is a preference, not a precondition: on a busy mobile page
    (map compositing, animations) requestIdleCallback can starve until the
    tab goes to background, so without the timeout the warm-up would fire
    almost only there. The view already settled through the debounce; this
    bounds the extra politeness wait. */
const IDLE_TIMEOUT_MS = 2000;

/** Every other raster level, nearest first — the first tiles to land are the
    ones a small zoom gesture (either direction) hits. The visited level
    itself is already cached by the normal tile loads. */
function rasterPyramidZooms(current: number): number[] {
  const zooms: number[] = [];
  for (let d = 1; current - d >= PREFETCH_MIN_ZOOM || current + d <= PREFETCH_MAX_ZOOM; d += 1) {
    if (current - d >= PREFETCH_MIN_ZOOM) zooms.push(current - d);
    if (current + d <= PREFETCH_MAX_ZOOM) zooms.push(current + d);
  }
  return zooms;
}

/** The URLs one prefetch run wants in the cache, for whichever basemap the
    map is on */
function pyramidUrls(handle: BasemapHandle): string[] {
  // The VISIBLE center, not the raw one: the floating panel (desktop) and the
  // bottom sheet (phone) cover part of the stage, and every fit centers its
  // content in what remains — a pyramid on the raw center would sit half a
  // panel off what the user is actually looking at.
  const center = handle.center();
  const zoom = handle.map.getZoom();
  const expand = (template: string, tiles: TileCoords[]) => tiles.map((t) => tileUrl(template, t));
  if (handle.onFallback) {
    const tiles = pyramidTiles(center.lat, center.lng, rasterPyramidZooms(Math.round(zoom)));
    return expand(FALLBACK_URL, tiles);
  }
  return VECTOR_SOURCES.flatMap(({ template, maxZoom }) =>
    expand(
      template,
      pyramidTiles(
        center.lat,
        center.lng,
        vectorPyramidZooms(zoom, PREFETCH_MIN_ZOOM, PREFETCH_MAX_ZOOM, maxZoom),
      ),
    ),
  );
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
  handle.map.on('unload', () => clearTimeout(timer));
}

async function prefetchPyramid(handle: BasemapHandle): Promise<void> {
  if (!handles.has(handle)) return; // the map went away while we idled
  if (!drawable(handle.map)) return; // no view to warm around yet
  // Offline is when the cache is SPENT, not fed — and « Force offline mode »
  // means no request at all: these fetches are raw, so the map's own gate
  // never sees them and cannot decline them for us.
  if (isOffline()) return;
  const held = await cachedTileUrls();
  if (!handles.has(handle) || isOffline()) return; // both can change during the read
  for (const url of pyramidUrls(handle)) {
    // The cache keys are absolute; the dev proxy's template is relative.
    if (held.has(new URL(url, location.href).href)) continue;
    // Best effort: a failed warm-up changes nothing on screen, and the next
    // settled move simply tries again. priority:'low' keeps the burst behind
    // anything the page needs even when the idle timeout forced the run
    // (browsers without the Fetch Priority API ignore the field).
    fetch(url, { mode: 'cors', credentials: 'omit', priority: 'low' }).catch(() => {});
  }
}
