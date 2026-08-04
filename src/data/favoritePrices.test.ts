import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CacheStore, StoreName } from './cacheStore';
import type { Station } from './types';

function station(id: string, diesel = 1.75): Station {
  return {
    id,
    name: `Station ${id}`,
    init: 'ST',
    lat: 43.6,
    lng: 1.44,
    address: '1 rue du Test',
    city: 'Toulouse',
    prices: { diesel: { value: diesel, updatedAt: '2026-08-01T00:00:00.000Z' } },
    tags: [],
    services: [],
    highway: false,
  };
}

function memoryStore(): CacheStore & { records: Map<StoreName, Map<string, unknown>> } {
  const records = new Map<StoreName, Map<string, unknown>>();
  const of = (name: StoreName) => {
    let bucket = records.get(name);
    if (!bucket) {
      bucket = new Map();
      records.set(name, bucket);
    }
    return bucket;
  };
  return {
    records,
    durable: true,
    get: async <T>(name: StoreName, key: string) => of(name).get(key) as T | undefined,
    put: async (name, key, value) => void of(name).set(key, value),
    delete: async (name, key) => void of(name).delete(key),
    list: async <T>(name: StoreName) => [...of(name).values()] as T[],
    clear: async () => records.clear(),
  };
}

/** Fresh module instance — the entries live in module state */
async function freshModule(store?: CacheStore) {
  vi.resetModules();
  const adapter = await import('./cacheStore');
  adapter.setCacheStoreFactory(store ? async () => store : null);
  return await import('./favoritePrices');
}

describe('favoritePrices store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records only starred stations, readable without waiting on the store', async () => {
    const { recordFavoritePrices, readFavoritePrices } = await freshModule(memoryStore());

    recordFavoritePrices(new Set(['fr-1']), [station('fr-1'), station('fr-2')], 1_000);

    const entries = await readFavoritePrices(['fr-1', 'fr-2']);
    expect([...entries.keys()]).toEqual(['fr-1']);
    expect(entries.get('fr-1')?.prices.diesel?.value).toBe(1.75);
    expect(entries.get('fr-1')?.fetchedAt).toBe(1_000);
  });

  it('flushes one record per favorite and survives a reload', async () => {
    const store = memoryStore();
    const first = await freshModule(store);
    first.recordFavoritePrices(new Set(['es-9']), [station('es-9', 1.52)], 2_000);
    await vi.runAllTimersAsync();

    expect(store.records.get('favoritePrices')?.size).toBe(1);

    const reloaded = await freshModule(store);
    const entries = await reloaded.readFavoritePrices(['es-9']);
    expect(entries.get('es-9')?.prices.diesel?.value).toBe(1.52);
    expect(entries.get('es-9')?.fetchedAt).toBe(2_000);
  });

  it('never lets an older fetch overwrite a newer price', async () => {
    const { recordFavoritePrices, readFavoritePrices } = await freshModule(memoryStore());

    recordFavoritePrices(new Set(['fr-1']), [station('fr-1', 1.8)], 5_000);
    recordFavoritePrices(new Set(['fr-1']), [station('fr-1', 1.6)], 3_000);

    const entries = await readFavoritePrices(['fr-1']);
    expect(entries.get('fr-1')?.prices.diesel?.value).toBe(1.8);
    expect(entries.get('fr-1')?.fetchedAt).toBe(5_000);
  });

  it('drops an entry past the hard age ceiling instead of painting it', async () => {
    const mod = await freshModule(memoryStore());
    const { MAX_CACHE_AGE_MS } = await import('./stationsCache');

    mod.recordFavoritePrices(new Set(['fr-1']), [station('fr-1')], 50_000);
    vi.setSystemTime(50_000 + MAX_CACHE_AGE_MS + 1);

    const entries = await mod.readFavoritePrices(['fr-1']);
    expect(entries.size).toBe(0);
  });

  it('prunes entries for stations no longer starred', async () => {
    const store = memoryStore();
    const mod = await freshModule(store);

    mod.recordFavoritePrices(new Set(['fr-1', 'fr-2']), [station('fr-1'), station('fr-2')], 1_000);
    mod.pruneFavoritePrices(new Set(['fr-2']));
    await vi.runAllTimersAsync();

    const entries = await mod.readFavoritePrices(['fr-1', 'fr-2']);
    expect([...entries.keys()]).toEqual(['fr-2']);
    expect(store.records.get('favoritePrices')?.has('fr-1')).toBe(false);
  });

  it('clears everything, memory and records alike', async () => {
    const store = memoryStore();
    const mod = await freshModule(store);

    mod.recordFavoritePrices(new Set(['fr-1']), [station('fr-1')], 1_000);
    await vi.runAllTimersAsync();
    await mod.clearFavoritePrices();

    expect((await mod.readFavoritePrices(['fr-1'])).size).toBe(0);
    expect(store.records.get('favoritePrices')?.size ?? 0).toBe(0);
  });
});

