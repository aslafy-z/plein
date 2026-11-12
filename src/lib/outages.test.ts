import { describe, expect, it } from 'vitest';
import { DORMANT_MS, dormantSince, fuelOutage, isLiveOutage, outageStart } from './outages';

const NOW = Date.parse('2026-11-07T18:00:00Z');
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('fuelOutage', () => {
  it('returns the outage of an unpriced fuel', () => {
    const o = { since: iso(NOW - HOUR) };
    expect(fuelOutage({ prices: {}, outages: { diesel: o } }, 'diesel')).toBe(o);
  });

  it('lets a price win, and knows nothing without outages', () => {
    expect(
      fuelOutage({ prices: { diesel: { value: 1.8 } }, outages: { diesel: {} } }, 'diesel'),
    ).toBeNull();
    expect(fuelOutage({ prices: {} }, 'diesel')).toBeNull();
    expect(fuelOutage({ prices: {}, outages: { e10: {} } }, 'diesel')).toBeNull();
  });
});

describe('dormantSince', () => {
  it('flags a station out of everything for more than a week', () => {
    const last = NOW - DORMANT_MS - HOUR;
    const s = {
      prices: {},
      outages: { diesel: { since: iso(last) }, e10: { since: iso(last - 30 * 24 * HOUR) } },
    };
    expect(dormantSince(s, NOW)).toBe(last);
    expect(isLiveOutage(s, 'diesel', NOW)).toBe(false);
  });

  it('keeps a recent shortage live, even when every fuel is out', () => {
    const s = {
      prices: {},
      outages: {
        diesel: { since: iso(NOW - 2 * HOUR) },
        e10: { since: iso(NOW - 30 * 24 * HOUR) },
      },
    };
    expect(dormantSince(s, NOW)).toBeNull();
    expect(isLiveOutage(s, 'diesel', NOW)).toBe(true);
  });

  it('never flags a station still serving a fuel, or an undated outage', () => {
    const old = { since: iso(NOW - 60 * 24 * HOUR) };
    expect(dormantSince({ prices: { e85: { value: 0.9 } }, outages: { diesel: old } }, NOW)).toBeNull();
    expect(dormantSince({ prices: {}, outages: { diesel: old, e10: {} } }, NOW)).toBeNull();
    expect(dormantSince({ prices: {} }, NOW)).toBeNull();
  });
});

describe('outageStart', () => {
  it('dates an outage of today by its clock time, an older one by its day', () => {
    expect(outageStart({ since: iso(NOW - HOUR) }, NOW)).toEqual({ kind: 'today', at: NOW - HOUR });
    expect(outageStart({ since: iso(NOW - 3 * 24 * HOUR) }, NOW)).toEqual({
      kind: 'day',
      at: NOW - 3 * 24 * HOUR,
    });
  });

  it('says nothing about an undated outage', () => {
    expect(outageStart({}, NOW)).toEqual({ kind: 'unknown' });
    expect(outageStart({ since: 'hier' }, NOW)).toEqual({ kind: 'unknown' });
  });
});
