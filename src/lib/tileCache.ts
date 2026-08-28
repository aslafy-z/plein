// The page's window on the service worker's basemap tile cache (`TILE_CACHE`
// in public/sw.js, mirrored by lib/swCaches.ts). Leaflet-free, so the
// snapshot code, the prefetcher and the Settings « Data » section can all
// import it. Three readers, three shapes — plus the one writer:
//
// – `cachedTileUrls` is what the pyramid prefetcher plans against: knowing
//   which URLs are already held turns a blind burst of fetches into the few
//   the cache is actually missing.
// – `readCachedTiles` parses the keys back into tile coordinates + style, so
//   the overlay can count them per zoom and the map's debug layer can draw
//   every cached tile's footprint — off-screen tiles and other zooms
//   included, which is what makes the pyramid visible instead of deduced.
//   That view is debug chrome: English-only, never in the catalogs (see
//   CLAUDE.md, Language).
// – `tileCacheStats` is the Settings « Data » counter's share of the tiles:
//   how many are held, and roughly what they weigh — roughly, because the
//   tiles are cached as no-cors (opaque) responses whose bodies the page
//   cannot read, so the size is entries × a per-tile average rather than a
//   sum of measured blobs.
// – `clearTileCache` is « Clear offline data »'s sweep of the same: every
//   `plein-tiles-*` generation goes, the current one and any an older worker
//   left behind. The worker recreates its cache on the next tile it serves.
import type { TileCoords } from './tilePyramid';
import { SW_TILE_CACHE, SW_TILE_CACHE_PREFIX } from './swCaches';

/** Which basemap a cached tile belongs to. The dev proxy path counts as the
    fallback it stands in for. */
export type TileStyle = 'dark' | 'light' | 'fallback';

export interface CachedTile extends TileCoords {
  style: TileStyle;
  retina: boolean;
}

const CARTO_PATH = /^\/(dark_all|light_all)\/(\d+)\/(\d+)\/(\d+)(@2x)?\.png$/;
const ZXY_PATH = /^\/(\d+)\/(\d+)\/(\d+)\.png$/;

/**
 * Parse one cached URL back into a tile; null for anything that is not a
 * basemap tile (foreign entries, or a `?probe=` URL — those must never be
 * cached, and a parser that accepted one would hide that bug).
 */
export function parseTileUrl(raw: string): CachedTile | null {
  let url: URL;
  try {
    url = new URL(raw, 'http://relative.invalid');
  } catch {
    return null;
  }
  if (url.search !== '') return null;
  const host = url.hostname;
  if (host === 'basemaps.cartocdn.com' || host.endsWith('.basemaps.cartocdn.com')) {
    const m = CARTO_PATH.exec(url.pathname);
    if (!m) return null;
    return {
      style: m[1] === 'light_all' ? 'light' : 'dark',
      z: Number(m[2]),
      x: Number(m[3]),
      y: Number(m[4]),
      retina: m[5] != null,
    };
  }
  const path =
    host === 'tile.openstreetmap.org'
      ? url.pathname
      : url.pathname.startsWith('/tiles/')
        ? url.pathname.slice('/tiles'.length)
        : null;
  if (path == null) return null;
  const m = ZXY_PATH.exec(path);
  if (!m) return null;
  return { style: 'fallback', z: Number(m[1]), x: Number(m[2]), y: Number(m[3]), retina: false };
}

/**
 * The raw URLs the tile cache holds. Enumerating keys is async IO — callers
 * read on demand (once per prefetch run, once per snapshot), never on a
 * timer. Missing Cache Storage (node, insecure context, a browser refusing
 * it) reads as an empty cache, which degrades to the previous behaviour:
 * every candidate looks missing and is fetched.
 */
export async function cachedTileUrls(): Promise<Set<string>> {
  if (typeof caches === 'undefined') return new Set();
  try {
    const keys = await (await caches.open(SW_TILE_CACHE)).keys();
    return new Set(keys.map((req) => req.url));
  } catch {
    return new Set();
  }
}

/** Every parsed tile currently in the SW cache — the debug views' shape. */
export async function readCachedTiles(): Promise<CachedTile[]> {
  const urls = await cachedTileUrls();
  return [...urls].map(parseTileUrl).filter((t): t is CachedTile => t != null);
}

// What one cached tile is counted as. The entries are opaque responses —
// status 0, unreadable body, empty blob — so the page cannot weigh them; a
// plain CARTO/OSM 256px PNG runs ~10–30 kB and the @2x tiles retina screens
// load run heavier, so the counter charges a flat average and the UI presents
// the result as approximate. (`navigator.storage.estimate()` is no
// alternative: Chromium pads each opaque response by ~7 MB there — the debug
// details show that figure, with the caveat spelled out next to it.)
export const TILE_BYTES_ESTIMATE = 20_000;

export interface TileCacheStats {
  tiles: number;
  /** Estimated — entries × TILE_BYTES_ESTIMATE, never measured */
  bytes: number;
}

/**
 * How much of the offline data is basemap tiles, across every `plein-tiles-*`
 * generation. Missing or refusing Cache Storage reads as an empty cache, like
 * the readers above.
 */
export async function tileCacheStats(): Promise<TileCacheStats> {
  if (typeof caches === 'undefined') return { tiles: 0, bytes: 0 };
  try {
    const names = (await caches.keys()).filter((n) => n.startsWith(SW_TILE_CACHE_PREFIX));
    let tiles = 0;
    for (const name of names) {
      tiles += (await (await caches.open(name)).keys()).length;
    }
    return { tiles, bytes: tiles * TILE_BYTES_ESTIMATE };
  } catch {
    return { tiles: 0, bytes: 0 };
  }
}

/**
 * Drops every tile cache generation — « Clear offline data »'s share of the
 * service worker's storage. Best effort: a refusal leaves the tiles where
 * they were, and the worker rebuilds the cache lazily either way.
 */
export async function clearTileCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const names = (await caches.keys()).filter((n) => n.startsWith(SW_TILE_CACHE_PREFIX));
    await Promise.all(names.map((name) => caches.delete(name)));
  } catch {
    /* best effort — see above */
  }
}

export interface TileCacheDebug {
  entries: number;
  /** `z5: 4 · z6: 8 …`, ascending — the pyramid's shape in numbers */
  byZoom: Record<string, number>;
  byStyle: Record<TileStyle, number>;
}

export function summarizeCachedTiles(tiles: CachedTile[]): TileCacheDebug {
  const zoomCounts = new Map<number, number>();
  const byStyle: Record<TileStyle, number> = { dark: 0, light: 0, fallback: 0 };
  for (const t of tiles) {
    zoomCounts.set(t.z, (zoomCounts.get(t.z) ?? 0) + 1);
    byStyle[t.style] += 1;
  }
  const byZoom: Record<string, number> = {};
  for (const z of [...zoomCounts.keys()].sort((a, b) => a - b)) {
    byZoom[`z${z}`] = zoomCounts.get(z)!;
  }
  return { entries: tiles.length, byZoom, byStyle };
}