describe('planFavoriteRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const fav = (id: string, lat: number, lng: number) => ({ id, lat, lng });

  async function plan() {
    const mod = await freshModule();
    const { STALE_MS } = await import('./stationsCache');
    return { ...mod, STALE_MS };
  }

  it('issues nothing when every entry is fresh', async () => {
    const { planFavoriteRefresh, STALE_MS } = await plan();
    const now = STALE_MS * 10;
    const entries = new Map([['fr-1', { fetchedAt: now - STALE_MS / 2 }]]);
    expect(planFavoriteRefresh([fav('fr-1', 43.6, 1.44)], entries, { now })).toEqual([]);
  });

  it('groups stale favorites by country, close ones sharing one fetch', async () => {
    const { planFavoriteRefresh } = await plan();
    const groups = planFavoriteRefresh(
      [
        fav('fr-1', 43.6, 1.44),
        fav('fr-2', 43.62, 1.45), // ~2 km from fr-1 — same group
        fav('fr-3', 48.85, 2.35), // Paris — its own group
        fav('es-1', 43.61, 1.44), // same place as fr-1 but another source
      ],
      new Map(),
      { now: 100_000 },
    );
    expect(groups.map((g) => [g.country, [...g.ids].sort()])).toEqual([
      ['fr', ['fr-1', 'fr-2']],
      ['fr', ['fr-3']],
      ['es', ['es-1']],
    ]);
  });

  it('merges a by-id country into one request however far apart its favorites sit', async () => {
    const { planFavoriteRefresh } = await plan();
    const groups = planFavoriteRefresh(
      [
        fav('fr-1', 43.6, 1.44), // Toulouse
        fav('fr-2', 48.85, 2.35), // Paris — same group anyway: fr answers by id
        fav('es-1', 41.4, 2.1), // Barcelona
        fav('es-2', 40.4, -3.7), // Madrid — its own circle, es stays geographic
      ],
      new Map(),
      { now: 100_000, byIdCountries: new Set(['fr' as const]) },
    );
    expect(groups.map((g) => [g.country, [...g.ids].sort()])).toEqual([
      ['fr', ['fr-1', 'fr-2']],
      ['es', ['es-1']],
      ['es', ['es-2']],
    ]);
  });

  it('never fetches ids outside the country scheme (demo)', async () => {
    const { planFavoriteRefresh } = await plan();
    expect(planFavoriteRefresh([fav('su', 43.6, 1.44)], new Map(), { now: 100_000 })).toEqual([]);
  });

  it('puts never-priced favorites ahead of merely stale ones', async () => {
    const { planFavoriteRefresh, STALE_MS } = await plan();
    const now = STALE_MS * 10;
    const entries = new Map([['fr-old', { fetchedAt: now - STALE_MS * 2 }]]);
    const groups = planFavoriteRefresh(
      [fav('fr-old', 43.6, 1.44), fav('fr-new', 48.85, 2.35)],
      entries,
      { now },
    );
    expect(groups[0].ids).toEqual(['fr-new']);
    expect(groups[1].ids).toEqual(['fr-old']);
  });

  it('caps the number of fetches per round', async () => {
    const { planFavoriteRefresh, MAX_REFRESH_FETCHES } = await plan();
    // Spread favorites ~110 km apart so none can share a group
    const favorites = Array.from({ length: MAX_REFRESH_FETCHES + 4 }, (_, i) =>
      fav(`fr-${i}`, 42 + i, 1.44),
    );
    const groups = planFavoriteRefresh(favorites, new Map(), { now: 100_000 });
    expect(groups).toHaveLength(MAX_REFRESH_FETCHES);
  });

  it('leaves recently attempted ids alone, station found or not', async () => {
    const { planFavoriteRefresh, STALE_MS } = await plan();
    const now = STALE_MS * 10;
    const attemptedAt = new Map([
      ['fr-1', now - STALE_MS / 2],
      ['fr-2', now - STALE_MS * 2],
    ]);
    const groups = planFavoriteRefresh(
      [fav('fr-1', 43.6, 1.44), fav('fr-2', 48.85, 2.35)],
      new Map(),
      { now, attemptedAt },
    );
    expect(groups.flatMap((g) => g.ids)).toEqual(['fr-2']);
  });
});
