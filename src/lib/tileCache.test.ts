import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedTileUrls, parseTileUrl, readCachedTiles, summarizeCachedTiles } from './tileCache'

describe('parseTileUrl', () => {
  it('parses CARTO tiles with style, subdomain, and retina suffix', () => {
    expect(parseTileUrl('https://c.basemaps.cartocdn.com/dark_all/12/2064/1495.png')).toEqual({
      style: 'dark',
      z: 12,
      x: 2064,
      y: 1495,
      retina: false,
    })
    expect(parseTileUrl('https://a.basemaps.cartocdn.com/light_all/5/16/11@2x.png')).toEqual({
      style: 'light',
      z: 5,
      x: 16,
      y: 11,
      retina: true,
    })
  })

  it('parses the OSM fallback and the dev proxy as fallback tiles', () => {
    expect(parseTileUrl('https://tile.openstreetmap.org/7/64/45.png')).toEqual({
      style: 'fallback',
      z: 7,
      x: 64,
      y: 45,
      retina: false,
    })
    expect(parseTileUrl('/tiles/9/258/186.png')).toEqual({
      style: 'fallback',
      z: 9,
      x: 258,
      y: 186,
      retina: false,
    })
  })

  it('rejects probe URLs and foreign entries', () => {
    // A queried tile URL is the reachability probe — sw.js never caches it,
    // and parsing one would hide that bug instead of surfacing it.
    expect(parseTileUrl('https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123')).toBeNull()
    expect(parseTileUrl('https://example.com/5/1/2.png')).toBeNull()
    expect(parseTileUrl('/assets/icon.svg')).toBeNull()
    expect(parseTileUrl('https://basemaps.cartocdn.com/dark_all/not/a/tile.png')).toBeNull()
  })
})

describe('summarizeCachedTiles', () => {
  it('counts per zoom (ascending) and per style', () => {
    const tiles = [
      { style: 'dark', z: 12, x: 1, y: 1, retina: false },
      { style: 'dark', z: 5, x: 1, y: 1, retina: false },
      { style: 'dark', z: 5, x: 2, y: 1, retina: false },
      { style: 'light', z: 12, x: 1, y: 1, retina: false },
      { style: 'fallback', z: 7, x: 1, y: 1, retina: false },
    ] as const
    const summary = summarizeCachedTiles([...tiles])
    expect(summary.entries).toBe(5)
    expect(Object.entries(summary.byZoom)).toEqual([
      ['z5', 2],
      ['z7', 1],
      ['z12', 2],
    ])
    expect(summary.byStyle).toEqual({ dark: 3, light: 1, fallback: 1 })
  })
})

describe('cachedTileUrls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the raw keys the prefetcher plans against', async () => {
    vi.stubGlobal('caches', {
      open: async () => ({
        keys: async () => [
          { url: 'https://a.basemaps.cartocdn.com/dark_all/5/16/11.png' },
          { url: 'https://b.basemaps.cartocdn.com/dark_all/5/17/11.png' },
        ],
      }),
    })
    const urls = await cachedTileUrls()
    expect(urls.has('https://a.basemaps.cartocdn.com/dark_all/5/16/11.png')).toBe(true)
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

describe('readCachedTiles', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads an empty list where Cache Storage does not exist', async () => {
    expect(await readCachedTiles()).toEqual([])
  })

  it('parses the tile cache keys and drops what is not a tile', async () => {
    vi.stubGlobal('caches', {
      open: async () => ({
        keys: async () => [
          { url: 'https://a.basemaps.cartocdn.com/dark_all/5/16/11.png' },
          { url: 'https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=1' },
          { url: 'https://tile.openstreetmap.org/5/16/11.png' },
        ],
      }),
    })
    const tiles = await readCachedTiles()
    expect(tiles).toHaveLength(2)
    expect(tiles.map((t) => t.style)).toEqual(['dark', 'fallback'])
  })
})
