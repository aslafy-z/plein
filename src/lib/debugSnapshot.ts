// Snapshot the debug overlay renders and copies — the answer to « what data
// is on screen, where did it come from, and what state is the machinery in ».
//
// Everything here is a WINDOW on state that already exists (the repo's
// « instrumentation is data » stance): the collector reads the store's public
// state (passed in by the overlay), the module getters added for it
// (tiles.ts, stationsCache.ts, debugMode.ts, debugState.ts) and the browser
// (service worker, Cache Storage, storage estimate). It never mutates
// anything and never runs behind a closed chip — the overlay collects on a
// short tick only while its panel is open.
//
// Debug chrome is English-only by design (see CLAUDE.md, Language): the
// snapshot is data pasted into issues, not UI copy, so nothing here goes
// through the catalogs.
import type { DataSourceId } from '../data/types';
import {
  stationsCacheDebug,
  MAX_CACHE_AGE_MS,
  REVALIDATE_MS,
  STALE_MS,
} from '../data/stationsCache';
import { consoleErrorsDebug, type RecordedError } from './debugMode';
import {
  lastAreaLoadDebug,
  tileLayerDebugSnapshot,
  type AreaLoadPath,
  type TileLayerDebug,
} from './debugState';
import { APP_VERSION } from './appUpdate';
import { IS_DEV } from './env';
import type { GeoPoint } from './geo';

// The service worker's cache names and caps, mirrored from public/sw.js —
// the page reads entry counts straight out of Cache Storage, and the caps
// give the numbers their meaning (« 597/600 » is one pan away from eviction).
const SW_CACHE_CAPS: Record<string, number | null> = {
  'plein-assets-v1': 160,
  'plein-shell-v1': null,
  'plein-tiles-v1': 600,
  'plein-data-v1': null,
};

/** The three-tier freshness ladder of stationsCache, plus `dropped` beyond it */
export type CacheTier = 'fresh' | 'revalidate' | 'stale' | 'dropped';

/** Which stationsCache tier data fetched at `fetchedAt` sits in right now */
export function cacheTier(fetchedAt: number, now = Date.now()): CacheTier {
  const age = now - fetchedAt;
  if (age > MAX_CACHE_AGE_MS) return 'dropped';
  if (age > REVALIDATE_MS) return 'stale';
  if (age > STALE_MS) return 'revalidate';
  return 'fresh';
}

/**
 * ~1 km grid (2 decimals ≈ 1.1 km of latitude): coarse enough that a pasted
 * snapshot no longer points at the tester's home, fine enough to still say
 * which town the report is about.
 */
export function roundCoord(v: number): number {
  return Math.round(v * 100) / 100;
}

export function roundPoint(p: GeoPoint): GeoPoint {
  return { lat: roundCoord(p.lat), lng: roundCoord(p.lng) };
}

