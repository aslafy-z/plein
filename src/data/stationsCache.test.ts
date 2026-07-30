import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GeoPoint } from '../lib/geo';
import type { CacheStore, StoreName } from './cacheStore';
import { freshnessLevel, REVALIDATE_MS, STALE_MS } from './stationsCache';
import type { Station } from './types';

const LEGACY_KEY = 'plein.stations.cache.v3';
const CENTER: GeoPoint = { lat: 43.6045, lng: 1.4442 };
const PARIS: GeoPoint = { lat: 48.8566, lng: 2.3522 };

function station(id: string): Station {
  return {
    id,
    name: `Station ${id}`,
    init: 'ST',
    lat: 43.6,
    lng: 1.44,
    address: '1 rue du Test',
    city: 'Toulouse',
    prices: { diesel: { value: 1.75 } },
    tags: [],
    services: [],
    highway: false,
  };
}

/** localStorage stub — only the legacy blob still goes through it */
function installStorage() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal('localStorage', stub);
  return stub;
}

interface SpyStore extends CacheStore {
  readonly records: Map<StoreName, Map<string, unknown>>;
  puts: number;
  payloadReads: number;
  /** Rejects the next `failPuts` writes with a quota error */
  failPuts: number;
}

/**
 * A durable store that outlives `vi.resetModules()`, so a test can reopen the
 * module the way a reload would and assert on what survived. Node has no
 * IndexedDB, and the adapter seam exists precisely so the quota and
 * hydration paths stay testable without one.
 */
