import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AutoStationsProvider,
  capNearest,
  frCoversAlong,
  frCoversNear,
  mergeAsTheyLand,
} from './AutoProviders'
import { FrStationsProvider } from '../fr/FrStationsProvider'
import { EsStationsProvider, esCoversAlong, esCoversNear } from '../es/EsStationsProvider'
import { AdStationsProvider } from '../ad/AdStationsProvider'
import { AdGeocodeProvider } from '../ad/AdGeocodeProvider'
import { CartoCiudadGeocodeProvider } from '../es/CartoCiudadGeocodeProvider'
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

describe('French flux coverage', () => {
  const ZONE_KM = 10

  it.each([
    ['Ajaccio', { lat: 41.927, lng: 8.737 }],
    ['Bastia', { lat: 42.697, lng: 9.45 }],
    ['Calvi', { lat: 42.567, lng: 8.757 }],
    ['Bonifacio', { lat: 41.387, lng: 9.159 }],
    ['the tip of Cap Corse', { lat: 43.01, lng: 9.4 }],
    ['Marigot, Saint-Martin', { lat: 18.067, lng: -63.083 }],
    ['Gustavia, Saint-Barthélemy', { lat: 17.896, lng: -62.85 }],
    ['Toulouse', { lat: 43.6, lng: 1.44 }],
    ['Pointe-à-Pitre', { lat: 16.24, lng: -61.53 }],
    ['Fort-de-France', { lat: 14.6, lng: -61.07 }],
  ])('queries the French flux around %s', (_name, point) => {
    expect(frCoversNear(point, ZONE_KM)).toBe(true)
  })

  it.each([
    ['Cagliari, Sardinia', { lat: 39.22, lng: 9.12 }],
    ['the open Atlantic', { lat: 30, lng: -40 }],
    ['the Virgin Islands', { lat: 18.34, lng: -64.93 }],
  ])('leaves the French flux alone around %s', (_name, point) => {
    expect(frCoversNear(point, ZONE_KM)).toBe(false)
  })

  it('queries the French flux along a route that stays in Corsica', () => {
    const ajaccioToBonifacio = [
      { lat: 41.927, lng: 8.737 },
      { lat: 41.387, lng: 9.159 },
    ]
    expect(frCoversAlong(ajaccioToBonifacio, 5)).toBe(true)
  })

  it('leaves the French flux alone along a route in southern Sardinia', () => {
    const cagliariToOristano = [
      { lat: 39.22, lng: 9.12 },
      { lat: 39.9, lng: 8.59 },
    ]
    expect(frCoversAlong(cagliariToOristano, 5)).toBe(false)
  })
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

describe('AutoStationsProvider.getStationsNear', () => {
  /** The merge with each country source replaced by a canned answer. */
  const autoOver = (bySource: Record<'fr' | 'es' | 'ad' | 'pt', Station[]>) => {
    const auto = new AutoStationsProvider()
    const sources = auto as unknown as Record<string, { getStationsNear: () => Promise<Station[]> }>
    for (const [id, stations] of Object.entries(bySource)) {
      sources[id] = { getStationsNear: async () => stations }
    }
    return auto
  }

  it('reports the radius its own cut covers when the merge overflows the cap', async () => {
    // 200 French stations out to ~22 km, 200 Spanish ones out to ~11 km
    const fr = Array.from({ length: 200 }, (_, i) => station(`fr-${i}`, (i + 1) * 0.001))
    const es = Array.from({ length: 200 }, (_, i) => station(`es-${i}`, -(i + 1) * 0.0005))
    const onCapped = vi.fn()

    const merged = await autoOver({ fr, es, ad: [], pt: [] }).getStationsNear(CENTER, 25, { onCapped })

    expect(merged).toHaveLength(300)
    const furthestKept = Math.max(
      ...merged.map((st) => haversineKm(CENTER, { lat: st.lat, lng: st.lng })),
    )
    expect(onCapped).toHaveBeenCalledTimes(1)
    expect(onCapped).toHaveBeenCalledWith(furthestKept)
    expect(furthestKept).toBeLessThan(25)
  })

  it('reports nothing when the merge fits under the cap', async () => {
    const fr = Array.from({ length: 100 }, (_, i) => station(`fr-${i}`, (i + 1) * 0.001))
    const onCapped = vi.fn()

    await autoOver({ fr, es: [], ad: [], pt: [] }).getStationsNear(CENTER, 25, { onCapped })

    expect(onCapped).not.toHaveBeenCalled()
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

  it('flags a merge a source failed out of as incomplete', async () => {
    const onIncomplete = vi.fn()
    await mergeAsTheyLand(
      [Promise.reject(new Error('cartociudad down')), Promise.resolve([place('Toulouse')])],
      undefined,
      onIncomplete,
    )
    expect(onIncomplete).toHaveBeenCalledTimes(1)
  })

  it('does not flag a merge every source answered, empty lists included', async () => {
    const onIncomplete = vi.fn()
    await mergeAsTheyLand(
      [Promise.resolve([]), Promise.resolve([place('Toulouse')])],
      undefined,
      onIncomplete,
    )
    expect(onIncomplete).not.toHaveBeenCalled()
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

describe('two-step geocoders — a failed resolve step', () => {
  /** `fetch` answering from a URL → body table; a missing entry is an outage. */
  const stubFetch = (answer: (url: string) => unknown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const body = answer(String(input))
        if (body === undefined) throw new Error('timeout')
        return { ok: true, json: async () => body }
      }),
    )
  }

  afterEach(() => vi.unstubAllGlobals())

  const candidates = [
    { address: 'Girona', type: 'Municipio', province: 'Girona' },
    { address: 'Gironella', type: 'Municipio', province: 'Barcelona' },
  ]

  it('CartoCiudad throws when every find call failed, instead of answering « no result »', async () => {
    stubFetch((url) => (url.includes('/candidates') ? candidates : undefined))
    await expect(new CartoCiudadGeocodeProvider().search('giron')).rejects.toThrow('find failed')
  })

  it('CartoCiudad returns what resolved and flags the list as incomplete', async () => {
    stubFetch((url) => {
      if (url.includes('/candidates')) return candidates
      return url.includes('q=Girona&') ? { lat: 41.98, lng: 2.82 } : undefined
    })
    const onIncomplete = vi.fn()
    const res = await new CartoCiudadGeocodeProvider().search('giron', { onIncomplete })
    expect(res.map((r) => r.label)).toEqual(['Girona'])
    expect(onIncomplete).toHaveBeenCalledTimes(1)
  })

  it('CartoCiudad stays silent when find answers without a point', async () => {
    stubFetch((url) => (url.includes('/candidates') ? candidates : { lat: 0, lng: 0 }))
    const onIncomplete = vi.fn()
    expect(await new CartoCiudadGeocodeProvider().search('giron', { onIncomplete })).toEqual([])
    expect(onIncomplete).not.toHaveBeenCalled()
  })

  const suggestions = { suggestions: [{ text: 'Encamp, Encamp', magicKey: 'k1' }] }

  it('the Andorran geocoder throws when every resolve call failed', async () => {
    stubFetch((url) => (url.includes('/suggest') ? suggestions : undefined))
    await expect(new AdGeocodeProvider().search('encamp')).rejects.toThrow('resolve failed')
  })

  it('the Andorran geocoder flags a list one locator is missing from', async () => {
    stubFetch((url) => {
      if (url.includes('LocatorIDE')) return undefined
      if (url.includes('/suggest')) return suggestions
      return { candidates: [{ location: { x: 1.58, y: 42.53 } }] }
    })
    const onIncomplete = vi.fn()
    const res = await new AdGeocodeProvider().search('encamp', { onIncomplete })
    expect(res.map((r) => r.label)).toEqual(['Encamp'])
    expect(onIncomplete).toHaveBeenCalledTimes(1)
  })
})
