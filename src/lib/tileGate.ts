// Whether a basemap tile may be requested right now.
//
// « Force offline mode » (Settings › Offline data) has to reach the basemap
// too, and nothing in the store's fetch paths can stop it: Leaflet loads
// tiles with plain <img> requests, which never pass through the providers.
// The one point every tile does pass through is the URL Leaflet asks the
// layer for — so that is where the mode is enforced, by handing back a blank
// instead of a CDN address. A declined tile costs NO request at all.
//
// A tile the service worker already holds is still requested while the mode
// holds: Cache Storage answers it without a network round trip, so the map
// keeps painting everywhere the user has already been — which is the whole
// point of the mode. That mirrors how the station cache behaves offline.
//
// Leaflet-free on purpose: lib/tiles.ts imports Leaflet, and this decision is
// the part worth unit-testing.
import { isForcedOffline } from './connectivity';
import { SW_TILE_CACHE } from './swCaches';

/** 1×1 transparent GIF — Leaflet's own `emptyImageUrl`, inlined here so that
 *  declining a tile paints nothing without reaching for anything */
export const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

/** Tile URLs Cache Storage held when the gate last looked. Null while the
 *  mode is off, and while the first read is still in flight — which blanks
 *  every tile for that instant rather than letting one slip out. */
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
    const cache = await caches.open(SW_TILE_CACHE);
    cachedUrls = new Set((await cache.keys()).map((req) => req.url));
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
 * The URL to actually put on a tile: `url` itself when it may be requested,
 * `BLANK_TILE` when the gate declines it. Synchronous by necessity — Leaflet
 * asks a layer for a URL, not for a promise.
 */
export function tileUrlFor(url: string): string {
  if (!isForcedOffline()) return url;
  if (cachedUrls?.has(url)) return url;
  skipped++;
  return BLANK_TILE;
}

/** A tile the gate declined — never evidence that the CDN is unreachable */
export function isBlankTile(url: string): boolean {
  return url === BLANK_TILE;
}

/** Debug chrome: tiles declined, and how many URLs the snapshot holds */
export function tileGateDebug(): { tilesSkipped: number; tilesCached: number | null } {
  return { tilesSkipped: skipped, tilesCached: cachedUrls?.size ?? null };
}
