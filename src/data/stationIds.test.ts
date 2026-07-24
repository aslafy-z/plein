import { describe, it, expect } from 'vitest';
import { stationCountry, normalizeStationId } from './stationIds';

describe('stationCountry', () => {
  it('reads the country off the prefix', () => {
    expect(stationCountry('fra-31000009')).toBe('fra');
    expect(stationCountry('esp-1234')).toBe('esp');
    expect(stationCountry('and-42')).toBe('and');
  });

  it('leaves ids outside the scheme unattributed', () => {
    // Demo ids ('su', 'r-a62') are not country-issued
    expect(stationCountry('su')).toBeNull();
    expect(stationCountry('r-a62')).toBeNull();
    expect(stationCountry('and')).toBeNull();
  });
});

describe('normalizeStationId', () => {
  it('prefixes the bare French ids of persisted favorites and old bookmarks', () => {
    expect(normalizeStationId('31000009')).toBe('fra-31000009');
    // Records without an id fell back to « lat,lng »
    expect(normalizeStationId('43.60000,1.44000')).toBe('fra-43.60000,1.44000');
  });

  it('leaves already-prefixed and demo ids alone', () => {
    expect(normalizeStationId('fra-31000009')).toBe('fra-31000009');
    expect(normalizeStationId('esp-1234')).toBe('esp-1234');
    expect(normalizeStationId('and-42')).toBe('and-42');
    expect(normalizeStationId('su')).toBe('su');
    expect(normalizeStationId('r-a62')).toBe('r-a62');
  });
});
