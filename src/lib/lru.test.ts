import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TtlLru } from './lru';

describe('TtlLru', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns what it was given, and nothing for an unknown key', () => {
    const lru = new TtlLru<number>(3, 1_000);
    lru.set('a', 1);

    expect(lru.get('a')).toBe(1);
    expect(lru.get('b')).toBeUndefined();
  });

  it('forgets an entry once its time is up', () => {
    const lru = new TtlLru<number>(3, 1_000);
    lru.set('a', 1);

    vi.setSystemTime(1_001);

    expect(lru.get('a')).toBeUndefined();
    expect(lru.size).toBe(0); // the read sheds it rather than keeping it around
  });

  it('evicts the least recently READ entry, not the oldest one written', () => {
    const lru = new TtlLru<number>(2, 10_000);
    lru.set('a', 1);
    lru.set('b', 2);

    // Touching 'a' makes 'b' the next to go
    expect(lru.get('a')).toBe(1);
    lru.set('c', 3);

    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
    expect(lru.size).toBe(2);
  });

  it('refreshes an entry rewritten under the same key', () => {
    const lru = new TtlLru<number>(2, 1_000);
    lru.set('a', 1);

    vi.setSystemTime(900);
    lru.set('a', 2);
    vi.setSystemTime(1_500);

    expect(lru.get('a')).toBe(2);
  });

  it('drops everything on clear', () => {
    const lru = new TtlLru<number>(2, 1_000);
    lru.set('a', 1);

    lru.clear();

    expect(lru.get('a')).toBeUndefined();
    expect(lru.size).toBe(0);
  });
});
