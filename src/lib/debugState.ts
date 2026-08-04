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
