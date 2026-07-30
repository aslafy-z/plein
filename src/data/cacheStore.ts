// Async key/value adapter under the durable domain cache.
//
// IndexedDB when the browser gives us one, an in-memory map otherwise — a
// Firefox private window, a Safari refusal, an `open()` another tab keeps
// blocked, or the node environment the unit suite runs in. Callers never
// branch on which they got: they read `durable` when they have to TELL the
// user whether anything survives a reload, and otherwise treat the store as
// best-effort. A rejected write is a cache miss later, never an error on
// screen.
//
// Why not localStorage: one record per area means a refresh rewrites that
// area alone instead of re-serializing every cached area; structured clone
// replaces `JSON.stringify`; a transaction either lands whole or not at all,
// so a tab dying mid-write cannot leave a torn record; and the origin quota
// is a share of the disk rather than the ~5 MB budget the settings blob
// already lives in.

export type StoreName = 'areas' | 'payloads';

const STORE_NAMES: readonly StoreName[] = ['areas', 'payloads'];

export interface CacheStore {
  /** false when nothing written here survives a reload */
  readonly durable: boolean;
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  /** Every value of a store — meant for the small `areas` index, not payloads */
  list<T>(store: StoreName): Promise<T[]>;
  /** Drops every store's contents */
  clear(): Promise<void>;
}

const DB_NAME = 'plein.cache';
const DB_VERSION = 1;
/**
 * An `open()` can be held indefinitely by another tab still on an older
 * version (`onblocked`), and a hostile storage policy can leave it pending.
 * Boot waits on this store, so it gets a deadline and falls back to memory.
 */
const OPEN_TIMEOUT_MS = 3_000;

/** The write failed because the origin is out of room, not because it is broken. */
export function isQuotaError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('name' in err)) return false;
  const name = (err as { name: unknown }).name;
  // Firefox reports its own legacy name for the same condition
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

export function createMemoryCacheStore(): CacheStore {
  const stores = new Map<StoreName, Map<string, unknown>>();
  const of = (name: StoreName): Map<string, unknown> => {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    return store;
  };
  return {
    durable: false,
    get: async <T>(name: StoreName, key: string) => of(name).get(key) as T | undefined,
    put: async (name, key, value) => void of(name).set(key, value),
    delete: async (name, key) => void of(name).delete(key),
    list: async <T>(name: StoreName) => [...of(name).values()] as T[],
    clear: async () => stores.clear(),
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Runs a write inside one transaction and settles on the TRANSACTION, not on
 * the request: a quota failure aborts the transaction, and only `onabort`
 * carries the `QuotaExceededError` the caller has to recognize.
 */
function transact(
  db: IDBDatabase,
  names: StoreName[],
  run: (tx: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(names, 'readwrite');
    } catch (err) {
      reject(err instanceof Error ? err : new Error('IndexedDB transaction failed'));
      return;
    }
    tx.oncomplete = () => resolve();
    const fail = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onerror = fail;
    tx.onabort = fail;
    try {
      run(tx);
    } catch (err) {
      // A synchronous throw leaves the transaction to time out on its own
      try {
        tx.abort();
      } catch {
        /* already aborting */
      }
      reject(err instanceof Error ? err : new Error('IndexedDB write failed'));
    }
  });
}

function openDb(): Promise<IDBDatabase | null> {
  const idb: IDBFactory | undefined = globalThis.indexedDB;
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => settle(null), OPEN_TIMEOUT_MS);
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch {
      settle(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A later build upgrading in another tab must not be blocked by us
      db.onversionchange = () => db.close();
      settle(db);
    };
    req.onerror = () => settle(null);
    // Another tab holds an older version open: fall back rather than wait
    req.onblocked = () => settle(null);
  });
}

function wrapDb(db: IDBDatabase): CacheStore {
  return {
    durable: true,
    get: <T>(name: StoreName, key: string) =>
      request<T | undefined>(
        db.transaction(name).objectStore(name).get(key) as IDBRequest<T | undefined>,
      ),
    put: (name, key, value) =>
      transact(db, [name], (tx) => void tx.objectStore(name).put(value, key)),
    delete: (name, key) => transact(db, [name], (tx) => void tx.objectStore(name).delete(key)),
    list: <T>(name: StoreName) =>
      request<T[]>(db.transaction(name).objectStore(name).getAll() as IDBRequest<T[]>),
    clear: () =>
      transact(db, [...STORE_NAMES], (tx) => {
        for (const name of STORE_NAMES) tx.objectStore(name).clear();
      }),
  };
}

async function openDefault(): Promise<CacheStore> {
  const db = await openDb();
  if (!db) return createMemoryCacheStore();
  try {
    // A database that exists without our stores (an interrupted upgrade) would
    // throw on every call — better to notice here, once.
    for (const name of STORE_NAMES) {
      if (!db.objectStoreNames.contains(name)) {
        db.close();
        return createMemoryCacheStore();
      }
    }
    return wrapDb(db);
  } catch {
    db.close();
    return createMemoryCacheStore();
  }
}

let factory: (() => Promise<CacheStore>) | null = null;
let opened: Promise<CacheStore> | null = null;

/**
 * Injection seam for the store the app opens. The unit suite runs in node,
 * where there is no IndexedDB to fail a write with a quota error or to block
 * an open, so those paths are exercised through a substitute here.
 */
export function setCacheStoreFactory(next: (() => Promise<CacheStore>) | null): void {
  factory = next;
  opened = null;
}

/** The process-wide store, opened once. Never rejects. */
export function openCacheStore(): Promise<CacheStore> {
  opened ??= (factory ?? openDefault)().catch(() => createMemoryCacheStore());
  return opened;
}
