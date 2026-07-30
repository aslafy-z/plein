import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createMemoryCacheStore,
  isQuotaError,
  openCacheStore,
  setCacheStoreFactory,
  type CacheStore,
} from './cacheStore';

afterEach(() => {
  setCacheStoreFactory(null);
  vi.unstubAllGlobals();
});

describe('cacheStore — adapter contract', () => {
  it('round-trips values per store and keeps the stores apart', async () => {
    const store = createMemoryCacheStore();

    await store.put('areas', 'k', { fetchedAt: 1 });
    await store.put('payloads', 'k', [{ id: 'a' }]);

    expect(await store.get('areas', 'k')).toEqual({ fetchedAt: 1 });
    expect(await store.get('payloads', 'k')).toEqual([{ id: 'a' }]);
    expect(await store.get('areas', 'missing')).toBeUndefined();
  });

  it('lists a whole store, deletes one key and clears everything', async () => {
    const store = createMemoryCacheStore();
    await store.put('areas', 'a', 1);
    await store.put('areas', 'b', 2);
    await store.put('payloads', 'a', ['x']);

    expect((await store.list<number>('areas')).sort()).toEqual([1, 2]);

    await store.delete('areas', 'a');
    expect(await store.list('areas')).toEqual([2]);
    expect(await store.get('payloads', 'a')).toEqual(['x']);

    await store.clear();
    expect(await store.list('areas')).toEqual([]);
    expect(await store.list('payloads')).toEqual([]);
  });

  it('says outright that the memory fallback survives nothing', () => {
    expect(createMemoryCacheStore().durable).toBe(false);
  });
});

describe('cacheStore — opening', () => {
  it('falls back to memory when the environment has no IndexedDB', async () => {
    const store = await openCacheStore();
    expect(store.durable).toBe(false);
  });

  it('opens once and hands the same store to every caller', async () => {
    let opens = 0;
    setCacheStoreFactory(async () => {
      opens += 1;
      return createMemoryCacheStore();
    });

    const [a, b] = await Promise.all([openCacheStore(), openCacheStore()]);

    expect(opens).toBe(1);
    expect(a).toBe(b);
  });

  it('never rejects — a store that fails to open degrades to memory', async () => {
    setCacheStoreFactory(async () => {
      throw new Error('private browsing');
    });

    const store: CacheStore = await openCacheStore();

    expect(store.durable).toBe(false);
    await expect(store.put('areas', 'k', 1)).resolves.toBeUndefined();
  });
});

describe('cacheStore — quota detection', () => {
  it('recognizes both names browsers use for a full origin', () => {
    const quota = new Error('full');
    quota.name = 'QuotaExceededError';
    const firefox = new Error('full');
    firefox.name = 'NS_ERROR_DOM_QUOTA_REACHED';

    expect(isQuotaError(quota)).toBe(true);
    expect(isQuotaError(firefox)).toBe(true);
  });

  it('does not mistake an ordinary failure for a full origin', () => {
    expect(isQuotaError(new Error('boom'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError('QuotaExceededError')).toBe(false);
  });
});
