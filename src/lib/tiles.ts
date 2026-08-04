// Themed basemap with automatic fallback.
// Primary: CARTO CDN — dark_all or light_all following the app theme, re-toned
// to the palette via `.tiles-carto` (whose filter is per-theme in styles.css).
// A theme switch swaps the layer's URL in place, so every mounted map follows
// without remounting. When the CDN can't load (offline, firewalled network),
// the map swaps to OpenStreetMap tiles (through the dev-server proxy in dev),
// re-toned per theme with the `.tiles-dark` CSS filter so the app keeps its
// look. The first map that discovers the CDN is unreachable remembers it for
// the session, so the map, route and station views all switch together.
import L from 'leaflet';
import { IS_DEV } from './env';
import { currentTheme, onThemeChange } from './colorScheme';
import { registerTileDebugSource, type TileLayerDebug } from './debugState';
import { isForcedOffline, onConnectivityChange } from './connectivity';
import {
  dropTileSnapshot,
  ensureTileSnapshot,
  isBlankTile,
  tileGateDebug,
  tileUrlFor,
} from './tileGate';

const cartoUrl = () =>
  `https://{s}.basemaps.cartocdn.com/${currentTheme() === 'light' ? 'light_all' : 'dark_all'}/{z}/{x}/{y}{r}.png`;
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

function addFallback(map: L.Map): void {
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
  layer.addTo(map);
}

export function addBasemap(map: L.Map): void {
  if (cartoUnreachable) {
    addFallback(map);
    return;
  }

  const carto = bufferedTileLayer(cartoUrl(), {
    ...TILE_RETENTION,
    attribution: '© OpenStreetMap · © CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
    className: 'tiles-carto',
  });

  let loaded = 0;
  let errored = 0;
  let swapped = false;

  const swap = () => {
    if (swapped) return;
    swapped = true;
    cartoUnreachable = true;
    map.removeLayer(carto);
    addFallback(map);
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
  });
  carto.on('tileerror', () => {
    errored++;
    tilesErrored++;
    if (loaded === 0 && errored >= 2 && !isForcedOffline()) swap();
  });

  // Follow a theme switch in place — the tile filters in styles.css flip on
  // their own; only the tile set itself has to be refetched.
  const offTheme = onThemeChange(() => {
    if (!swapped) carto.setUrl(cartoUrl());
  });
  map.on('unload', () => {
    clearTimeout(giveUp);
    offTheme();
  });

  track(carto);
  carto.addTo(map);
}
