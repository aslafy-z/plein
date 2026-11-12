import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cachedTileUrls,
  clearTileCache,
  parseTileUrl,
  readCachedTiles,
  summarizeCachedTiles,
  tileCacheStats,
  tileMapZoom,
  TILE_BYTES_ESTIMATE,
} from './tileCache'

const VT = 'https://tiles.versatiles.org'

describe('parseTileUrl', () => {
  it('parses the two VersaTiles vector sources', () => {
    expect(parseTileUrl(`${VT}/tiles/osm/12/2064/1495`)).toEqual({
      style: 'vector',
      z: 12,
      x: 2064,
      y: 1495,
    })
    expect(parseTileUrl(`${VT}/tiles/landcover-vectors/5/16/11`)).toEqual({
      style: 'landcover',
      z: 5,
      x: 16,
      y: 11,
    })
  })

  it('parses the OSM fallback and the dev proxy as fallback tiles', () => {
    expect(parseTileUrl('https://tile.openstreetmap.org/7/64/45.png')).toEqual({
      style: 'fallback',
      z: 7,
      x: 64,
      y: 45,
    })
    expect(parseTileUrl('/tiles/9/258/186.png')).toEqual({
      style: 'fallback',
      z: 9,
      x: 258,
      y: 186,
    })
  })

  it('rejects probe URLs, basemap assets and foreign entries', () => {
    // A queried tile URL is the reachability probe — sw.js never caches it,
    // and parsing one would hide that bug instead of surfacing it.
    expect(parseTileUrl(`${VT}/tiles/osm/3/4/2?probe=123`)).toBeNull()
    expect(parseTileUrl(`${VT}/assets/glyphs/noto_sans_regular/0-255.pbf`)).toBeNull()
    expect(parseTileUrl('https://example.com/5/1/2.png')).toBeNull()
    expect(parseTileUrl('/assets/icon.svg')).toBeNull()
    expect(parseTileUrl(`${VT}/tiles/osm/not/a/tile`)).toBeNull()
  })
})

describe('tileMapZoom', () => {
  it('files a 512 px vector tile one Leaflet level deeper than its own zoom', () => {
    expect(tileMapZoom({ style: 'vector', z: 12, x: 0, y: 0 })).toBe(13)
    expect(tileMapZoom({ style: 'landcover', z: 8, x: 0, y: 0 })).toBe(9)
    expect(tileMapZoom({ style: 'fallback', z: 12, x: 0, y: 0 })).toBe(12)
  })
})

describe('summarizeCachedTiles', () => {
  it('counts per zoom (ascending) and per source', () => {
    const tiles = [
      { style: 'vector', z: 12, x: 1, y: 1 },
      { style: 'vector', z: 5, x: 1, y: 1 },
      { style: 'vector', z: 5, x: 2, y: 1 },
      { style: 'landcover', z: 12, x: 1, y: 1 },
      { style: 'fallback', z: 7, x: 1, y: 1 },
    ] as const
    const summary = summarizeCachedTiles([...tiles])
    expect(summary.entries).toBe(5)
    expect(Object.entries(summary.byZoom)).toEqual([
      ['z5', 2],
      ['z7', 1],
      ['z12', 2],
    ])
    expect(summary.byStyle).toEqual({ vector: 3, landcover: 1, fallback: 1 })
  })
})

describe('cachedTileUrls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the raw keys the prefetcher plans against', async () => {
    vi.stubGlobal('caches', {
      open: async () => ({
        keys: async () => [
          { url: `${VT}/tiles/osm/5/16/11` },
          { url: `${VT}/tiles/osm/5/17/11` },
        ],
      }),
    })
    const urls = await cachedTileUrls()
    expect(urls.has(`${VT}/tiles/osm/5/16/11`)).toBe(true)
    expect(urls.size).toBe(2)
  })

  it('reads an empty set where Cache Storage is missing or refuses', async () => {
    expect(await cachedTileUrls()).toEqual(new Set())

    vi.stubGlobal('caches', {
      open: async () => {
        throw new Error('denied')
      },
    })
    // Degrades to « nothing is cached »: every candidate looks missing and is
    // fetched, which is the behaviour from before the cache-aware planning.
    expect(await cachedTileUrls()).toEqual(new Set())
  })
})

/** A CacheStorage double with named stores, enough for the stats and sweep */
const fakeCacheStorage = (stores: Record<string, number>) => ({
  keys: async () => Object.keys(stores),
  open: async (name: string) => ({
    keys: async () =>
      Array.from({ length: stores[name] ?? 0 }, (_, i) => ({ url: `https://t.example/${i}.png` })),
  }),
  delete: vi.fn(async (name: string) => delete stores[name]),
})

describe('tileCacheStats', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('counts every plein-tiles-* generation and estimates the weight', async () => {
    // An abandoned generation lives until the next worker activates — what
    // the app is storing includes it, so the counter must too.
    vi.stubGlobal(
      'caches',
      fakeCacheStorage({ 'plein-tiles-v1': 2, 'plein-tiles-v2': 3, 'plein-assets-v1': 40 }),
    )
    expect(await tileCacheStats()).toEqual({ tiles: 5, bytes: 5 * TILE_BYTES_ESTIMATE })
  })

  it('reads empty where Cache Storage is missing or refuses', async () => {
    expect(await tileCacheStats()).toEqual({ tiles: 0, bytes: 0 })

    vi.stubGlobal('caches', {
      keys: async () => {
        throw new Error('denied')
      },
    })
    expect(await tileCacheStats()).toEqual({ tiles: 0, bytes: 0 })
  })
})

describe('clearTileCache', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sweeps every tile generation and nothing else', async () => {
    const storage = fakeCacheStorage({
      'plein-tiles-v1': 2,
      'plein-tiles-v2': 3,
      'plein-assets-v1': 40,
    })
    vi.stubGlobal('caches', storage)

    await clearTileCache()

    expect(storage.delete.mock.calls.map(([name]) => name).sort()).toEqual([
      'plein-tiles-v1',
      'plein-tiles-v2',
    ])
  })

  it('is a no-op where Cache Storage is missing or refuses', async () => {
    await expect(clearTileCache()).resolves.toBeUndefined()

    vi.stubGlobal('caches', {
      keys: async () => {
        throw new Error('denied')
      },
    })
    await expect(clearTileCache()).resolves.toBeUndefined()
  })
})

describe('readCachedTiles', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads an empty list where Cache Storage does not exist', async () => {
    expect(await readCachedTiles()).toEqual([])
  })

  it('parses the tile cache keys and drops what is not a tile', async () => {
    vi.stubGlobal('caches', {
      open: async () => ({
        keys: async () => [
          { url: `${VT}/tiles/osm/5/16/11` },
          { url: `${VT}/tiles/osm/3/4/2?probe=1` },
          { url: 'https://tile.openstreetmap.org/5/16/11.png' },
        ],
      }),
    })
    const tiles = await readCachedTiles()
    expect(tiles).toHaveLength(2)
    expect(tiles.map((t) => t.style)).toEqual(['vector', 'fallback'])
  })
})