/** Compact age for humans reading the panel — "41s", "12m", "3h05", "2d" */
export function fmtAgeMs(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d`;
}

/** Store-derived state the overlay reads from useApp() and hands in */
export interface AppDebugInput {
  screen: string;
  sourceId: DataSourceId;
  locale: string;
  theme: string;
  arrangement: 'phone' | 'desktop';
  stations: {
    status: string;
    activeSource: DataSourceId;
    /** stations of the loaded area, before filters */
    rawCount: number;
    /** after brand/service filters, inside the radius */
    visibleCount: number;
    fetchedAt?: number;
    refreshing: boolean;
    lastError?: string;
  };
  geoStatus: string;
  hasKnownPos: boolean;
  lastPos: GeoPoint | null;
  searchPos: GeoPoint;
  searchedAway: boolean;
  mapZoom: number | null;
  radiusKm: number;
  fuel: string;
}

export interface AreaDebugRow {
  key: string;
  source: DataSourceId;
  center: GeoPoint;
  fetchRadiusKm: number;
  fetchedAt: number;
  age: string;
  tier: CacheTier;
  stationCount: number;
  bytes: number;
  payloadInMemory: boolean;
}

export interface DebugSnapshot {
  collectedAt: number;
  /** true when coordinates were rounded to the ~1 km privacy grid */
  coordsRounded: boolean;
  build: { version: string; dev: boolean };
  sw: {
    supported: boolean;
    registered: boolean;
    controlling: boolean;
    /** registered but not controlling this page — the « bypassed » case */
    bypassed: boolean;
    updateWaiting: boolean;
    scriptUrl: string | null;
  };
  connectivity: { onLine: boolean };
  app: {
    screen: string;
    sourceId: DataSourceId;
    locale: string;
    theme: string;
    arrangement: 'phone' | 'desktop';
    viewport: { width: number; height: number };
  };
  storage: {
    usageBytes: number | null;
    quotaBytes: number | null;
    cacheDurable: boolean;
    /** openCacheStore() fell back to the in-memory store — nothing persists */
    memoryFallback: boolean;
    /** entry counts per service-worker cache, with the sw.js caps */
    swCaches: { name: string; entries: number; cap: number | null }[];
  };
  areaCache: {
    hydrated: boolean;
    pendingPuts: number;
    pendingDeletes: number;
    lastLoad: { path: AreaLoadPath; at: number; age: string } | null;
    areas: AreaDebugRow[];
  };
  stationsOnScreen: {
    status: string;
    activeSource: DataSourceId;
    rawCount: number;
    visibleCount: number;
    fetchedAt: number | null;
    age: string | null;
    tier: CacheTier | null;
    refreshing: boolean;
    lastError: string | null;
  };
  tiles: TileLayerDebug;
  position: {
    geoStatus: string;
    hasKnownPos: boolean;
    lastPos: GeoPoint | null;
    searchPos: GeoPoint;
    searchedAway: boolean;
    mapZoom: number | null;
    radiusKm: number;
    fuel: string;
  };
  errors: { count: number; recent: RecordedError[] };
}

async function collectSw(): Promise<DebugSnapshot['sw']> {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  if (!supported) {
    return {
      supported: false,
      registered: false,
      controlling: false,
      bypassed: false,
      updateWaiting: false,
      scriptUrl: null,
    };
  }
  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.getRegistration();
  } catch {
    registration = undefined;
  }
  const controller = navigator.serviceWorker.controller;
  return {
    supported: true,
    registered: registration != null,
    controlling: controller != null,
    // Registered but this page runs uncontrolled (hard reload, first visit):
    // half of « the cache doesn't work » reports in one boolean.
    bypassed: registration != null && controller == null,
    updateWaiting: registration?.waiting != null,
    scriptUrl: controller?.scriptURL ?? registration?.active?.scriptURL ?? null,
  };
}

/**
 * Entry counts of the app's Cache Storage caches. Enumerating keys is async
 * IO — the reason the whole snapshot is collected on demand, never on a
 * timer.
 */
export async function collectSwCaches(): Promise<DebugSnapshot['storage']['swCaches']> {
  if (typeof caches === 'undefined') return [];
  try {
    const names = (await caches.keys()).filter((n) => n.startsWith('plein-'));
    return await Promise.all(
      names.map(async (name) => {
        const entries = (await (await caches.open(name)).keys()).length;
        return { name, entries, cap: SW_CACHE_CAPS[name] ?? null };
      }),
    );
  } catch {
    return [];
  }
}

async function collectStorageEstimate(): Promise<{ usage: number | null; quota: number | null }> {
  try {
    const est = await navigator.storage?.estimate?.();
    return { usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

/** One full snapshot. `roundCoords` applies the ~1 km privacy grid. */
export async function collectDebugSnapshot(
  app: AppDebugInput,
  opts: { roundCoords: boolean },
): Promise<DebugSnapshot> {
  const now = Date.now();
  const round = opts.roundCoords;
  const point = (p: GeoPoint): GeoPoint => (round ? roundPoint(p) : p);

  const [sw, swCaches, estimate] = await Promise.all([
    collectSw(),
    collectSwCaches(),
    collectStorageEstimate(),
  ]);

  const cache = stationsCacheDebug();
  const lastLoad = lastAreaLoadDebug();

  return {
    collectedAt: now,
    coordsRounded: round,
    build: { version: APP_VERSION, dev: IS_DEV },
    sw,
    connectivity: { onLine: typeof navigator === 'undefined' || navigator.onLine !== false },
    app: {
      screen: app.screen,
      sourceId: app.sourceId,
      locale: app.locale,
      theme: app.theme,
      arrangement: app.arrangement,
      viewport:
        typeof window === 'undefined'
          ? { width: 0, height: 0 }
          : { width: window.innerWidth, height: window.innerHeight },
    },
    storage: {
      usageBytes: estimate.usage,
      quotaBytes: estimate.quota,
      cacheDurable: cache.durable,
      memoryFallback: cache.hydrated && !cache.durable,
      swCaches,
    },
    areaCache: {
      hydrated: cache.hydrated,
      pendingPuts: cache.pendingPuts,
      pendingDeletes: cache.pendingDeletes,
      lastLoad: lastLoad ? { ...lastLoad, age: fmtAgeMs(now - lastLoad.at) } : null,
      areas: cache.areas.map((a) => ({
        // The key embeds the raw center — rebuild it on the privacy grid
        key: round ? `${a.source}|${roundCoord(a.center.lat)},${roundCoord(a.center.lng)}` : a.key,
        source: a.source,
        center: point(a.center),
        fetchRadiusKm: a.fetchRadiusKm,
        fetchedAt: a.fetchedAt,
        age: fmtAgeMs(now - a.fetchedAt),
        tier: cacheTier(a.fetchedAt, now),
        stationCount: a.stationCount,
        bytes: a.bytes,
        payloadInMemory: a.payloadInMemory,
      })),
    },
    stationsOnScreen: {
      status: app.stations.status,
      activeSource: app.stations.activeSource,
      rawCount: app.stations.rawCount,
      visibleCount: app.stations.visibleCount,
      fetchedAt: app.stations.fetchedAt ?? null,
      age: app.stations.fetchedAt != null ? fmtAgeMs(now - app.stations.fetchedAt) : null,
      tier: app.stations.fetchedAt != null ? cacheTier(app.stations.fetchedAt, now) : null,
      refreshing: app.stations.refreshing,
      lastError: app.stations.lastError ?? null,
    },
    tiles: tileLayerDebugSnapshot(),
    position: {
      geoStatus: app.geoStatus,
      hasKnownPos: app.hasKnownPos,
      lastPos: app.lastPos ? point(app.lastPos) : null,
      searchPos: point(app.searchPos),
      searchedAway: app.searchedAway,
      mapZoom: app.mapZoom,
      radiusKm: app.radiusKm,
      fuel: app.fuel,
    },
    errors: consoleErrorsDebug(),
  };
}
