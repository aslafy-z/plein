import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutoStationsProvider, capNearest, mergeAsTheyLand } from './AutoProviders'
import { FrStationsProvider } from '../fr/FrStationsProvider'
import { EsStationsProvider, esCoversAlong, esCoversNear } from '../es/EsStationsProvider'
import { AdStationsProvider } from '../ad/AdStationsProvider'
import { PtStationsProvider } from '../pt/PtStationsProvider'
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

describe('AutoStationsProvider — a failed source', () => {
  // Biarritz: French ground, with the Spanish coverage grazing the 25 km disc
  // without containing its centre — France owns the zone, Spain is a neighbour.
  const BIARRITZ = { lat: 43.4832, lng: -1.5586 }
  const RADIUS_KM = 25
  const TOULOUSE = { lat: 43.6047, lng: 1.4442 }
  const BARCELONA = { lat: 41.3874, lng: 2.1686 }

  const sources = [FrStationsProvider, EsStationsProvider, AdStationsProvider, PtStationsProvider]
  type Outcome = Station[] | Error
  const settle = (outcome: Outcome) =>
    outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)

  /** Stub every source's network; the ones not named answer an empty list. */
  const stub = (method: 'getStationsNear' | 'getStationsAlong', fr: Outcome, es: Outcome) => {
    const outcomes: Outcome[] = [fr, es, [], []]
    sources.forEach((source, i) => {
      vi.spyOn(source.prototype, method).mockImplementation(() => settle(outcomes[i]))
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stands on a zone France owns and Spain only neighbours', () => {
    expect(esCoversNear(BIARRITZ, RADIUS_KM)).toBe(true)
    expect(esCoversNear(BIARRITZ, 0)).toBe(false)
  })

  it('rejects when the source owning the zone failed, even though a neighbour answered', async () => {
    stub('getStationsNear', new Error('fr down'), [station('es-1', 0)])
    await expect(new AutoStationsProvider().getStationsNear(BIARRITZ, RADIUS_KM)).rejects.toThrow('fr down')
  })

  it('still resolves with the owner\'s stations when a non-owning neighbour failed', async () => {
    stub('getStationsNear', [station('fr-1', 0)], new Error('es down'))
    const res = await new AutoStationsProvider().getStationsNear(BIARRITZ, RADIUS_KM)
    expect(res.map((st) => st.id)).toEqual(['fr-1'])
  })

  it('merges every source when all of them answered', async () => {
    stub('getStationsNear', [station('fr-1', 0)], [station('es-1', 0)])
    const res = await new AutoStationsProvider().getStationsNear(BIARRITZ, RADIUS_KM)
    expect(res.map((st) => st.id)).toEqual(['fr-1', 'es-1'])
  })

  it('rejects a corridor when one of the countries it crosses failed', async () => {
    const route = [TOULOUSE, BARCELONA]
    expect(esCoversAlong(route, 5)).toBe(true)

    stub('getStationsAlong', new Error('fr down'), [station('es-1', 0)])
    await expect(new AutoStationsProvider().getStationsAlong(route, 5)).rejects.toThrow('fr down')

    vi.restoreAllMocks()
    stub('getStationsAlong', [station('fr-1', 0)], new Error('es down'))
    await expect(new AutoStationsProvider().getStationsAlong(route, 5)).rejects.toThrow('es down')
  })

  it('resolves a corridor with every country when all of them answered', async () => {
    stub('getStationsAlong', [station('fr-1', 0)], [station('es-1', 0)])
    const res = await new AutoStationsProvider().getStationsAlong([TOULOUSE, BARCELONA], 5)
    expect(res.map((st) => st.id)).toEqual(['fr-1', 'es-1'])
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
