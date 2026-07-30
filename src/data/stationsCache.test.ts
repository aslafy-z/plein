import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GeoPoint } from '../lib/geo';
import type { Station } from './types';

const LS_KEY = 'plein.stations.cache.v3';
const CENTER: GeoPoint = { lat: 43.6045, lng: 1.4442 };

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

/** localStorage stub counting the writes the cache actually performs */
function installStorage() {
  const store = new Map<string, string>();
  const stub = {
    writes: 0,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      stub.writes++;
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal('localStorage', stub);
  return stub;
}

/** Fresh module instance — the parsed areas live in module state */
async function freshCache() {
  vi.resetModules();
  return await import('./stationsCache');
}

describe('stationsCache', () => {
  let storage: ReturnType<typeof installStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    // The fixtures below stamp tiny epoch times (42, 1_000…): pin the clock
    // near them so the hard age ceiling doesn't filter every entry out.
    vi.setSystemTime(100_000);
    storage = installStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not serialize on the write itself, and reads back from memory', async () => {
    const { writeStationsCache, readStationsCache } = await freshCache();

    writeStationsCache('fra', CENTER, 30, [station('a')], 1_000);

    expect(storage.writes).toBe(0);
    expect(storage.getItem(LS_KEY)).toBeNull();
    // The area is usable right away, without waiting for the flush
    const hit = readStationsCache('fra', CENTER, 5);
    expect(hit?.stations.map((s) => s.id)).toEqual(['a']);
    expect(hit?.covers).toBe(true);
  });

  it('flushes to localStorage once the main thread is free', async () => {
    const { writeStationsCache } = await freshCache();

    writeStationsCache('fra', CENTER, 30, [station('a')], 1_000);
    await vi.runAllTimersAsync();

    expect(storage.writes).toBe(1);
    const blob = JSON.parse(storage.getItem(LS_KEY) as string);
    expect(blob).toHaveLength(1);
    expect(blob[0].stations[0].id).toBe('a');
  });

  it('coalesces a burst of writes into a single serialization', async () => {
    const { writeStationsCache } = await freshCache();

    // A pan fires loadStations repeatedly as the search area moves
    for (let i = 0; i < 5; i++) {
      writeStationsCache('fra', { lat: 43.6 + i, lng: 1.44 }, 30, [station(`s${i}`)], 1_000 + i);
    }
    await vi.runAllTimersAsync();

    expect(storage.writes).toBe(1);
    const blob = JSON.parse(storage.getItem(LS_KEY) as string);
    // Newest area first, capped at MAX_AREAS
    expect(blob).toHaveLength(4);
    expect(blob[0].stations[0].id).toBe('s4');
  });

  it('flushStationsCache writes out immediately, then stays a no-op', async () => {
    const { writeStationsCache, flushStationsCache } = await freshCache();

    writeStationsCache('fra', CENTER, 30, [station('a')], 1_000);
    flushStationsCache();

    expect(storage.writes).toBe(1);
    flushStationsCache();
    expect(storage.writes).toBe(1);
    // The queued callback must not write a second time either
    await vi.runAllTimersAsync();
    expect(storage.writes).toBe(1);
  });

  it('still reads an area persisted by a previous session', async () => {
    storage.setItem(
      LS_KEY,
      JSON.stringify([
        { source: 'fra', center: CENTER, fetchRadiusKm: 30, fetchedAt: 42, stations: [station('old')] },
      ]),
    );
    const { readStationsCache } = await freshCache();

    const hit = readStationsCache('fra', CENTER, 5);
    expect(hit?.stations.map((s) => s.id)).toEqual(['old']);
    expect(hit?.fetchedAt).toBe(42);
  });

  it('replaces the area of the same source at the same place, keeps the others', async () => {
    const { writeStationsCache, readStationsCache } = await freshCache();
    const far: GeoPoint = { lat: 48.8566, lng: 2.3522 };

    writeStationsCache('fra', far, 30, [station('paris')], 1_000);
    writeStationsCache('fra', CENTER, 30, [station('v1')], 1_000);
    writeStationsCache('fra', CENTER, 30, [station('v2')], 2_000);
    await vi.runAllTimersAsync();

    expect(readStationsCache('fra', CENTER, 5)?.stations.map((s) => s.id)).toEqual(['v2']);
    expect(readStationsCache('fra', far, 5)?.stations.map((s) => s.id)).toEqual(['paris']);
    expect(JSON.parse(storage.getItem(LS_KEY) as string)).toHaveLength(2);
  });

  it('never paints an area older than the hard ceiling', async () => {
    const { writeStationsCache, readStationsCache, MAX_CACHE_AGE_MS } = await freshCache();
    const far: GeoPoint = { lat: 48.8566, lng: 2.3522 };
    vi.setSystemTime(MAX_CACHE_AGE_MS + 100_000);

    writeStationsCache('fra', CENTER, 30, [station('ancient')], 50_000);
    writeStationsCache('fra', far, 30, [station('fresh')], Date.now() - 1_000);

    // Neither the containment hit nor the proximity hit may serve it
    expect(readStationsCache('fra', CENTER, 5)).toBeNull();
    expect(readStationsCache('fra', far, 5)?.stations.map((s) => s.id)).toEqual(['fresh']);
  });

  it('survives a storage that throws (quota / private mode)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    const { writeStationsCache, readStationsCache, flushStationsCache } = await freshCache();

    expect(() => writeStationsCache('fra', CENTER, 30, [station('a')], 1_000)).not.toThrow();
    expect(() => flushStationsCache()).not.toThrow();
    expect(readStationsCache('fra', CENTER, 5)?.stations.map((s) => s.id)).toEqual(['a']);
  });
});
