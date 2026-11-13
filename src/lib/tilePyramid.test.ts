import { describe, expect, it } from 'vitest'
import {
  pyramidTiles,
  tileFraction,
  tileToBounds,
  tileUrl,
  vectorPyramidZooms,
  vectorTileZoom,
  type TileCoords,
} from './tilePyramid'

const TOULOUSE = { lat: 43.6045, lng: 1.4442 }

const containing = (lat: number, lng: number, z: number): TileCoords => {
  const { x, y } = tileFraction(lat, lng, z)
  return { z, x: Math.floor(x), y: Math.floor(y) }
}

const has = (tiles: TileCoords[], t: TileCoords): boolean =>
  tiles.some((c) => c.z === t.z && c.x === t.x && c.y === t.y)

describe('tileFraction', () => {
  it('maps the origin to the center of the grid', () => {
    expect(tileFraction(0, 0, 0)).toEqual({ x: 0.5, y: 0.5 })
    expect(tileFraction(0, 0, 3)).toEqual({ x: 4, y: 4 })
  })

  it('clamps latitudes beyond Web Mercator to the grid edge', () => {
    expect(tileFraction(90, 0, 5).y).toBeCloseTo(0, 6)
    expect(tileFraction(-90, 0, 5).y).toBeCloseTo(32, 6)
  })
})

const range = (from: number, to: number): number[] => {
  const step = from <= to ? 1 : -1
  return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from + i * step)
}

describe('pyramidTiles', () => {
  it('always includes the tile containing the point, at every requested level', () => {
    const points = [TOULOUSE, { lat: 42.5063, lng: 1.5218 }, { lat: 38.7223, lng: -9.1393 }]
    for (const { lat, lng } of points) {
      const tiles = pyramidTiles(lat, lng, range(15, 5))
      for (let z = 15; z >= 5; z -= 1) {
        expect(has(tiles, containing(lat, lng, z)), `z${z} for ${lat},${lng}`).toBe(true)
      }
    }
  })

  it('covers zoom-in levels the same way as zoom-out ones', () => {
    const tiles = pyramidTiles(TOULOUSE.lat, TOULOUSE.lng, [17, 18, 19])
    expect(tiles).toHaveLength(12)
    for (const z of [17, 18, 19]) {
      expect(has(tiles, containing(TOULOUSE.lat, TOULOUSE.lng, z)), `z${z}`).toBe(true)
    }
  })

  it('costs 4 tiles per level away from the poles, in the requested order', () => {
    const zooms = [11, 13, 10, 14, 9, 15]
    const tiles = pyramidTiles(TOULOUSE.lat, TOULOUSE.lng, zooms)
    expect(tiles).toHaveLength(4 * zooms.length)
    expect([...new Set(tiles.map((t) => t.z))]).toEqual(zooms)
  })

  it('wraps the antimeridian instead of producing out-of-grid columns', () => {
    const tiles = pyramidTiles(0, 179.99, [5])
    // two rows × the two columns astride the antimeridian, wrapped into range
    expect(tiles.map((t) => t.x).sort((a, b) => a - b)).toEqual([0, 0, 31, 31])
  })

  it('drops rows past a pole rather than inventing them', () => {
    const tiles = pyramidTiles(89, 0, [5])
    expect(tiles).toHaveLength(2)
    for (const t of tiles) expect(t.y).toBe(0)
  })

  it('is empty when no zooms are requested', () => {
    expect(pyramidTiles(TOULOUSE.lat, TOULOUSE.lng, [])).toEqual([])
  })
})

describe('tileToBounds', () => {
  it('maps the z0 tile to the whole Web Mercator world', () => {
    const b = tileToBounds({ z: 0, x: 0, y: 0 })
    expect(b.west).toBe(-180)
    expect(b.east).toBe(180)
    expect(b.north).toBeCloseTo(85.0511, 4)
    expect(b.south).toBeCloseTo(-85.0511, 4)
  })

  it('round-trips with tileFraction at the tile corners', () => {
    const t = { z: 12, x: 2065, y: 1495 }
    const b = tileToBounds(t)
    const nw = tileFraction(b.north, b.west, t.z)
    const se = tileFraction(b.south, b.east, t.z)
    expect(nw.x).toBeCloseTo(t.x, 6)
    expect(nw.y).toBeCloseTo(t.y, 6)
    expect(se.x).toBeCloseTo(t.x + 1, 6)
    expect(se.y).toBeCloseTo(t.y + 1, 6)
  })

  it('nests children inside their parent tile', () => {
    const parent = tileToBounds({ z: 6, x: 32, y: 22 })
    for (const child of [tileToBounds({ z: 7, x: 64, y: 44 }), tileToBounds({ z: 7, x: 65, y: 45 })]) {
      expect(child.west).toBeGreaterThanOrEqual(parent.west)
      expect(child.east).toBeLessThanOrEqual(parent.east)
      expect(child.north).toBeLessThanOrEqual(parent.north)
      expect(child.south).toBeGreaterThanOrEqual(parent.south)
    }
  })
})

describe('tileUrl', () => {
  it('expands the {z}/{x}/{y} placeholders', () => {
    expect(tileUrl('https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}', { z: 3, x: 4, y: 2 })).toBe(
      'https://tiles.versatiles.org/tiles/osm/3/4/2',
    )
    expect(tileUrl('/tiles/{z}/{x}/{y}.png', { z: 7, x: 64, y: 45 })).toBe('/tiles/7/64/45.png')
  })
})

describe('vectorTileZoom', () => {
  it('runs one level below Leaflet and overzooms past the source maxzoom', () => {
    // 512 px vector tiles behind a 256 px Leaflet grid: Leaflet z13 draws z12
    expect(vectorTileZoom(13, 14)).toBe(12)
    expect(vectorTileZoom(13.7, 14)).toBe(12)
    // Street level reuses the deepest tile — no new request past it
    expect(vectorTileZoom(15, 14)).toBe(14)
    expect(vectorTileZoom(19, 14)).toBe(14)
    expect(vectorTileZoom(19, 10)).toBe(10)
    expect(vectorTileZoom(0.5, 14)).toBeNull()
  })
})

describe('vectorPyramidZooms', () => {
  it('lists every other level a gesture reaches, nearest first, without the current one', () => {
    // Leaflet z12 draws z11; the range 5–19 maps to tile zooms 4–14
    expect(vectorPyramidZooms(12, 5, 19, 14)).toEqual([10, 12, 9, 13, 8, 14, 7, 6, 5, 4])
  })

  it('collapses street level onto the deepest tile', () => {
    // At Leaflet z17 the map already draws z14: zooming in costs nothing
    expect(vectorPyramidZooms(17, 5, 19, 14)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4])
    // The landcover source stops at z10
    expect(vectorPyramidZooms(17, 5, 19, 10)).toEqual([9, 8, 7, 6, 5, 4])
  })
})
