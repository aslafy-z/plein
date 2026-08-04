import { afterEach, describe, expect, it } from 'vitest';
import { setForcedOffline } from './connectivity';
import { BLANK_TILE, dropTileSnapshot, ensureTileSnapshot, tileUrlFor } from './tileGate';

// The gate decides whether a basemap tile may be requested at all. It is the
// only thing standing between « Force offline mode » and the CDN: Leaflet
// loads tiles with <img> requests, which no provider or store path sees.

const CACHED = 'https://a.basemaps.cartocdn.com/dark_all/12/2049/1409.png';
const UNCACHED = 'https://a.basemaps.cartocdn.com/dark_all/12/2050/1409.png';

/** Cache Storage holding exactly `urls`, as the gate reads it */
function stubCacheStorage(urls: string[]): void {
  (globalThis as { caches?: unknown }).caches = {
    open: async () => ({ keys: async () => urls.map((url) => ({ url })) }),
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
    stubCacheStorage([CACHED]);
    setForcedOffline(true);
    await ensureTileSnapshot();

    // Cache Storage answers this one without a network round trip
    expect(tileUrlFor(CACHED)).toBe(CACHED);
    expect(tileUrlFor(UNCACHED)).toBe(BLANK_TILE);
  });

  it('blanks everything when the origin has no Cache Storage at all', async () => {
    // A private window or an insecure origin holds nothing, so nothing may be
    // asked for — what that device would show with its network cut.
    setForcedOffline(true);
    await ensureTileSnapshot();
    expect(tileUrlFor(CACHED)).toBe(BLANK_TILE);
  });

  it('releases every tile again once the mode is off', async () => {
    stubCacheStorage([CACHED]);
    setForcedOffline(true);
    await ensureTileSnapshot();
    expect(tileUrlFor(UNCACHED)).toBe(BLANK_TILE);

    setForcedOffline(false);
    dropTileSnapshot();
    expect(tileUrlFor(UNCACHED)).toBe(UNCACHED);
  });
});
