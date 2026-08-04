import { describe, expect, it } from 'vitest'
import { capNearest, mergeAsTheyLand } from './AutoProviders'
import { haversineKm } from '../../lib/geo'
import type { GeocodeResult, Station } from '../types'

const CENTER = { lat: 42.47, lng: 2.86 } // Le Perthus — France · Spain overlap

/** A station `dLat` degrees north of the centre, i.e. ~111 km per degree. */
const station = (id: string, dLat: number): Station => ({
  id,
  name: id,
  init: 'ST',
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
    const stations = [station('es-2', 0.2), station('fr-1', 0.1)]
    expect(capNearest(stations, CENTER, 300)).toBe(stations)
  })

  it('keeps the nearest stations when merged sources overflow the cap', () => {
    // 300 French + 300 Spanish + 60 Andorran, as a border zone would return
    const fr = Array.from({ length: 300 }, (_, i) => station(`fr-${i}`, (i + 1) * 0.001))
    const es = Array.from({ length: 300 }, (_, i) => station(`es-${i}`, -(i + 1) * 0.0005))
    const ad = Array.from({ length: 60 }, (_, i) => station(`ad-${i}`, (i + 1) * 0.01))

    const capped = capNearest([...fr, ...es, ...ad], CENTER, 300)

    expect(capped).toHaveLength(300)
    // Sorted nearest-first, and nothing further than what it dropped
    const dists = capped.map((st) => haversineKm(CENTER, { lat: st.lat, lng: st.lng }))
    expect(dists).toEqual([...dists].sort((a, b) => a - b))
    const kept = new Set(capped.map((st) => st.id))
    const dropped = [...fr, ...es, ...ad].filter((st) => !kept.has(st.id))
    const furthestKept = Math.max(...dists)
    for (const st of dropped) {
      expect(haversineKm(CENTER, { lat: st.lat, lng: st.lng })).toBeGreaterThanOrEqual(furthestKept)
    }
  })

  it('mixes the sources instead of favouring whichever answered first', () => {
    const far = Array.from({ length: 4 }, (_, i) => station(`fr-${i}`, 0.5 + i * 0.01))
    const near = Array.from({ length: 4 }, (_, i) => station(`es-${i}`, -0.01 - i * 0.001))

    const capped = capNearest([...far, ...near], CENTER, 5)

    expect(capped.map((st) => st.id)).toEqual(['es-0', 'es-1', 'es-2', 'es-3', 'fr-0'])
  })

  it('defaults to the same cap as a single source', () => {
    const stations = Array.from({ length: 660 }, (_, i) => station(`fr-${i}`, (i + 1) * 0.001))
    expect(capNearest(stations, CENTER)).toHaveLength(300)
  })
})

describe('mergeAsTheyLand', () => {
  const place = (label: string): GeocodeResult => ({
    label,
    sublabel: '',
    point: CENTER,
    kind: 'locality',
  })

  /** A promise resolved from the outside, i.e. a geocoder on a leash. */
  const deferred = <T,>() => {
    let settle!: (value: T) => void
    let fail!: (reason: unknown) => void
    const promise = new Promise<T>((resolve, reject) => {
      settle = resolve
      fail = reject
    })
    return { promise, settle, fail }
  }

  it('publishes the fast sources before the slow one has answered', async () => {
    const fast = deferred<GeocodeResult[]>()
    const slow = deferred<GeocodeResult[]>()
    const partials: string[][] = []
    const merged = mergeAsTheyLand(
      [fast.promise, slow.promise],
      (res) => partials.push(res.map((r) => r.label)),
    )

    fast.settle([place('Toulouse')])
    await Promise.resolve()
    expect(partials).toEqual([['Toulouse']])

    slow.settle([place('Girona')])
    expect(await merged).toEqual([place('Toulouse'), place('Girona')])
    // The last source to land comes back as the promise's result, not as a
    // partial: the view would otherwise render the same list twice.
    expect(partials).toHaveLength(1)
  })

  it('resolves only once every source has concluded', async () => {
    const fast = deferred<GeocodeResult[]>()
    const slow = deferred<GeocodeResult[]>()
    let done = false
    const merged = mergeAsTheyLand([fast.promise, slow.promise]).then((res) => {
      done = true
      return res
    })

    fast.settle([place('Toulouse')])
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false)

    slow.settle([])
    await merged
    expect(done).toBe(true)
  })

  it('keeps the survivors when a source fails', async () => {
    const res = await mergeAsTheyLand([
      Promise.reject(new Error('cartociudad down')),
      Promise.resolve([place('Toulouse')]),
    ])
    expect(res).toEqual([place('Toulouse')])
  })

  it('throws only when every source failed', async () => {
    await expect(
      mergeAsTheyLand([
        Promise.reject(new Error('first')),
        Promise.reject(new Error('second')),
      ]),
    ).rejects.toThrow('first')
  })
})
