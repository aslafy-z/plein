// Whether a basemap tile may be requested right now.
//
// « Force offline mode » (Settings › Offline data) has to reach the basemap
// too, and nothing in the store's fetch paths can stop it: the vector map
// fetches its tiles and glyphs from MapLibre's own workers, and the raster
// fallback loads plain <img> tiles — neither passes through the providers.
// The one point every request does pass through is the URL the map asks for
// (MapLibre's `transformRequest`, the fallback layer's `getTileUrl`) — so that
// is where the mode is enforced, by handing back an empty `data:` payload
// instead of a server address. A declined tile costs NO request at all.
//
// A tile the service worker already holds is still requested while the mode
// holds: Cache Storage answers it without a network round trip, so the map
// keeps painting everywhere the user has already been — which is the whole
// point of the mode. That mirrors how the station cache behaves offline.
//
// The style and the sprite are NOT gated: they are one request each per map,
// the worker keeps them (`plein-basemap-*`, public/sw.js), and the map cannot
// draw anything at all without them. Glyphs are gated like tiles — a missing
// range costs some labels, not the map.
//
// Leaflet- and MapLibre-free on purpose: lib/tiles.ts imports both, and this
// decision is the part worth unit-testing.
import { isForcedOffline } from './connectivity';
import { SW_BASEMAP_CACHE, SW_TILE_CACHE } from './swCaches';

/** 1×1 transparent GIF — Leaflet's own `emptyImageUrl`, inlined here so that
 *  declining a raster tile paints nothing without reaching for anything */
export const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

/** An empty protobuf — what a declined vector tile or glyph range answers:
 *  MapLibre reads it as a tile with no features, a range with no glyphs */
export const BLANK_PBF = 'data:application/x-protobuf;base64,';

/** URLs Cache Storage held (tiles and glyphs) when the gate last looked.
 *  Null while the mode is off, and while the first read is still in flight —
 *  which blanks every tile for that instant rather than letting one slip out. */
let cachedUrls: Set<string> | null = null;
let reading: Promise<void> | null = null;
let skipped = 0;

/**
 * Read the tile cache's URLs. Never rejects: an origin without Cache Storage
 * (a private window, an insecure origin, a browser refusing it) holds
 * nothing, so nothing may be requested — the gate blanks everything, which is
 * exactly what that device would show with its network cut.
 */
async function readTileCache(): Promise<void> {
  try {
    const urls = new Set<string>();
    for (const name of [SW_TILE_CACHE, SW_BASEMAP_CACHE]) {
      for (const req of await (await caches.open(name)).keys()) urls.add(req.url);
    }
    cachedUrls = urls;
  } catch {
    cachedUrls = new Set();
  }
}

/** Resolves once the gate knows what Cache Storage holds. Idempotent. */
export function ensureTileSnapshot(): Promise<void> {
  reading ??= readTileCache();
  return reading;
}

/** Forget it — the mode is off, and every tile may be asked for again */
export function dropTileSnapshot(): void {
  cachedUrls = null;
  reading = null;
}

/**
 * The URL to actually request: `url` itself when it may be requested,
 * `blank` (the raster blank by default, `BLANK_PBF` for the vector map) when
 * the gate declines it. Synchronous by necessity — Leaflet asks a layer for a
 * URL and MapLibre's `transformRequest` for a request, not for a promise.
 */
export function tileUrlFor(url: string, blank: string = BLANK_TILE): string {
  if (!isForcedOffline()) return url;
  if (cachedUrls?.has(url)) return url;
  skipped++;
  return blank;
}

/** A tile the gate declined — never evidence that the server is unreachable */
export function isBlankTile(url: string): boolean {
  return url === BLANK_TILE || url === BLANK_PBF;
}

/** Debug chrome: tiles declined, and how many URLs the snapshot holds */
export function tileGateDebug(): { tilesSkipped: number; tilesCached: number | null } {
  return { tilesSkipped: skipped, tilesCached: cachedUrls?.size ?? null };
}
