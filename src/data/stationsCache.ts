// Per-area station cache (stale-while-revalidate + containment).
//
// The last few searched areas are kept in IndexedDB so the app paints
// instantly from cache while a background fetch refreshes the prices; the UI
// shows a refresh/outdated indicator based on `fetchedAt`. Every fetch covers
// a circle much larger than the displayed radius, so a hit also says whether
// the requested zone lies FULLY inside the cached area (`covers`) — when it
// does and the data is fresh, the store skips the network entirely: a slight
// map move re-uses the stations we already have, like the basemap tiles.
//
// Three tiers, all measured from `fetchedAt`, so nothing on screen can be
// older than the app admits to:
//   – under STALE_MS        fresh; the network is not touched at all
//   – under MAX_CACHE_AGE_MS painted immediately, revalidated behind it, with
//                            the freshness chip escalating past REVALIDATE_MS
//   – beyond                 dropped; the app lands on its loading/error path
//                            rather than presenting last week's prices.
//
// Storage layout: an `areas` index of metadata (a few hundred bytes for the
// whole cache) is read eagerly at boot, and the station arrays live one record
// per area in `payloads`, loaded only when an area actually matches. So a boot
// that ends up refetching never deserializes a payload, and a refresh writes
// one record instead of re-serializing every cached area.
import { haversineKm, type GeoPoint } from '../lib/geo';
import { isQuotaError, openCacheStore, type CacheStore } from './cacheStore';
import type { DataSourceId, Station } from './types';

// Every localStorage generation this store replaces. They are all deleted on
// the first boot: nothing writes them any more, and they would keep occupying
// the ~5 MB budget the settings blob lives in.
const LEGACY_LS_KEYS = [
  'plein.stations.cache.v1',
  'plein.stations.cache.v2',
  'plein.stations.cache.v3',
] as const;
// Only the last generation is worth adopting. v1 predates the `fra-` id prefix
// and would paint stations that no longer match favorites or /station/<id>
// links; v2 predates the `adBlue` tag, so a Spanish station that does sell it
// would stay hidden behind the filter until the background refresh landed.
// Both were superseded by a key rename for exactly those reasons.
const LEGACY_IMPORT_KEY = 'plein.stations.cache.v3';

/** Payloads are lazy, so the resident cost is what this session touched */
const MAX_AREAS = 6;
/** Without containment, a cached area still paints when its center is close */
const MATCH_KM = 3;
/** Advisory ceiling on the durable footprint — see `estimateBytes` */
const BUDGET_BYTES = 8 * 1024 * 1024;
/** Older than this → the UI flags the data as outdated */
export const STALE_MS = 10 * 60_000;
/** Older than this → the chip stops saying « N h ago » and names the day */
export const REVALIDATE_MS = 6 * 3_600_000;
/** Hard ceiling: entries this old never paint at all. A cold boot that finds
 *  a week-old area must land on the loading/error path, not present last
 *  week's prices as today's. */
export const MAX_CACHE_AGE_MS = 7 * 24 * 3_600_000;

/**
 * What the view should voice about data fetched at `fetchedAt`:
 * – `fresh`       nothing worth saying
 * – `stale`       past STALE_MS, so the age is worth naming
 * – `unrefreshed` a refresh failed; the age alone would read as reassurance
 *                 (« just now » under a banner announcing the source is down)
 * – `dated`       past REVALIDATE_MS, where an age stops meaning anything and
 *                 the day the prices were read is the honest thing to show
 *
 * `dated` outranks `unrefreshed`: at that age the failure is implied, and the
 * date is the stronger warning. Pure, so the boundaries are testable without
 * a browser — the component turns the answer into a sentence.
 */
export type FreshnessLevel = 'fresh' | 'stale' | 'unrefreshed' | 'dated';

export function freshnessLevel(
  fetchedAt: number | undefined,
  failing: boolean,
  now = Date.now(),
): FreshnessLevel {
  if (!fetchedAt) return 'fresh';
  const age = now - fetchedAt;
  if (age > REVALIDATE_MS) return 'dated';
  if (failing) return 'unrefreshed';
  return age > STALE_MS ? 'stale' : 'fresh';
}

