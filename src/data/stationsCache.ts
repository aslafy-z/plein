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

const LS_KEY = 'plein.stations.cache.v1';
const MAX_AREAS = 4;
/** Without containment, a cached area still paints when its center is close */
const MATCH_KM = 3;
/** Older than this → the UI flags the data as outdated */
export const STALE_MS = 10 * 60_000;

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
}

function load(): CacheEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const list = raw ? (JSON.parse(raw) as CacheEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: CacheEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — cache is best-effort */
  }
}

export function readStationsCache(
  source: DataSourceId,
  center: GeoPoint,
  radiusKm: number,
): StationsCacheHit | null {
  const entries = load().filter((e) => e.source === source);
  const covering = entries.find(
    (e) =>
      e.fetchRadiusKm != null &&
      haversineKm(e.center, center) + radiusKm <= e.fetchRadiusKm,
  );
  if (covering) {
    return { stations: covering.stations, fetchedAt: covering.fetchedAt, covers: true };
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
  save([{ source, center, fetchRadiusKm, fetchedAt, stations }, ...rest].slice(0, MAX_AREAS));
}
