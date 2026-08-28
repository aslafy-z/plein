import { describe, expect, it } from 'vitest';
import { CARTO_KEY, tileCacheKey, withCartoKey } from './cartoKey';

// The key travels on every basemap request and on none of the cache entries;
// a URL that gains or loses one character on either side is a tile the map
// asks for and the cache never holds.

describe('withCartoKey', () => {
  it('puts the key on a Leaflet template, braces untouched', () => {
    expect(withCartoKey('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png')).toBe(
      `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
    );
  });

  it('appends to a URL that already carries a query — the reachability probe', () => {
    expect(withCartoKey('https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123')).toBe(
      `https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123&key=${CARTO_KEY}`,
    );
  });
});

describe('tileCacheKey', () => {
  it('takes the key back off', () => {
    expect(
      tileCacheKey(`https://a.basemaps.cartocdn.com/dark_all/12/2049/1409.png?key=${CARTO_KEY}`),
    ).toBe('https://a.basemaps.cartocdn.com/dark_all/12/2049/1409.png');
  });

  it('drops a key the app did not write either — a rotated one still hits', () => {
    expect(tileCacheKey('https://a.basemaps.cartocdn.com/dark_all/5/16/11@2x.png?key=older')).toBe(
      'https://a.basemaps.cartocdn.com/dark_all/5/16/11@2x.png',
    );
  });

  it('leaves a keyless URL alone — the OSM fallback and the dev proxy', () => {
    expect(tileCacheKey('https://tile.openstreetmap.org/12/2049/1409.png')).toBe(
      'https://tile.openstreetmap.org/12/2049/1409.png',
    );
    expect(tileCacheKey('/tiles/12/2049/1409.png')).toBe('/tiles/12/2049/1409.png');
  });

  it('keeps every other parameter, so a probe URL stays recognizably not a tile', () => {
    expect(
      tileCacheKey(`https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123&key=${CARTO_KEY}`),
    ).toBe('https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123');
  });
});
