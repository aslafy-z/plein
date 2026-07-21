import { describe, expect, it } from 'vitest'
import {
  cumulativeKm,
  haversineKm,
  lerpPoint,
  nearestOnPolyline,
  polylineLengthKm,
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

  it('samplePolyline keeps both endpoints and spaces samples out', () => {
    const dense = Array.from({ length: 101 }, (_, i) => lerpPoint(TOULOUSE, BORDEAUX, i / 100))
    const samples = samplePolyline(dense, 50)
    expect(samples[0]).toEqual(dense[0])
    expect(samples[samples.length - 1]).toEqual(dense[dense.length - 1])
    // ~212 km sampled every 50 km → 4 intermediate points + the two ends
    expect(samples.length).toBeGreaterThan(3)
    expect(samples.length).toBeLessThan(10)
  })
})
