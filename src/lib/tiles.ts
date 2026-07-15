// Dark basemap with automatic fallback.
// Primary: CARTO dark CDN, re-toned to the app palette via `.tiles-carto`.
// When it can't load (offline CDN, firewalled network), the map swaps to
// OpenStreetMap tiles (through the dev-server proxy in dev), darkened with
// the `.tiles-dark` CSS filter so the app keeps its look. The first map that
// discovers the CDN is unreachable remembers it for the session, so the map,
// route and station views all switch together.
import L from 'leaflet';
import { IS_DEV } from './env';

const CARTO_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const FALLBACK_URL = IS_DEV ? '/tiles/{z}/{x}/{y}.png' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** No CARTO tile managed to load within this window → assume unreachable */
const GIVE_UP_MS = 6000;

let cartoUnreachable = false;

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
}) as unknown as new (url: string, opts: L.TileLayerOptions) => L.TileLayer;

const bufferedTileLayer = (url: string, opts: L.TileLayerOptions): L.TileLayer =>
  new BufferedTileLayer(url, opts);

function addFallback(map: L.Map): void {
  bufferedTileLayer(FALLBACK_URL, {
    ...TILE_RETENTION,
    attribution: '© OpenStreetMap · © CARTO',
    maxZoom: 19,
    // The dev proxy serves CARTO (already dark); the prod fallback is raw OSM
    // and needs the darkening filter.
    className: IS_DEV ? 'tiles-carto' : 'tiles-dark',
  }).addTo(map);
}

export function addDarkBasemap(map: L.Map): void {
  if (cartoUnreachable) {
    addFallback(map);
    return;
  }

  const carto = bufferedTileLayer(CARTO_URL, {
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
  // alone can miss the failure — the timer catches that case.
  const giveUp = setTimeout(() => {
    if (loaded === 0) swap();
  }, GIVE_UP_MS);

  carto.on('tileload', () => {
    loaded++;
    clearTimeout(giveUp);
  });
  carto.on('tileerror', () => {
    errored++;
    if (loaded === 0 && errored >= 2) swap();
  });
  map.on('unload', () => clearTimeout(giveUp));

  carto.addTo(map);
}