function spyStore(): SpyStore {
  const records = new Map<StoreName, Map<string, unknown>>();
  const of = (name: StoreName) => {
    let bucket = records.get(name);
    if (!bucket) {
      bucket = new Map();
      records.set(name, bucket);
    }
    return bucket;
  };
  const store: SpyStore = {
    records,
    puts: 0,
    payloadReads: 0,
    failPuts: 0,
    durable: true,
    get: async <T>(name: StoreName, key: string) => {
      if (name === 'payloads') store.payloadReads += 1;
      return of(name).get(key) as T | undefined;
    },
    put: async (name, key, value) => {
      if (store.failPuts > 0) {
        store.failPuts -= 1;
        const err = new Error('the origin is full');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.puts += 1;
      of(name).set(key, value);
    },
    delete: async (name, key) => void of(name).delete(key),
    list: async <T>(name: StoreName) => [...of(name).values()] as T[],
    clear: async () => records.clear(),
  };
  return store;
}

/** Fresh module instance — the index and payloads live in module state */
async function freshCache(store?: CacheStore) {
  vi.resetModules();
  const adapter = await import('./cacheStore');
  adapter.setCacheStoreFactory(store ? async () => store : null);
  return await import('./stationsCache');
}

describe('stationsCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The fixtures below stamp tiny epoch times (42, 1_000…): pin the clock
    // near them so the hard age ceiling doesn't filter every entry out.
    vi.setSystemTime(100_000);
    installStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not touch the store on the write itself, and reads back from memory', async () => {
    const store = spyStore();
    const { writeStationsCache, readStationsCache } = await freshCache(store);

    writeStationsCache('fra', CENTER, 30, [station('a')], 1_000);

    expect(store.puts).toBe(0);
    // The area is usable right away, without waiting for the flush
    const hit = await readStationsCache('fra', CENTER, 5);
    expect(hit?.stations.map((s) => s.id)).toEqual(['a']);
    expect(hit?.covers).toBe(true);
  });

  it('flushes one record per store once the main thread is free', async () => {
    const store = spyStore();
    const { writeStationsCache } = await freshCache(store);

    writeStationsCache('fra', CENTER, 30, [station('a')], 1_000);
    await vi.runAllTimersAsync();

    // One area record + one payload record, not a re-serialized blob
    expect(store.puts).toBe(2);
    expect(store.records.get('areas')?.size).toBe(1);
    const payloads = [...(store.records.get('payloads')?.values() ?? [])] as Station[][];
    expect(payloads[0]?.[0]?.id).toBe('a');
  });

  it('coalesces a burst of writes into a single flush', async () => {
    const store = spyStore();
    const { writeStationsCache } = await freshCache(store);

    // A pan fires loadStations repeatedly as the search area moves
    for (let i = 0; i < 5; i++) {
      writeStationsCache('fra', { lat: 43.6 + i, lng: 1.44 }, 30, [station(`s${i}`)], 1_000 + i);
    }
    await vi.runAllTimersAsync();

    expect(store.records.get('areas')?.size).toBe(5);
    expect(store.puts).toBe(10); // 5 areas × (metadata + payload), written once each
  });

  it('hydrates the index eagerly and reads a payload only when an area matches', async () => {
    const store = spyStore();
    const first = await freshCache(store);
    first.writeStationsCache('fra', CENTER, 30, [station('a')], 1_000);
    await first.flushStationsCache();

    // A reload: same store, fresh module state
    const reloaded = await freshCache(store);
    await reloaded.ready();
    expect(store.payloadReads).toBe(0);

    // A zone nowhere near the cached area must not deserialize it either
    expect(await reloaded.readStationsCache('fra', PARIS, 5)).toBeNull();
    expect(store.payloadReads).toBe(0);

    const hit = await reloaded.readStationsCache('fra', CENTER, 5);
    expect(hit?.stations.map((s) => s.id)).toEqual(['a']);
    expect(hit?.fetchedAt).toBe(1_000);
    expect(store.payloadReads).toBe(1);
    // Loaded once, then held for the session
    await reloaded.readStationsCache('fra', CENTER, 5);
    expect(store.payloadReads).toBe(1);
  });

  it('reports a near-but-not-covering area as a hit that still needs a fetch', async () => {
    const { writeStationsCache, readStationsCache } = await freshCache(spyStore());

    writeStationsCache('fra', CENTER, 10, [station('a')], 1_000);

    // A 12 km zone around the same center reaches outside the fetched circle
    const hit = await readStationsCache('fra', CENTER, 12);
    expect(hit?.covers).toBe(false);
    expect(hit?.stations.map((s) => s.id)).toEqual(['a']);
  });

  it('replaces the area of the same source at the same place, keeps the others', async () => {
    const store = spyStore();
    const { writeStationsCache, readStationsCache, flushStationsCache } =
      await freshCache(store);

    writeStationsCache('fra', PARIS, 30, [station('paris')], 1_000);
    writeStationsCache('fra', CENTER, 30, [station('v1')], 1_000);
    writeStationsCache('fra', CENTER, 30, [station('v2')], 2_000);
    await flushStationsCache();

    expect((await readStationsCache('fra', CENTER, 5))?.stations.map((s) => s.id)).toEqual(['v2']);
    expect((await readStationsCache('fra', PARIS, 5))?.stations.map((s) => s.id)).toEqual([
      'paris',
    ]);
    expect(store.records.get('areas')?.size).toBe(2);
  });

  it('never paints an area older than the hard ceiling', async () => {
    const { writeStationsCache, readStationsCache, MAX_CACHE_AGE_MS } =
      await freshCache(spyStore());
    vi.setSystemTime(MAX_CACHE_AGE_MS + 100_000);

    writeStationsCache('fra', CENTER, 30, [station('ancient')], 50_000);
    writeStationsCache('fra', PARIS, 30, [station('fresh')], Date.now() - 1_000);

    // Neither the containment hit nor the proximity hit may serve it
    expect(await readStationsCache('fra', CENTER, 5)).toBeNull();
    expect((await readStationsCache('fra', PARIS, 5))?.stations.map((s) => s.id)).toEqual([
      'fresh',
    ]);
  });

  it('drops an expired area on hydration instead of carrying it', async () => {
    const store = spyStore();
    const first = await freshCache(store);
    first.writeStationsCache('fra', CENTER, 30, [station('old')], Date.now());
    await first.flushStationsCache();

    vi.setSystemTime(Date.now() + first.MAX_CACHE_AGE_MS + 60_000);
    const reloaded = await freshCache(store);
    await reloaded.ready();
    await vi.runAllTimersAsync();

    expect(await reloaded.readStationsCache('fra', CENTER, 5)).toBeNull();
    expect(store.records.get('areas')?.size).toBe(0);
    expect(store.records.get('payloads')?.size).toBe(0);
  });

  it('keeps the newest areas only, evicting by fetch time', async () => {
    const store = spyStore();
    const { writeStationsCache, readStationsCache, flushStationsCache, cacheStats } =
      await freshCache(store);

    // 10 distinct zones, oldest first — far enough apart to never merge
    for (let i = 0; i < 10; i++) {
      writeStationsCache('fra', { lat: 43.6 + i, lng: 1.44 }, 30, [station(`z${i}`)], 1_000 + i);
    }
    await flushStationsCache();

    const stats = await cacheStats();
    expect(stats.areas).toBe(6);
    expect(store.records.get('areas')?.size).toBe(6);
    expect(store.records.get('payloads')?.size).toBe(6);
    // The four oldest zones are gone, the six newest are still there
    expect(await readStationsCache('fra', { lat: 43.6, lng: 1.44 }, 5)).toBeNull();
    expect(await readStationsCache('fra', { lat: 43.6 + 9, lng: 1.44 }, 5)).not.toBeNull();
  });

  it('sheds the oldest area when the origin is full, then the write lands', async () => {
    const store = spyStore();
    const { writeStationsCache, readStationsCache, flushStationsCache, cacheStats } =
      await freshCache(store);

    writeStationsCache('fra', PARIS, 30, [station('old')], 1_000);
    await flushStationsCache();
    store.failPuts = 1;
    writeStationsCache('fra', CENTER, 30, [station('new')], 2_000);
    await flushStationsCache();

    expect((await cacheStats()).durable).toBe(true);
    expect((await readStationsCache('fra', CENTER, 5))?.stations.map((s) => s.id)).toEqual(['new']);
    expect(await readStationsCache('fra', PARIS, 5)).toBeNull();
    expect(store.records.get('areas')?.size).toBe(1);
  });

  it('stops persisting after a second quota failure, without throwing', async () => {
    const store = spyStore();
    const { writeStationsCache, readStationsCache, flushStationsCache, cacheStats } =
      await freshCache(store);

    store.failPuts = Number.MAX_SAFE_INTEGER;
    writeStationsCache('fra', CENTER, 30, [station('a')], 1_000);
    await expect(flushStationsCache()).resolves.toBeUndefined();

    const stats = await cacheStats();
    expect(stats.durable).toBe(false);
    expect(stats.areas).toBe(1);
    // The session keeps its in-memory cache; nothing else is attempted
    expect((await readStationsCache('fra', CENTER, 5))?.stations.map((s) => s.id)).toEqual(['a']);
    store.failPuts = 0;
    writeStationsCache('fra', PARIS, 30, [station('b')], 2_000);
    await flushStationsCache();
    expect(store.puts).toBe(0);
  });

  it('imports the last localStorage blob, then removes every legacy key', async () => {
    const storage = installStorage();
    storage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        {
          source: 'fra',
          center: CENTER,
          fetchRadiusKm: 30,
          fetchedAt: 42,
          stations: [station('legacy')],
        },
      ]),
    );
    // Superseded generations: dead weight, never adopted (their entries
    // predate the `fra-` id prefix and the `adBlue` tag respectively)
    storage.setItem('plein.stations.cache.v1', '[]');
    storage.setItem(
      'plein.stations.cache.v2',
      JSON.stringify([
        { source: 'fra', center: PARIS, fetchRadiusKm: 30, fetchedAt: 42, stations: [station('older')] },
      ]),
    );
    const store = spyStore();
    const { readStationsCache, flushStationsCache } = await freshCache(store);

    const hit = await readStationsCache('fra', CENTER, 5);

    expect(hit?.stations.map((s) => s.id)).toEqual(['legacy']);
    expect(hit?.fetchedAt).toBe(42);
    expect(await readStationsCache('fra', PARIS, 5)).toBeNull();
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
    expect(storage.getItem('plein.stations.cache.v1')).toBeNull();
    expect(storage.getItem('plein.stations.cache.v2')).toBeNull();
    // The imported area is durable from now on
    await flushStationsCache();
    expect(store.records.get('areas')?.size).toBe(1);
  });

  it('ignores a legacy blob that is corrupt, and still cleans the key up', async () => {
    const storage = installStorage();
    storage.setItem(LEGACY_KEY, '{not json');
    const { readStationsCache } = await freshCache(spyStore());

    expect(await readStationsCache('fra', CENTER, 5)).toBeNull();
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('behaves as before minus persistence when no store can be opened', async () => {
    const { writeStationsCache, readStationsCache, flushStationsCache, cacheStats } =
      await freshCache();

    writeStationsCache('fra', CENTER, 30, [station('a')], 1_000);
    await expect(flushStationsCache()).resolves.toBeUndefined();

    const hit = await readStationsCache('fra', CENTER, 5);
    expect(hit?.stations.map((s) => s.id)).toEqual(['a']);
    expect((await cacheStats()).durable).toBe(false);
  });

  it('reports what is cached, and clears it on demand', async () => {
    const store = spyStore();
    const { writeStationsCache, readStationsCache, flushStationsCache, cacheStats, clearStationsCache } =
      await freshCache(store);

    writeStationsCache('fra', CENTER, 30, [station('a'), station('b')], 1_000);
    writeStationsCache('fra', PARIS, 30, [station('c')], 2_000);
    await flushStationsCache();

    const before = await cacheStats();
    expect(before.areas).toBe(2);
    expect(before.bytes).toBeGreaterThan(0);
    expect(before.oldestFetchedAt).toBe(1_000);
    expect(before.durable).toBe(true);

    await clearStationsCache();

    const after = await cacheStats();
    expect(after).toEqual({ areas: 0, bytes: 0, oldestFetchedAt: null, durable: true });
    expect(await readStationsCache('fra', CENTER, 5)).toBeNull();
    expect(store.records.get('areas')?.size ?? 0).toBe(0);
  });

  it('does not let hydration restore an area over a fresher one just fetched', async () => {
    const store = spyStore();
    const first = await freshCache(store);
    first.writeStationsCache('fra', CENTER, 30, [station('old')], 1_000);
    await first.flushStationsCache();

    // A fetch that lands before anything read the cache: the store only opens
    // on this write's flush, and hydration must not undo it.
    const second = await freshCache(store);
    second.writeStationsCache('fra', CENTER, 30, [station('new')], 5_000);
    await second.flushStationsCache();

    const hit = await second.readStationsCache('fra', CENTER, 5);
    expect(hit?.stations.map((s) => s.id)).toEqual(['new']);
    expect(hit?.fetchedAt).toBe(5_000);
    expect(store.records.get('areas')?.size).toBe(1);
  });

  it('forgets an area whose payload disappeared under it', async () => {
    const store = spyStore();
    const first = await freshCache(store);
    first.writeStationsCache('fra', CENTER, 30, [station('a')], 1_000);
    await first.flushStationsCache();
    // The browser evicted the payload but left the index behind
    store.records.get('payloads')?.clear();

    const reloaded = await freshCache(store);

    expect(await reloaded.readStationsCache('fra', CENTER, 5)).toBeNull();
    await vi.runAllTimersAsync();
    expect(store.records.get('areas')?.size).toBe(0);
  });
});

