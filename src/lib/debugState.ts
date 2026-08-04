// Breadcrumbs for state that is otherwise unobservable from outside — written
// by the store as it runs, read by the debug overlay's snapshot. Recording is
// a field write, cheap enough to run unconditionally; nothing here changes
// behavior, and nothing outside the overlay reads it.

/**
 * How the stations on screen were produced. The distinction the overlay
 * exists to make visible: `memory` is the synchronous `loadedArea` fast path
 * (no IO at all — the rule store.tsx protects for live circle drags),
 * `cache` an async IndexedDB paint, `cache-revalidate` the same paint with a
 * live fetch running behind it, `network` a committed live fetch, `error` a
 * failed one.
 */
export type AreaLoadPath = 'memory' | 'cache' | 'cache-revalidate' | 'network' | 'error';

let lastAreaLoad: { path: AreaLoadPath; at: number } | null = null;

export function reportAreaLoad(path: AreaLoadPath): void {
  lastAreaLoad = { path, at: Date.now() };
}

export function lastAreaLoadDebug(): { path: AreaLoadPath; at: number } | null {
  return lastAreaLoad;
}

// ── Tile layer ──────────────────────────────────────────────────────────────
// The counters live in lib/tiles.ts, which imports Leaflet — a module the
// node unit suite (and anything else leaflet-free) must never pull in just to
// type a snapshot. tiles.ts registers its getter here at load; before any map
// existed the neutral reading below is also the truthful one.

export interface TileLayerDebug {
  /** Layer new maps get right now (the session-wide fallback decision) */
  active: 'carto' | 'fallback';
  cartoUnreachable: boolean;
  tilesLoaded: number;
  tilesErrored: number;
}

let tileDebugSource: (() => TileLayerDebug) | null = null;

export function registerTileDebugSource(source: () => TileLayerDebug): void {
  tileDebugSource = source;
}

export function tileLayerDebugSnapshot(): TileLayerDebug {
  return (
    tileDebugSource?.() ?? {
      active: 'carto',
      cartoUnreachable: false,
      tilesLoaded: 0,
      tilesErrored: 0,
    }
  );
}
