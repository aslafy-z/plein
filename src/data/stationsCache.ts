// Per-area station cache (stale-while-revalidate).
// The last few searched areas are kept in localStorage so the app paints
// instantly from cache while a background fetch refreshes the prices; the UI
// shows a refresh/outdated indicator based on `fetchedAt`.
import { haversineKm, type GeoPoint } from '../lib/geo';
import type { DataSourceId, Station } from './types';

const LS_KEY = 'plein.stations.cache.v1';
const MAX_AREAS = 4;
/** A cached area serves a request when its center is within this distance */
const MATCH_KM = 3;
/** Older than this → the UI flags the data as outdated */
export const STALE_MS = 10 * 60_000;

interface CacheEntry {
  source: DataSourceId;
  center: GeoPoint;
  fetchedAt: number;
  stations: Station[];
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
): { stations: Station[]; fetchedAt: number } | null {
  const hit = load().find(
    (e) => e.source === source && haversineKm(e.center, center) <= MATCH_KM,
  );
  return hit ? { stations: hit.stations, fetchedAt: hit.fetchedAt } : null;
}

export function writeStationsCache(
  source: DataSourceId,
  center: GeoPoint,
  stations: Station[],
  fetchedAt: number,
): void {
  const rest = load().filter(
    (e) => !(e.source === source && haversineKm(e.center, center) <= MATCH_KM),
  );
  save([{ source, center, fetchedAt, stations }, ...rest].slice(0, MAX_AREAS));
}