describe('freshnessLevel', () => {
  const NOW = 1_000_000_000;

  it('says nothing about data that was just fetched', () => {
    expect(freshnessLevel(NOW - 1_000, false, NOW)).toBe('fresh');
    expect(freshnessLevel(NOW - STALE_MS, false, NOW)).toBe('fresh');
  });

  it('names the age once the data is past the staleness window', () => {
    expect(freshnessLevel(NOW - STALE_MS - 1, false, NOW)).toBe('stale');
  });

  it('owns up to a failed refresh rather than reporting a reassuring age', () => {
    // « à l'instant » under a banner saying the source is down is the exact
    // contradiction this level exists to prevent
    expect(freshnessLevel(NOW - 1_000, true, NOW)).toBe('unrefreshed');
    expect(freshnessLevel(NOW - STALE_MS - 1, true, NOW)).toBe('unrefreshed');
  });

  it('names the day past the revalidation window, failing or not', () => {
    expect(freshnessLevel(NOW - REVALIDATE_MS - 1, false, NOW)).toBe('dated');
    // The date outranks the failure: at that age the failure is implied
    expect(freshnessLevel(NOW - REVALIDATE_MS - 1, true, NOW)).toBe('dated');
  });

  it('has nothing to say without a fetch time', () => {
    expect(freshnessLevel(undefined, true, NOW)).toBe('fresh');
  });
});
