// Bounded, time-limited memo — the memory tier of the cache policy.
//
// For results that are worth not refetching within a session but must never
// outlive it: geocoder suggestions while a query is being retyped, a route
// recomputed after a back-and-forth. They are not app-owned data, they have no
// freshness story of their own, and persisting them would mean answering for
// their age later. A cap plus a TTL is the whole contract.

interface Entry<T> {
  value: T;
  at: number;
}

export class TtlLru<T> {
  // Map iterates in insertion order, so re-inserting on a hit makes the first
  // key the least recently used one.
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, at: Date.now() });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  /** Entries currently held, expired ones included — for tests */
  get size(): number {
    return this.entries.size;
  }
}
