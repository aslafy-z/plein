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

  it('writes several records across stores in one call', async () => {
    const store = createMemoryCacheStore();

    await store.putAll([
      { store: 'payloads', key: 'k', value: ['x'] },
      { store: 'areas', key: 'k', value: { fetchedAt: 1 } },
    ]);

    expect(await store.get('payloads', 'k')).toEqual(['x']);
    expect(await store.get('areas', 'k')).toEqual({ fetchedAt: 1 });
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

/**
 * The least IndexedDB the adapter needs to open and write. Node has none, and
 * what is under test is how a failing transaction's events are read — so
 * `failWith` replays the real order: the request's `error` event bubbles to
 * the transaction while `tx.error` is still null, then the abort sets it.
 */
function installFakeIndexedDb(failWith: { requestError: Error; abortError: Error | null } | null) {
  const transactions: string[][] = [];
  const db = {
    objectStoreNames: { contains: () => true },
    close: () => {},
    transaction: (names: string[]) => {
      transactions.push(names);
      const tx: {
        error: Error | null;
        oncomplete: (() => void) | null;
        onerror: ((event: { target: { error: Error } }) => void) | null;
        onabort: (() => void) | null;
        objectStore: () => { put: () => void };
        abort: () => void;
      } = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => ({ put: () => {} }),
        abort: () => {},
      };
      queueMicrotask(() => {
        if (!failWith) {
          tx.oncomplete?.();
          return;
        }
        tx.onerror?.({ target: { error: failWith.requestError } });
        tx.error = failWith.abortError;
        tx.onabort?.();
      });
      return tx;
    },
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req: { result: typeof db; onsuccess: (() => void) | null } = {
        result: db,
        onsuccess: null,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  });
  return transactions;
}

function quotaError(): Error {
  const err = new Error('the origin is full');
  err.name = 'QuotaExceededError';
  return err;
}

describe('cacheStore — IndexedDB transactions', () => {
  it('keeps the quota identity of a request failure that aborts the transaction', async () => {
    const quota = quotaError();
    installFakeIndexedDb({ requestError: quota, abortError: quota });
    const store = await openCacheStore();
    expect(store.durable).toBe(true);

    const failure = await store.put('payloads', 'k', ['x']).catch((err: unknown) => err);

    expect(failure).toBe(quota);
    expect(isQuotaError(failure)).toBe(true);
  });

  it('falls back to the request error when the abort carries none', async () => {
    const quota = quotaError();
    installFakeIndexedDb({ requestError: quota, abortError: null });
    const store = await openCacheStore();

    const failure = await store.put('payloads', 'k', ['x']).catch((err: unknown) => err);

    expect(isQuotaError(failure)).toBe(true);
  });

  it('opens a single transaction over every store a multi-record write touches', async () => {
    const transactions = installFakeIndexedDb(null);
    const store = await openCacheStore();

    await store.putAll([
      { store: 'payloads', key: 'k', value: ['x'] },
      { store: 'areas', key: 'k', value: { fetchedAt: 1 } },
    ]);

    expect(transactions).toEqual([['payloads', 'areas']]);
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
