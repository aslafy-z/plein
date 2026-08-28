import { describe, expect, it } from 'vitest';
import { DEFAULT_CARTO_KEY, resolveCartoKey, tileCacheKey, withCartoKey } from './cartoKey';

// The key travels on every basemap request and on none of the cache entries;
// a URL that gains or loses one character on either side is a tile the map
// asks for and the cache never holds.

describe('resolveCartoKey', () => {
  it('takes the build\'s own key when it set one', () => {
    expect(resolveCartoKey('cb1_mine')).toBe('cb1_mine');
    expect(resolveCartoKey('  cb1_mine  ')).toBe('cb1_mine');
  });

  it('falls back to the shipped key rather than shipping a keyless build', () => {
    // An unset VITE_CARTO_KEY reads as undefined, a declared-but-empty one as
    // '' — and a keyless build looks fine right up to production, where every
    // tile arrives stamped « API key required ».
    expect(resolveCartoKey(undefined)).toBe(DEFAULT_CARTO_KEY);
    expect(resolveCartoKey('')).toBe(DEFAULT_CARTO_KEY);
    expect(resolveCartoKey('   ')).toBe(DEFAULT_CARTO_KEY);
  });
});

describe('withCartoKey', () => {
  it('puts the key on a Leaflet template, braces untouched', () => {
    expect(
      withCartoKey('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', 'cb1_key'),
    ).toBe('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_key');
  });

  it('appends to a URL that already carries a query — the reachability probe', () => {
    expect(
      withCartoKey('https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123', 'cb1_key'),
    ).toBe('https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123&key=cb1_key');
  });
});

describe('tileCacheKey', () => {
  it('takes the key back off', () => {
    expect(
      tileCacheKey(
        `https://a.basemaps.cartocdn.com/dark_all/12/2049/1409.png?key=${DEFAULT_CARTO_KEY}`,
      ),
    ).toBe('https://a.basemaps.cartocdn.com/dark_all/12/2049/1409.png');
  });

  it('drops a key this build did not write either — another one still hits', () => {
    // What an overriding build, or a rotated key, leaves in the cache
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
      tileCacheKey('https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123&key=cb1_key'),
    ).toBe('https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123');
  });
});