/** What the eagerly-loaded index holds for one fetched area */
interface AreaMeta {
  key: string;
  source: DataSourceId;
  center: GeoPoint;
  /** Radius the fetch actually covered */
  fetchRadiusKm: number;
  fetchedAt: number;
  stationCount: number;
  /** Estimated payload size, for the budget and the Settings readout */
  bytes: number;
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

export interface StationsCacheStats {
  areas: number;
  /** Estimated total payload size */
  bytes: number;
  oldestFetchedAt: number | null;
  /** false when the cache only lives for this session */
  durable: boolean;
}

// ── Session state ────────────────────────────────────────────────────────────
// The index and the payloads this session touched ARE the cache; the store is
// a write-behind mirror flushed on idle. Reads and writes never wait on it.
const index = new Map<string, AreaMeta>();
const payloads = new Map<string, Station[]>();
const pendingPuts = new Set<string>();
const pendingDeletes = new Set<string>();

let store: CacheStore | null = null;
let durable = false;
let hydrated: Promise<void> | null = null;
/** Cancels the queued flush, when one is queued */
let cancelQueued: (() => void) | null = null;
/** Idle callbacks can starve on a busy tab — write out within 2s regardless */
const FLUSH_TIMEOUT_MS = 2_000;

/** 4 decimals ≈ 11 m: finer than the MATCH_KM area the key stands for. */
function areaKey(source: DataSourceId, center: GeoPoint): string {
  return `${source}|${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
}

/**
 * Rough serialized size of a payload. IndexedDB reports no per-record size,
 * and running `JSON.stringify` purely to count bytes would re-do the work
 * structured clone spared us. The budget is advisory — an O(stations) estimate
 * is all it takes to keep the store from growing without bound.
 */
function estimateBytes(stations: Station[]): number {
  let chars = 0;
  for (const s of stations) {
    // id, coordinates, flags and the object framing itself
    chars += 160;
    chars += s.name.length + s.address.length + s.city.length + (s.brand?.length ?? 0);
    chars += Object.keys(s.prices).length * 40;
    chars += s.tags.length * 12;
    for (const service of s.services) chars += service.length + 4;
    if (s.hours) chars += 220;
  }
  return chars * 2; // UTF-16
}

function isUsableMeta(value: unknown): value is AreaMeta {
  if (typeof value !== 'object' || value === null) return false;
  const meta = value as Partial<AreaMeta>;
  return (
    typeof meta.key === 'string' &&
    typeof meta.source === 'string' &&
    typeof meta.fetchRadiusKm === 'number' &&
    typeof meta.fetchedAt === 'number' &&
    typeof meta.bytes === 'number' &&
    typeof meta.center?.lat === 'number' &&
    typeof meta.center?.lng === 'number' &&
    Date.now() - meta.fetchedAt <= MAX_CACHE_AGE_MS
  );
}

function forget(key: string): void {
  index.delete(key);
  payloads.delete(key);
  pendingPuts.delete(key);
}

/** Forget an area here AND in the store */
function drop(key: string): void {
  forget(key);
  pendingDeletes.add(key);
}

// ── Persistence ──────────────────────────────────────────────────────────────

function disablePersistence(): void {
  durable = false;
  pendingPuts.clear();
  pendingDeletes.clear();
}

/** Oldest area that is not `keep` — the one to shed when the origin is full */
function oldestKeyBesides(keep: string): string | null {
  let oldest: AreaMeta | null = null;
  for (const meta of index.values()) {
    if (meta.key === keep) continue;
    if (!oldest || meta.fetchedAt < oldest.fetchedAt) oldest = meta;
  }
  return oldest?.key ?? null;
}

async function writeArea(current: CacheStore, meta: AreaMeta, retried: boolean): Promise<void> {
  const stations = payloads.get(meta.key);
  if (!stations) return;
  try {
    await current.put('payloads', meta.key, stations);
    await current.put('areas', meta.key, meta);
  } catch (err) {
    if (!isQuotaError(err) || retried) {
      // Out of room with nothing left to shed, or a store that is simply
      // broken: this session keeps its in-memory cache and stops persisting.
      disablePersistence();
      return;
    }
    const shed = oldestKeyBesides(meta.key);
    if (shed) {
      forget(shed);
      await current.delete('payloads', shed).catch(() => {});
      await current.delete('areas', shed).catch(() => {});
    }
    await writeArea(current, meta, true);
  }
}

async function persist(): Promise<void> {
  // A write can land before anything read the cache, so the store may still be
  // unopened here — the flush is what opens it, not the first read.
  await ready();
  const current = store;
  if (!current || !durable) {
    pendingPuts.clear();
    pendingDeletes.clear();
    return;
  }
  const deletes = [...pendingDeletes];
  pendingDeletes.clear();
  for (const key of deletes) {
    try {
      await current.delete('payloads', key);
      await current.delete('areas', key);
    } catch {
      /* the record stays until the next eviction — harmless */
    }
  }
  const puts = [...pendingPuts];
  pendingPuts.clear();
  for (const key of puts) {
    const meta = index.get(key);
    if (meta) await writeArea(current, meta, false);
  }
}

interface IdleHost {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

function queueFlush(): void {
  // Already queued → that callback persists whatever the index holds by then
  if (cancelQueued) return;
  const host = globalThis as IdleHost;
  const run = () => {
    cancelQueued = null;
    void persist();
  };
  if (typeof host.requestIdleCallback === 'function') {
    const handle = host.requestIdleCallback(run, { timeout: FLUSH_TIMEOUT_MS });
    cancelQueued = () => host.cancelIdleCallback?.(handle);
  } else {
    const handle = setTimeout(run, 0);
    cancelQueued = () => clearTimeout(handle);
  }
}

/**
 * Writes the pending records out now — a tab going away may never idle again.
 * Whether the transaction commits before the tab dies is up to the browser;
 * losing the newest area is acceptable (it is a cache) and a torn record is
 * impossible, since each area lands in one transaction or not at all.
 */
export async function flushStationsCache(): Promise<void> {
  await ready();
  if (cancelQueued) {
    cancelQueued();
    cancelQueued = null;
  }
  await persist();
}

// ── Hydration ────────────────────────────────────────────────────────────────

/** Shape of the localStorage generations this store replaces */
interface LegacyEntry {
  source?: DataSourceId;
  center?: GeoPoint;
  fetchRadiusKm?: number;
  fetchedAt?: number;
  stations?: Station[];
}

/**
 * Adopt the last localStorage blob, then delete both legacy keys. They are
 * removed even when nothing durable is available: nothing writes them any
 * more, so keeping them would pin a few hundred KB of the localStorage budget
 * forever for data this session has already taken in memory.
 */
function importLegacyBlob(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_IMPORT_KEY);
  } catch {
    return; // storage denied entirely — nothing to import and nothing to clean
  }
  if (raw) {
    try {
      const entries = JSON.parse(raw) as unknown;
      if (Array.isArray(entries)) {
        for (const entry of entries as LegacyEntry[]) {
          const { source, center, fetchRadiusKm, fetchedAt, stations } = entry;
          if (!source || !center || fetchRadiusKm == null || fetchedAt == null) continue;
          if (!Array.isArray(stations)) continue;
          if (Date.now() - fetchedAt > MAX_CACHE_AGE_MS) continue;
          // Anything IndexedDB already holds for that place is at least as new
          const known = [...index.values()].some(
            (m) => m.source === source && haversineKm(m.center, center) <= MATCH_KM,
          );
          if (known) continue;
          adopt(source, center, fetchRadiusKm, stations, fetchedAt);
        }
      }
    } catch {
      /* corrupt blob — dropped with the key below */
    }
  }
  for (const key of LEGACY_LS_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* best effort */
    }
  }
}

/** An area already in memory covers this place for this source, and is newer */
function supersededByMemory(meta: AreaMeta): boolean {
  for (const mine of index.values()) {
    if (
      mine.source === meta.source &&
      haversineKm(mine.center, meta.center) <= MATCH_KM &&
      mine.fetchedAt >= meta.fetchedAt
    ) {
      return true;
    }
  }
  return false;
}

/** true once `hydrate` finished — the debug readout tells a cold index apart
 *  from a genuinely empty one */
let hydratedDone = false;

async function hydrate(): Promise<void> {
  store = await openCacheStore();
  durable = store.durable;
  try {
    for (const meta of await store.list<AreaMeta>('areas')) {
      if (!isUsableMeta(meta)) {
        // Expired or unreadable: shed it now rather than carry it for a week
        const key = (meta as Partial<AreaMeta>)?.key;
        if (typeof key === 'string') pendingDeletes.add(key);
        continue;
      }
      // A fetch can land before anything read the cache — the store opens on
      // that write's flush, so hydration must not restore an area over the
      // fresher one already in memory for the same place.
      if (supersededByMemory(meta)) {
        pendingDeletes.add(meta.key);
        continue;
      }
      index.set(meta.key, meta);
    }
  } catch {
    // Unreadable index: the app simply refetches. Persisting over it would
    // fight whatever is wrong with the store, so this session stays in memory.
    disablePersistence();
  }
  importLegacyBlob();
  evict();
  if (pendingPuts.size || pendingDeletes.size) queueFlush();
  hydratedDone = true;
}

/** Resolves once the area index is in memory. Idempotent, never rejects. */
export function ready(): Promise<void> {
  hydrated ??= hydrate().catch(() => {
    disablePersistence();
  });
  return hydrated;
}

/**
 * Re-read the index from the store. Another tab that refreshed an area wrote
 * a newer record under the same key; taking its metadata and dropping our
 * payload copy makes the next read load the newer stations.
 */
async function refreshIndex(): Promise<void> {
  const current = store;
  if (!current || !durable || pendingPuts.size) return;
  try {
    const seen = new Set<string>();
    for (const meta of await current.list<AreaMeta>('areas')) {
      if (!isUsableMeta(meta)) continue;
      seen.add(meta.key);
      const mine = index.get(meta.key);
      if (mine && mine.fetchedAt >= meta.fetchedAt) continue;
      index.set(meta.key, meta);
      payloads.delete(meta.key);
    }
    for (const key of [...index.keys()]) {
      if (!seen.has(key)) forget(key);
    }
  } catch {
    /* best effort — the in-memory index stays authoritative */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushStationsCache());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushStationsCache();
    else void refreshIndex();
  });
}

// ── Reads and writes ─────────────────────────────────────────────────────────

async function loadPayload(key: string): Promise<Station[] | null> {
  const held = payloads.get(key);
  if (held) return held;
  const current = store;
  if (!current) {
    forget(key);
    return null;
  }
  try {
    const stations = await current.get<Station[]>('payloads', key);
    if (!Array.isArray(stations)) {
      // Index entry without its payload (evicted under quota, cleared by the
      // browser): forget the area rather than report an empty zone.
      drop(key);
      queueFlush();
      return null;
    }
    payloads.set(key, stations);
    return stations;
  } catch {
    forget(key);
    return null;
  }
}

export async function readStationsCache(
  source: DataSourceId,
  center: GeoPoint,
  radiusKm: number,
): Promise<StationsCacheHit | null> {
  await ready();
  const now = Date.now();
  const entries = [...index.values()].filter(
    (e) => e.source === source && now - e.fetchedAt <= MAX_CACHE_AGE_MS,
  );
  const covering = entries.find(
    (e) => haversineKm(e.center, center) + radiusKm <= e.fetchRadiusKm,
  );
  const match = covering ?? entries.find((e) => haversineKm(e.center, center) <= MATCH_KM);
  if (!match) return null;
  const stations = await loadPayload(match.key);
  if (!stations) return null;
  return covering
    ? {
        stations,
        fetchedAt: covering.fetchedAt,
        covers: true,
        center: covering.center,
        fetchRadiusKm: covering.fetchRadiusKm,
      }
    : { stations, fetchedAt: match.fetchedAt, covers: false };
}

/**
 * By-id lookup across EVERY cached area, not just the one covering searchPos —
 * a favorite whose area was fetched ten minutes ago has its price sitting in
 * IndexedDB right now, and looking it up costs zero network. Newest areas are
 * searched first, so an id present in two areas reports the newer price, and
 * each hit carries its area's `fetchedAt` so the caller can voice an honest
 * age. Payloads load lazily and stay memoized; the sweep stops as soon as
 * every id is found.
 */
export async function collectCachedStations(
  ids: ReadonlySet<string>,
): Promise<Map<string, { station: Station; fetchedAt: number }>> {
  const out = new Map<string, { station: Station; fetchedAt: number }>();
  if (!ids.size) return out;
  await ready();
  const now = Date.now();
  const metas = [...index.values()]
    .filter((meta) => now - meta.fetchedAt <= MAX_CACHE_AGE_MS)
    .sort((a, b) => b.fetchedAt - a.fetchedAt);
  for (const meta of metas) {
    if (out.size === ids.size) break;
    const stations = await loadPayload(meta.key);
    if (!stations) continue;
    for (const station of stations) {
      if (ids.has(station.id) && !out.has(station.id)) {
        out.set(station.id, { station, fetchedAt: meta.fetchedAt });
      }
    }
  }
  return out;
}

/** Newest areas first, within both the count cap and the byte budget */
function evict(): void {
  const byAge = [...index.values()].sort((a, b) => b.fetchedAt - a.fetchedAt);
  let bytes = 0;
  byAge.forEach((meta, i) => {
    bytes += meta.bytes;
    // The newest area is kept whatever it weighs — dropping what was just
    // fetched would make the cache useless on a device with no room at all.
    if (i >= MAX_AREAS || (i > 0 && bytes > BUDGET_BYTES)) drop(meta.key);
  });
}

function adopt(
  source: DataSourceId,
  center: GeoPoint,
  fetchRadiusKm: number,
  stations: Station[],
  fetchedAt: number,
): void {
  // Same source, same place → one area; the newer fetch replaces the older
  for (const meta of [...index.values()]) {
    if (meta.source === source && haversineKm(meta.center, center) <= MATCH_KM) drop(meta.key);
  }
  const key = areaKey(source, center);
  index.set(key, {
    key,
    source,
    center,
    fetchRadiusKm,
    fetchedAt,
    stationCount: stations.length,
    bytes: estimateBytes(stations),
  });
  payloads.set(key, stations);
  pendingDeletes.delete(key);
  pendingPuts.add(key);
  evict();
}

export function writeStationsCache(
  source: DataSourceId,
  center: GeoPoint,
  fetchRadiusKm: number,
  stations: Station[],
  fetchedAt: number,
): void {
  adopt(source, center, fetchRadiusKm, stations, fetchedAt);
  queueFlush();
}

// ── Inspection and control (Settings « Data ») ───────────────────────────────

export async function cacheStats(): Promise<StationsCacheStats> {
  await ready();
  const metas = [...index.values()];
  return {
    areas: metas.length,
    bytes: metas.reduce((total, m) => total + m.bytes, 0),
    oldestFetchedAt: metas.length ? Math.min(...metas.map((m) => m.fetchedAt)) : null,
    durable,
  };
}

/** One area of the index, as the debug overlay / Settings diagnostics see it */
export interface CachedAreaDebug {
  key: string;
  source: DataSourceId;
  center: GeoPoint;
  fetchRadiusKm: number;
  fetchedAt: number;
  stationCount: number;
  bytes: number;
  /** Its station array currently sits in memory (was read this session) */
  payloadInMemory: boolean;
}

export interface StationsCacheDebug {
  durable: boolean;
  hydrated: boolean;
  pendingPuts: number;
  pendingDeletes: number;
  areas: CachedAreaDebug[];
}

/**
 * Synchronous window on the in-memory index — the debug overlay's raw
 * per-area records. Read-only: instrumentation is data here, never control.
 */
export function stationsCacheDebug(): StationsCacheDebug {
  return {
    durable,
    hydrated: hydratedDone,
    pendingPuts: pendingPuts.size,
    pendingDeletes: pendingDeletes.size,
    areas: [...index.values()]
      .sort((a, b) => b.fetchedAt - a.fetchedAt)
      .map((meta) => ({
        key: meta.key,
        source: meta.source,
        center: meta.center,
        fetchRadiusKm: meta.fetchRadiusKm,
        fetchedAt: meta.fetchedAt,
        stationCount: meta.stationCount,
        bytes: meta.bytes,
        payloadInMemory: payloads.has(meta.key),
      })),
  };
}

/** A cached area with its full station array, for the debug map layer */
export interface CachedAreaStations {
  key: string;
  source: DataSourceId;
  center: GeoPoint;
  fetchRadiusKm: number;
  fetchedAt: number;
  stations: Station[];
}

/**
 * EVERY cached area with its stations — the debug map layer draws the whole
 * cache, loaded zone or not, so what the store holds is visible on the map.
 * Deliberately eager about payloads (each read stays memoized); only debug
 * chrome may call this, ordinary code keeps the lazy per-area reads.
 */
export async function readAllCachedAreas(): Promise<CachedAreaStations[]> {
  await ready();
  const now = Date.now();
  const out: CachedAreaStations[] = [];
  for (const meta of [...index.values()].sort((a, b) => b.fetchedAt - a.fetchedAt)) {
    if (now - meta.fetchedAt > MAX_CACHE_AGE_MS) continue;
    const stations = await loadPayload(meta.key);
    if (!stations) continue;
    out.push({
      key: meta.key,
      source: meta.source,
      center: meta.center,
      fetchRadiusKm: meta.fetchRadiusKm,
      fetchedAt: meta.fetchedAt,
      stations,
    });
  }
  return out;
}

/** Drops every cached area, here and in the store. Settings stay untouched. */
export async function clearStationsCache(): Promise<void> {
  await ready();
  if (cancelQueued) {
    cancelQueued();
    cancelQueued = null;
  }
  index.clear();
  payloads.clear();
  pendingPuts.clear();
  pendingDeletes.clear();
  try {
    await store?.clear();
  } catch {
    /* best effort — the session cache is empty either way */
  }
}
