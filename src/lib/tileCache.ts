// The page's window on the service worker's basemap tile cache
// (`plein-tiles-v1` in public/sw.js). Read-only — nothing here writes the
// cache — and Leaflet-free, so both the snapshot code and the prefetcher can
// import it. Two readers, two shapes:
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
import type { TileCoords } from './tilePyramid';

/** Which basemap a cached tile belongs to. The dev proxy path counts as the
    fallback it stands in for. */
export type TileStyle = 'dark' | 'light' | 'fallback';

export interface CachedTile extends TileCoords {
  style: TileStyle;
  retina: boolean;
}

/** Mirrored from public/sw.js — the debug reader must stay in step */
const TILE_CACHE_NAME = 'plein-tiles-v1';

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
    const keys = await (await caches.open(TILE_CACHE_NAME)).keys();
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
