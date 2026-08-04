// Compact per-favorite price store + partition-aware refresh plan (issue #133).
//
// A favorite is pinned precisely because it is *elsewhere* — the loaded map
// area rarely covers it, and pricing one favorite through the providers can
// cost a whole Spanish province or the entire Andorran flux. So favorite
// prices get their own home: `favoritePrices` in `plein.cache`, one ~200 B
// record per favorite (`id → { prices, fetchedAt }`), written opportunistically
// whenever a favorite is seen in ANY area or route fetch. Being independent of
// the `areas` index, it accumulates for free, survives `evict()` and reloads,
// and can never collide with a map area the way a favorite-shaped area write
// would (`adopt()` drops same-source areas within MATCH_KM).
//
// Two timestamps, two questions — kept distinct on purpose:
//   – the source's per-fuel `updatedAt` (inside each FuelPrice) is when the
//     station declared the price, and stays the thing the row displays;
//   – our `fetchedAt` is when we read it, and decides whether to refresh and
//     whether to show the entry at all — past MAX_CACHE_AGE_MS it is dropped,
//     exactly as areas are.
//
// Writes are synchronous with a queued flush, mirroring `writeStationsCache`:
// the `loadedArea` fast path in store.tsx must never start waiting on IO
// during a live circle drag.
import type { GeoPoint } from '../lib/geo';
import { haversineKm } from '../lib/geo';
import { openCacheStore, type CacheStore } from './cacheStore';
import { MAX_CACHE_AGE_MS, STALE_MS } from './stationsCache';
import { stationCountry, type StationCountry } from './stationIds';
import type { FuelId, FuelPrice, Station } from './types';

export interface FavoritePriceEntry {
  id: string;
  prices: Partial<Record<FuelId, FuelPrice>>;
  fetchedAt: number;
}

// ── Session state ────────────────────────────────────────────────────────────
// The in-memory map IS the store; IndexedDB is a write-behind mirror flushed
// on idle. Reads and writes never wait on it.
const entries = new Map<string, FavoritePriceEntry>();
const pendingPuts = new Set<string>();
const pendingDeletes = new Set<string>();

let store: CacheStore | null = null;
let durable = false;
let hydrated: Promise<void> | null = null;
let cancelQueued: (() => void) | null = null;
/** Idle callbacks can starve on a busy tab — write out within 2s regardless */
const FLUSH_TIMEOUT_MS = 2_000;

function isUsableEntry(value: unknown): value is FavoritePriceEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Partial<FavoritePriceEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.fetchedAt === 'number' &&
    typeof e.prices === 'object' &&
    e.prices !== null &&
    Date.now() - e.fetchedAt <= MAX_CACHE_AGE_MS
  );
}

function drop(id: string): void {
  entries.delete(id);
  pendingPuts.delete(id);
  pendingDeletes.add(id);
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function persist(): Promise<void> {
  await ready();
  const current = store;
  if (!current || !durable) {
    pendingPuts.clear();
    pendingDeletes.clear();
    return;
  }
  const deletes = [...pendingDeletes];
  pendingDeletes.clear();
  for (const id of deletes) {
    try {
      await current.delete('favoritePrices', id);
    } catch {
      /* the record stays until the next prune — harmless */
    }
  }
  const puts = [...pendingPuts];
  pendingPuts.clear();
  for (const id of puts) {
    const entry = entries.get(id);
    if (!entry) continue;
    try {
      await current.put('favoritePrices', id, entry);
    } catch {
      // Out of room or a broken store: the session keeps its in-memory
      // entries and stops persisting — a cache miss later, never an error.
      durable = false;
      pendingPuts.clear();
      pendingDeletes.clear();
      return;
    }
  }
}

interface IdleHost {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

function queueFlush(): void {
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

/** Writes the pending records out now — a tab going away may never idle again */
export async function flushFavoritePrices(): Promise<void> {
  await ready();
  if (cancelQueued) {
    cancelQueued();
    cancelQueued = null;
  }
  await persist();
}

async function hydrate(): Promise<void> {
  store = await openCacheStore();
  durable = store.durable;
  try {
    for (const record of await store.list<FavoritePriceEntry>('favoritePrices')) {
      if (!isUsableEntry(record)) {
        // Expired or unreadable: shed it now rather than carry it for a week
        const id = (record as Partial<FavoritePriceEntry>)?.id;
        if (typeof id === 'string') pendingDeletes.add(id);
        continue;
      }
      // A record can land before hydration (the flush opens the store, not
      // the first read) — never restore an older record over a newer one.
      const held = entries.get(record.id);
      if (held && held.fetchedAt >= record.fetchedAt) continue;
      entries.set(record.id, record);
    }
  } catch {
    durable = false;
  }
  if (pendingPuts.size || pendingDeletes.size) queueFlush();
}

/** Resolves once the entries are in memory. Idempotent, never rejects. */
export function ready(): Promise<void> {
  hydrated ??= hydrate().catch(() => {
    durable = false;
  });
  return hydrated;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushFavoritePrices());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushFavoritePrices();
  });
}

// ── Reads and writes ─────────────────────────────────────────────────────────

/**
 * Keep the prices of every favorite present in `stations`. Called on each
 * area or route fetch (and on the phase-1 sweep over cached areas), with the
 * fetch's own `fetchedAt` — a newer entry is never overwritten by an older
 * area handing back the same station. Synchronous by contract.
 */
