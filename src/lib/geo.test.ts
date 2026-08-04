import { describe, expect, it } from 'vitest'
import {
  cumulativeKm,
  haversineKm,
  lerpPoint,
  nearestOnPolyline,
  polylineLengthKm,
  radiusBounds,
  samplePolyline,
  type GeoPoint,
} from './geo'

const TOULOUSE: GeoPoint = { lat: 43.6047, lng: 1.4442 }
const BORDEAUX: GeoPoint = { lat: 44.8378, lng: -0.5792 }

describe('haversineKm', () => {
  it('matches known distances', () => {
    expect(haversineKm(TOULOUSE, TOULOUSE)).toBe(0)
    // Toulouse → Bordeaux is ~212 km as the crow flies
    expect(haversineKm(TOULOUSE, BORDEAUX)).toBeGreaterThan(205)
    expect(haversineKm(TOULOUSE, BORDEAUX)).toBeLessThan(220)
    // 0.01° of latitude ≈ 1.11 km, anywhere
    expect(haversineKm(TOULOUSE, { ...TOULOUSE, lat: TOULOUSE.lat + 0.01 })).toBeCloseTo(1.11, 1)
  })

  it('is symmetric', () => {
    expect(haversineKm(TOULOUSE, BORDEAUX)).toBeCloseTo(haversineKm(BORDEAUX, TOULOUSE), 10)
  })
})

describe('radiusBounds', () => {
  it('encloses the circle exactly on both axes', () => {
    const box = radiusBounds(TOULOUSE, 10)
    // North/south edges sit at the radius, east/west too (widest at the center
    // latitude — the box is the circumscribed one, no slack)
    expect(haversineKm(TOULOUSE, { lat: box.north, lng: TOULOUSE.lng })).toBeCloseTo(10, 2)
    expect(haversineKm(TOULOUSE, { lat: box.south, lng: TOULOUSE.lng })).toBeCloseTo(10, 2)
    expect(haversineKm(TOULOUSE, { lat: TOULOUSE.lat, lng: box.east })).toBeCloseTo(10, 1)
    expect(haversineKm(TOULOUSE, { lat: TOULOUSE.lat, lng: box.west })).toBeCloseTo(10, 1)
  })

  it('scales with the radius — a wider search frames a wider box', () => {
    const small = radiusBounds(TOULOUSE, 5)
    const big = radiusBounds(TOULOUSE, 25)
    expect(big.north - big.south).toBeCloseTo(5 * (small.north - small.south), 6)
    expect(big.east - big.west).toBeCloseTo(5 * (small.east - small.west), 6)
  })

  it('widens the longitude span with latitude', () => {
    const south = radiusBounds({ lat: 0, lng: 0 }, 10)
    const north = radiusBounds({ lat: 60, lng: 0 }, 10)
    expect(north.north - north.south).toBeCloseTo(south.north - south.south, 6)
    // cos(60°) = 0.5 → twice the degrees of longitude for the same km
    expect(north.east - north.west).toBeCloseTo(2 * (south.east - south.west), 6)
  })

  it('stays a valid box at the poles', () => {
    const box = radiusBounds({ lat: 90, lng: 0 }, 25)
    expect(box.north).toBe(90)
    expect(box.east - box.west).toBeLessThanOrEqual(360)
  })
})

