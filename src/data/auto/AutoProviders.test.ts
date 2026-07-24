import { describe, expect, it } from 'vitest'
import { capNearest } from './AutoProviders'
import { haversineKm } from '../../lib/geo'
import type { Station } from '../types'

const CENTER = { lat: 42.47, lng: 2.86 } // Le Perthus — France · Spain overlap

/** A station `dLat` degrees north of the centre, i.e. ~111 km per degree. */
const station = (id: string, dLat: number): Station => ({
  id,
  name: id,
  init: 'ST',
  cat: 'unknown',
  lat: CENTER.lat + dLat,
  lng: CENTER.lng,
  address: '',
  city: '',
  prices: {},
  tags: [],
  services: [],
  highway: false,
})

describe('capNearest', () => {
  it('returns the list untouched when it fits under the cap', () => {
    const stations = [station('esp-2', 0.2), station('fra-1', 0.1)]
    expect(capNearest(stations, CENTER, 300)).toBe(stations)
  })

  it('keeps the nearest stations when merged sources overflow the cap', () => {
    // 300 French + 300 Spanish + 60 Andorran, as a border zone would return
    const fra = Array.from({ length: 300 }, (_, i) => station(`fra-${i}`, (i + 1) * 0.001))
    const esp = Array.from({ length: 300 }, (_, i) => station(`esp-${i}`, -(i + 1) * 0.0005))
    const and = Array.from({ length: 60 }, (_, i) => station(`and-${i}`, (i + 1) * 0.01))

    const capped = capNearest([...fra, ...esp, ...and], CENTER, 300)

    expect(capped).toHaveLength(300)
    // Sorted nearest-first, and nothing further than what it dropped
    const dists = capped.map((st) => haversineKm(CENTER, { lat: st.lat, lng: st.lng }))
    expect(dists).toEqual([...dists].sort((a, b) => a - b))
    const kept = new Set(capped.map((st) => st.id))
    const dropped = [...fra, ...esp, ...and].filter((st) => !kept.has(st.id))
    const furthestKept = Math.max(...dists)
    for (const st of dropped) {
      expect(haversineKm(CENTER, { lat: st.lat, lng: st.lng })).toBeGreaterThanOrEqual(furthestKept)
    }
  })

  it('mixes the sources instead of favouring whichever answered first', () => {
    const far = Array.from({ length: 4 }, (_, i) => station(`fra-${i}`, 0.5 + i * 0.01))
    const near = Array.from({ length: 4 }, (_, i) => station(`esp-${i}`, -0.01 - i * 0.001))

    const capped = capNearest([...far, ...near], CENTER, 5)

    expect(capped.map((st) => st.id)).toEqual(['esp-0', 'esp-1', 'esp-2', 'esp-3', 'fra-0'])
  })

  it('defaults to the same cap as a single source', () => {
    const stations = Array.from({ length: 660 }, (_, i) => station(`fra-${i}`, (i + 1) * 0.001))
    expect(capNearest(stations, CENTER)).toHaveLength(300)
  })
})
