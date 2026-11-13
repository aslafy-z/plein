import { afterEach, describe, expect, it } from 'vitest';
import { setForcedOffline } from './connectivity';
import { BLANK_PBF, BLANK_TILE, dropTileSnapshot, ensureTileSnapshot, tileUrlFor } from './tileGate';

// The gate decides whether a basemap tile may be requested at all. It is the
// only thing standing between « Force offline mode » and the tile server:
// MapLibre and the fallback layer fetch on their own, past every provider
// and store path.

const CACHED = 'https://tiles.versatiles.org/tiles/osm/12/2049/1409';
const UNCACHED = 'https://tiles.versatiles.org/tiles/osm/12/2050/1409';
const GLYPHS = 'https://tiles.versatiles.org/assets/glyphs/noto_sans_regular/0-255.pbf';

/** Cache Storage holding exactly `stores`, as the gate reads it */
function stubCacheStorage(stores: Record<string, string[]>): void {
  (globalThis as { caches?: unknown }).caches = {
    open: async (name: string) => ({
      keys: async () => (stores[name] ?? []).map((url) => ({ url })),
    }),
  };
}

afterEach(() => {
  setForcedOffline(false);
  dropTileSnapshot();
  delete (globalThis as { caches?: unknown }).caches;
});

describe('tileUrlFor', () => {
  it('hands back the real URL while the mode is off', () => {
    expect(tileUrlFor(UNCACHED)).toBe(UNCACHED);
  });

  it('blanks every tile while the snapshot is still loading', () => {
    // The instant between the switch flipping and Cache Storage answering:
    // letting a tile through here is exactly the request the mode forbids.
    setForcedOffline(true);
    expect(tileUrlFor(CACHED)).toBe(BLANK_TILE);
  });

  it('lets a cached tile through and blanks the rest', async () => {
    stubCacheStorage({ 'plein-tiles-v4': [CACHED] });
    setForcedOffline(true);
    await ensureTileSnapshot();

    // Cache Storage answers this one without a network round trip
    expect(tileUrlFor(CACHED)).toBe(CACHED);
    expect(tileUrlFor(UNCACHED)).toBe(BLANK_TILE);
  });

  it('answers the vector map with an empty protobuf, and reads the glyph cache too', async () => {
    // A declined vector tile must still parse: MapLibre reads an empty pbf as
    // a tile with no features. The glyph ranges live in the basemap cache.
    stubCacheStorage({ 'plein-tiles-v4': [CACHED], 'plein-basemap-v1': [GLYPHS] });
    setForcedOffline(true);
    await ensureTileSnapshot();

    expect(tileUrlFor(UNCACHED, BLANK_PBF)).toBe(BLANK_PBF);
    expect(tileUrlFor(CACHED, BLANK_PBF)).toBe(CACHED);
    expect(tileUrlFor(GLYPHS, BLANK_PBF)).toBe(GLYPHS);
  });

  it('blanks everything when the origin has no Cache Storage at all', async () => {
    // A private window or an insecure origin holds nothing, so nothing may be
    // asked for — what that device would show with its network cut.
    setForcedOffline(true);
    await ensureTileSnapshot();
    expect(tileUrlFor(CACHED)).toBe(BLANK_TILE);
  });

  it('releases every tile again once the mode is off', async () => {
    stubCacheStorage({ 'plein-tiles-v4': [CACHED] });
    setForcedOffline(true);
    await ensureTileSnapshot();
    expect(tileUrlFor(UNCACHED)).toBe(BLANK_TILE);

    setForcedOffline(false);
    dropTileSnapshot();
    expect(tileUrlFor(UNCACHED)).toBe(UNCACHED);
  });
});