describe('polyline helpers', () => {
  const line = [0, 0.25, 0.5, 0.75, 1].map((t) => lerpPoint(TOULOUSE, BORDEAUX, t))

  it('polylineLengthKm sums the segments to the direct distance on a straight line', () => {
    expect(polylineLengthKm(line)).toBeCloseTo(haversineKm(TOULOUSE, BORDEAUX), 0)
  })

  it('cumulativeKm starts at 0 and ends at the total length', () => {
    const cum = cumulativeKm(line)
    expect(cum).toHaveLength(line.length)
    expect(cum[0]).toBe(0)
    expect(cum[cum.length - 1]).toBeCloseTo(polylineLengthKm(line), 6)
  })

  it('nearestOnPolyline finds the closest vertex with its km-along', () => {
    const total = polylineLengthKm(line)
    // A point ~2 km north of the halfway vertex
    const p = { lat: line[2].lat + 0.018, lng: line[2].lng }
    const near = nearestOnPolyline(p, line)
    expect(near.index).toBe(2)
    expect(near.alongKm).toBeCloseTo(total / 2, 0)
    expect(near.distKm).toBeCloseTo(2, 0)
  })

  it('nearestOnPolyline answers the empty line without measuring anything', () => {
    expect(nearestOnPolyline(TOULOUSE, [])).toEqual({ distKm: Infinity, alongKm: 0, index: 0 })
  })

  it('nearestOnPolyline keeps the first of two equally distant vertices', () => {
    // A V whose two arms put vertex 0 and vertex 2 at the very same distance
    const v = [
      { lat: 44, lng: 1 },
      { lat: 43, lng: 1 },
      { lat: 44, lng: 1 },
    ]
    expect(nearestOnPolyline({ lat: 45, lng: 1 }, v).index).toBe(0)
  })

  // The index below (blocks + enclosing radii) may only ever be a faster way to
  // the SAME vertex: whatever it prunes, the answer is the full scan's.
  it('nearestOnPolyline answers exactly what a full scan would, on any shape', () => {
    // Deterministic pseudo-random, so a failure is reproducible
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const fullScan = (p: GeoPoint, line: GeoPoint[]) => {
      const cum = cumulativeKm(line)
      let best = { distKm: Infinity, alongKm: 0, index: 0 }
      for (let i = 0; i < line.length; i++) {
        const d = haversineKm(p, line[i])
        if (d < best.distKm) best = { distKm: d, alongKm: cum[i], index: i }
      }
      return best
    }
    const shapes: GeoPoint[][] = [
      // A single vertex, and a line shorter than one block
      [TOULOUSE],
      [TOULOUSE, BORDEAUX],
      // Dense and even, the way a routing engine returns a motorway
      Array.from({ length: 400 }, (_, i) => lerpPoint(TOULOUSE, BORDEAUX, i / 399)),
      // Wildly uneven spacing: a few long straights among clusters of vertices
      Array.from({ length: 300 }, (_, i) =>
        lerpPoint(TOULOUSE, BORDEAUX, i % 20 === 0 ? i / 300 : (i % 20) / 6000 + i / 300),
      ),
      // A loop that comes back on itself — two arms in the same blocks
      Array.from({ length: 200 }, (_, i) => {
        const a = (i / 200) * 2 * Math.PI
        return { lat: 43.6 + Math.sin(a), lng: 1.44 + Math.cos(a) }
      }),
      // Pure noise
      Array.from({ length: 250 }, () => ({ lat: 41 + rnd() * 10, lng: -2 + rnd() * 8 })),
    ]
    for (const line of shapes) {
      for (let t = 0; t < 40; t++) {
        const p = { lat: 40 + rnd() * 12, lng: -4 + rnd() * 12 }
        expect(nearestOnPolyline(p, line)).toEqual(fullScan(p, line))
      }
    }
  })

  it('samplePolyline keeps both endpoints and spaces samples out', () => {
    const dense = Array.from({ length: 101 }, (_, i) => lerpPoint(TOULOUSE, BORDEAUX, i / 100))
    const samples = samplePolyline(dense, 50)
    expect(samples[0]).toEqual(dense[0])
    expect(samples[samples.length - 1]).toEqual(dense[dense.length - 1])
    // ~212 km sampled every 50 km → 4 intermediate points + the two ends
    expect(samples.length).toBeGreaterThan(3)
    expect(samples.length).toBeLessThan(10)
  })

  it('samplePolyline never emits the last vertex twice', () => {
    // The loop reaches the final vertex while a sample is still due, so it
    // pushes it — the tail must not then be appended a second time.
    const clustered = [0, 0.05, 1].map((t) => lerpPoint(TOULOUSE, BORDEAUX, t))
    const samples = samplePolyline(clustered, 50)
    expect(samples).toEqual([clustered[0], clustered[2]])
  })

  it('samplePolyline emits no consecutive duplicates for any spacing', () => {
    const dense = Array.from({ length: 101 }, (_, i) => lerpPoint(TOULOUSE, BORDEAUX, i / 100))
    const total = polylineLengthKm(dense)
    for (const everyKm of [1, 5, 17, total / 8, total / 3, total, total * 2]) {
      const samples = samplePolyline(dense, everyKm)
      expect(samples[0]).toEqual(dense[0])
      expect(samples[samples.length - 1]).toEqual(dense[dense.length - 1])
      const dupes = samples.filter(
        (p, i) => i > 0 && p.lat === samples[i - 1].lat && p.lng === samples[i - 1].lng,
      )
      expect(dupes).toEqual([])
    }
  })
})
