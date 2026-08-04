import { describe, expect, it } from 'vitest';
import { cacheTier, fmtAgeMs, roundCoord, roundPoint } from './debugSnapshot';
import { MAX_CACHE_AGE_MS, REVALIDATE_MS, STALE_MS } from '../data/stationsCache';

describe('cacheTier', () => {
  const now = 1_700_000_000_000;

  it('is fresh under STALE_MS', () => {
    expect(cacheTier(now, now)).toBe('fresh');
    expect(cacheTier(now - STALE_MS + 1, now)).toBe('fresh');
  });

  it('revalidates between STALE_MS and REVALIDATE_MS', () => {
    expect(cacheTier(now - STALE_MS - 1, now)).toBe('revalidate');
    expect(cacheTier(now - REVALIDATE_MS + 1, now)).toBe('revalidate');
  });

  it('is stale between REVALIDATE_MS and MAX_CACHE_AGE_MS', () => {
    expect(cacheTier(now - REVALIDATE_MS - 1, now)).toBe('stale');
    expect(cacheTier(now - MAX_CACHE_AGE_MS + 1, now)).toBe('stale');
  });

  it('is dropped beyond MAX_CACHE_AGE_MS', () => {
    expect(cacheTier(now - MAX_CACHE_AGE_MS - 1, now)).toBe('dropped');
  });
});

describe('coordinate rounding (privacy grid)', () => {
  it('rounds to 2 decimals — about a kilometre', () => {
    expect(roundCoord(43.60464)).toBe(43.6);
    expect(roundCoord(1.44421)).toBe(1.44);
    expect(roundCoord(-0.567)).toBe(-0.57);
  });

  it('rounds both members of a point', () => {
    expect(roundPoint({ lat: 43.60464, lng: 1.44421 })).toEqual({ lat: 43.6, lng: 1.44 });
  });
});

describe('fmtAgeMs', () => {
  it('names seconds, minutes, hours and days at the right cut-offs', () => {
    expect(fmtAgeMs(0)).toBe('0s');
    expect(fmtAgeMs(41_000)).toBe('41s');
    expect(fmtAgeMs(60_000)).toBe('1m');
    expect(fmtAgeMs(12 * 60_000)).toBe('12m');
    expect(fmtAgeMs(3 * 3_600_000 + 5 * 60_000)).toBe('3h05');
    expect(fmtAgeMs(26 * 3_600_000)).toBe('1d');
  });

  it('never goes negative on clock skew', () => {
    expect(fmtAgeMs(-5_000)).toBe('0s');
  });
});
