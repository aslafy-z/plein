import { describe, it, expect } from 'vitest';
import { stationCountry, normalizeStationId } from './stationIds';

describe('stationCountry', () => {
  it('reads the country off the prefix', () => {
    expect(stationCountry('fr-31000009')).toBe('fr');
    expect(stationCountry('es-1234')).toBe('es');
    expect(stationCountry('ad-42')).toBe('ad');
  });

  it('leaves ids outside the scheme unattributed', () => {
    // Demo ids ('su', 'r-a62') are not country-issued
    expect(stationCountry('su')).toBeNull();
    expect(stationCountry('r-a62')).toBeNull();
    expect(stationCountry('ad')).toBeNull();
  });
});

describe('normalizeStationId', () => {
  it('prefixes the bare French ids of persisted favorites and old bookmarks', () => {
    expect(normalizeStationId('31000009')).toBe('fr-31000009');
    // Records without an id fell back to « lat,lng »
    expect(normalizeStationId('43.60000,1.44000')).toBe('fr-43.60000,1.44000');
  });

  it('leaves already-prefixed and demo ids alone', () => {
    expect(normalizeStationId('fr-31000009')).toBe('fr-31000009');
    expect(normalizeStationId('es-1234')).toBe('es-1234');
    expect(normalizeStationId('ad-42')).toBe('ad-42');
    expect(normalizeStationId('su')).toBe('su');
    expect(normalizeStationId('r-a62')).toBe('r-a62');
  });

  it('maps the 3-letter prefixes of older builds onto the 2-letter scheme', () => {
    expect(normalizeStationId('fra-31000009')).toBe('fr-31000009');
    expect(normalizeStationId('fra-43.60000,1.44000')).toBe('fr-43.60000,1.44000');
    expect(normalizeStationId('esp-1234')).toBe('es-1234');
    expect(normalizeStationId('and-42')).toBe('ad-42');
    expect(normalizeStationId('prt-67360')).toBe('pt-67360');
  });
});
