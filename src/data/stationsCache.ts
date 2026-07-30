// Per-area station cache (stale-while-revalidate + containment).
// The last few searched areas are kept in localStorage so the app paints
// instantly from cache while a background fetch refreshes the prices; the UI
// shows a refresh/outdated indicator based on `fetchedAt`. Every fetch covers
// a circle much larger than the displayed radius, so a hit also says whether
// the requested zone lies FULLY inside the cached area (`covers`) — when it
// does and the data is fresh, the store skips the network entirely: a slight
// map move re-uses the stations we already have, like the basemap tiles.
import { haversineKm, type GeoPoint } from '../lib/geo';
import type { DataSourceId, Station } from './types';

// v2: French ids gained their `fra-` prefix — v1 blobs hold the bare ones and
// would paint stations that no longer match favorites or /station/<id> links.
// v3: `adBlue` became a filterable tag. v2 entries were parsed before it
// existed, so a Spanish station that does sell AdBlue carries no such tag and
// the filter would hide it until the background refresh landed.
const LS_KEY = 'plein.stations.cache.v3';
const MAX_AREAS = 4;
/** Without containment, a cached area still paints when its center is close */
const MATCH_KM = 3;
/** Older than this → the UI flags the data as outdated */
export const STALE_MS = 10 * 60_000;
/** Hard ceiling: entries this old never paint at all. A cold boot that finds
 *  a week-old area must land on the loading/error path, not present last
 *  week's prices as today's. */
export const MAX_CACHE_AGE_MS = 7 * 24 * 3_600_000;

interface CacheEntry {
  source: DataSourceId;
  center: GeoPoint;
  /** Radius the fetch actually covered (absent on pre-existing entries) */
  fetchRadiusKm?: number;
  fetchedAt: number;
  stations: Station[];
}

export interface StationsCacheHit {
  stations: Station[];
  fetchedAt: number;
  /** The requested zone (center + radius) lies fully inside the cached area */
  covers: boolean;
  /** Geometry of the covering area (set when `covers`) — lets the store
      answer later containment checks in memory, without re-reading here */
  center?: GeoPoint;
  fetchRadiusKm?: number;
}

// The blob is several hundred KB (4 areas × up to a few hundred stations, each
// with prices, tags, services and an hours tree). Parsing it on every read and
// serializing it on every write blocked the main thread exactly when the new
// stations were being painted. So the parsed list lives in memory — reads and
// writes touch it directly — and only the JSON.stringify + setItem is queued,
// on idle, coalesced: the cache is best-effort, nothing waits on it.
let areas: CacheEntry[] | null = null;
/** Cancels the queued write, when one is queued */
let cancelQueued: (() => void) | null = null;
/** Idle callbacks can starve on a busy tab — write out within 2s regardless */
const FLUSH_TIMEOUT_MS = 2_000;

function load(): CacheEntry[] {
  if (areas) return areas;
  try {
    const raw = localStorage.getItem(LS_KEY);
    const list = raw ? (JSON.parse(raw) as CacheEntry[]) : [];
    areas = Array.isArray(list) ? list : [];
  } catch {
    areas = [];
  }
  return areas;
}

function write(): void {
  if (!areas) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(areas));
  } catch {
    /* quota / private mode — cache is best-effort */
  }
}

interface IdleHost {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

function queueWrite(): void {
  // Already queued → that callback serializes whatever `areas` holds by then
  if (cancelQueued) return;
  const host = globalThis as IdleHost;
  const run = () => {
    cancelQueued = null;
    write();
  };
  if (typeof host.requestIdleCallback === 'function') {
    const handle = host.requestIdleCallback(run, { timeout: FLUSH_TIMEOUT_MS });
    cancelQueued = () => host.cancelIdleCallback?.(handle);
  } else {
    const handle = setTimeout(run, 0);
    cancelQueued = () => clearTimeout(handle);
  }
}

/** Writes the pending blob out now — a tab going away may never idle again. */
export function flushStationsCache(): void {
  if (!cancelQueued) return;
  cancelQueued();
  cancelQueued = null;
  write();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushStationsCache);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushStationsCache();
  });
  // Another tab refreshed an area — drop our copy so the next read re-parses.
  // Not while a write is queued: ours is the newer one, it wins.
  window.addEventListener('storage', (e) => {
    if ((e.key === LS_KEY || e.key === null) && !cancelQueued) areas = null;
  });
}

export function readStationsCache(
  source: DataSourceId,
  center: GeoPoint,
  radiusKm: number,
): StationsCacheHit | null {
  const entries = load().filter(
    (e) => e.source === source && Date.now() - e.fetchedAt <= MAX_CACHE_AGE_MS,
  );
  const covering = entries.find(
    (e) =>
      e.fetchRadiusKm != null &&
      haversineKm(e.center, center) + radiusKm <= e.fetchRadiusKm,
  );
  if (covering) {
    return {
      stations: covering.stations,
      fetchedAt: covering.fetchedAt,
      covers: true,
      center: covering.center,
      fetchRadiusKm: covering.fetchRadiusKm,
    };
  }
  const near = entries.find((e) => haversineKm(e.center, center) <= MATCH_KM);
  return near ? { stations: near.stations, fetchedAt: near.fetchedAt, covers: false } : null;
}

export function writeStationsCache(
  source: DataSourceId,
  center: GeoPoint,
  fetchRadiusKm: number,
  stations: Station[],
  fetchedAt: number,
): void {
  const rest = load().filter(
    (e) => !(e.source === source && haversineKm(e.center, center) <= MATCH_KM),
  );
  areas = [{ source, center, fetchRadiusKm, fetchedAt, stations }, ...rest].slice(0, MAX_AREAS);
  queueWrite();
}