export function recordFavoritePrices(
  favoriteIds: ReadonlySet<string>,
  stations: readonly Station[],
  fetchedAt: number,
): void {
  if (!favoriteIds.size) return;
  let touched = false;
  for (const s of stations) {
    if (!favoriteIds.has(s.id)) continue;
    const held = entries.get(s.id);
    if (held && held.fetchedAt > fetchedAt) continue;
    entries.set(s.id, { id: s.id, prices: s.prices, fetchedAt });
    pendingDeletes.delete(s.id);
    pendingPuts.add(s.id);
    touched = true;
  }
  if (touched) queueFlush();
}

/**
 * Entries for the given ids. An entry past MAX_CACHE_AGE_MS is dropped rather
 * than returned — a week-old price must not paint as today's, exactly as a
 * week-old area lands on the loading path instead of the map.
 */
export async function readFavoritePrices(
  ids: readonly string[],
): Promise<Map<string, FavoritePriceEntry>> {
  await ready();
  const now = Date.now();
  const out = new Map<string, FavoritePriceEntry>();
  let dropped = false;
  for (const id of ids) {
    const entry = entries.get(id);
    if (!entry) continue;
    if (now - entry.fetchedAt > MAX_CACHE_AGE_MS) {
      drop(id);
      dropped = true;
      continue;
    }
    out.set(id, entry);
  }
  if (dropped) queueFlush();
  return out;
}

/** Shed entries for stations no longer starred — the store follows the list */
export function pruneFavoritePrices(keep: ReadonlySet<string>): void {
  void ready().then(() => {
    let dropped = false;
    for (const id of [...entries.keys()]) {
      if (keep.has(id)) continue;
      drop(id);
      dropped = true;
    }
    if (dropped) queueFlush();
  });
}

/** Drops every entry, here and in the store (Settings « Data » clear) */
export async function clearFavoritePrices(): Promise<void> {
  await ready();
  if (cancelQueued) {
    cancelQueued();
    cancelQueued = null;
  }
  const ids = [...entries.keys()];
  entries.clear();
  pendingPuts.clear();
  pendingDeletes.clear();
  const current = store;
  if (!current || !durable) return;
  for (const id of ids) {
    await current.delete('favoritePrices', id).catch(() => {});
  }
}

// ── Refresh plan (phase 3) ───────────────────────────────────────────────────

/**
 * Radius of one refresh fetch. Favorites are exact points, so coverage only
 * needs the station itself — the margin exists so favorites pinned around the
 * same town share one French page (the one source whose cost is genuinely
 * radius-proportional).
 */
export const FAVORITE_FETCH_RADIUS_KM = 10;
/**
 * Provider calls per refresh round. The scarce resource is bytes, not
 * requests: each call resolves through the favorite's own country provider,
 * whose fetches are partitioned and memoized (province / district / country
 * for esp / prt / and), so N favorites inside one partition cost one download
 * however they are grouped here. The cap bounds the cold-start worst case;
 * favorites left over are picked up by the next round.
 */
export const MAX_REFRESH_FETCHES = 6;

export interface FavoriteRefreshTarget {
  id: string;
  lat: number;
  lng: number;
}

export interface FavoriteRefreshGroup {
  /** Source the group resolves through — the favorite's OWN country, never
      the selected map source: an esp favorite is priced by the esp flux
      whatever the map is showing. */
  country: StationCountry;
  /** Fetch circle for a geo-partitioned source; a by-id source ignores it */
  center: GeoPoint;
  radiusKm: number;
  ids: string[];
}

/**
 * Which fetches (if any) a Favorites refresh should issue. Pure — the caller
 * supplies the clock and the per-id last-attempt times, so every branch is
 * unit-testable:
 *   – fresh entries (under STALE_MS) cost nothing, ids attempted less than
 *     STALE_MS ago are left alone (a station absent from its own zone must
 *     not be re-fetched in a loop), ids outside the country scheme (demo)
 *     are never fetched;
 *   – never-priced favorites go first, then the oldest prices;
 *   – one group per country + place, at most MAX_REFRESH_FETCHES groups.
 *     A country in `byIdCountries` answers by exact id (the provider's
 *     `getStationsByIds`), so ALL its stale favorites share one group —
 *     one request, one slot of the cap — however far apart they sit.
 */
export function planFavoriteRefresh(
  favorites: readonly FavoriteRefreshTarget[],
  entries: ReadonlyMap<string, { fetchedAt: number }>,
  opts: {
    now?: number;
    attemptedAt?: ReadonlyMap<string, number>;
    byIdCountries?: ReadonlySet<StationCountry>;
  } = {},
): FavoriteRefreshGroup[] {
  const now = opts.now ?? Date.now();
  const stale = favorites.filter((f) => {
    if (!stationCountry(f.id)) return false;
    const tried = opts.attemptedAt?.get(f.id);
    if (tried != null && now - tried < STALE_MS) return false;
    const entry = entries.get(f.id);
    return !entry || now - entry.fetchedAt > STALE_MS;
  });
  const sorted = [...stale].sort(
    (a, b) => (entries.get(a.id)?.fetchedAt ?? 0) - (entries.get(b.id)?.fetchedAt ?? 0),
  );
  const groups: FavoriteRefreshGroup[] = [];
  for (const f of sorted) {
    const country = stationCountry(f.id)!;
    const byId = opts.byIdCountries?.has(country) === true;
    const near = groups.find(
      (g) => g.country === country && (byId || haversineKm(g.center, f) <= g.radiusKm),
    );
    if (near) {
      near.ids.push(f.id);
      continue;
    }
    if (groups.length >= MAX_REFRESH_FETCHES) continue;
    groups.push({
      country,
      center: { lat: f.lat, lng: f.lng },
      radiusKm: FAVORITE_FETCH_RADIUS_KM,
      ids: [f.id],
    });
  }
  return groups;
}
