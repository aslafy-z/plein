import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AutoStationsProvider,
  FrGeocodeProvider,
  MergedGeocodeProvider,
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
import type { GeocodeProvider, GeocodeResult, Station } from '../types'

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

describe('MergedGeocodeProvider — naming what did not answer', () => {
  const place = (label: string): GeocodeResult => ({
    label,
    sublabel: '',
    point: { lat: 43.6, lng: 1.44 },
    kind: 'locality',
  })
  const answering = (label: string): GeocodeProvider => ({ search: async () => [place(label)] })
  const down: GeocodeProvider = {
    search: async () => {
      throw new Error('504')
    },
  }

  it('names the countries whose source failed, in display order', async () => {
    const onIncomplete = vi.fn()
    const merged = new MergedGeocodeProvider([
      { country: 'fr', provider: down },
      { country: 'ad', provider: answering('Encamp') },
      { country: 'pt', provider: answering('Coimbra') },
      { country: 'es', provider: down },
    ])
    const res = await merged.search('qualquer', { onIncomplete })
    expect(res.map((r) => r.label)).toEqual(['Encamp', 'Coimbra'])
    expect(onIncomplete).toHaveBeenCalledTimes(1)
    expect(onIncomplete).toHaveBeenCalledWith(['fr', 'es'])
  })

  it('names nobody when a source only lost part of its own list', async () => {
    const onIncomplete = vi.fn()
    const partial: GeocodeProvider = {
      search: async (_q, opts) => {
        opts?.onIncomplete?.()
        return [place('Girona')]
      },
    }
    await new MergedGeocodeProvider([
      { country: 'fr', provider: answering('Toulouse') },
      { country: 'es', provider: partial },
    ]).search('qualquer', { onIncomplete })
    expect(onIncomplete).toHaveBeenCalledWith([])
  })

  it('stays silent when every source answered', async () => {
    const onIncomplete = vi.fn()
    await new MergedGeocodeProvider([{ country: 'fr', provider: answering('Toulouse') }]).search(
      'toulouse',
      { onIncomplete },
    )
    expect(onIncomplete).not.toHaveBeenCalled()
  })
})

describe('MergedGeocodeProvider — naming what is still out', () => {
  const place = (label: string): GeocodeResult => ({
    label,
    sublabel: '',
    point: { lat: 43.6, lng: 1.44 },
    kind: 'locality',
  })
  /** A geocoder on a leash: it answers (or fails) when the test says so */
  const leashed = () => {
    let settle!: (value: GeocodeResult[]) => void
    let fail!: (reason: unknown) => void
    const promise = new Promise<GeocodeResult[]>((resolve, reject) => {
      settle = resolve
      fail = reject
    })
    const provider: GeocodeProvider = { search: () => promise }
    return { provider, settle, fail }
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('names every country at the start, then drops each one as it concludes', async () => {
    const fr = leashed()
    const es = leashed()
    const pt = leashed()
    const waiting: string[][] = []
    const search = new MergedGeocodeProvider([
      { country: 'fr', provider: fr.provider },
      { country: 'es', provider: es.provider },
      { country: 'pt', provider: pt.provider },
    ]).search('qualquer', { onPending: (countries) => waiting.push([...countries]) })

    expect(waiting).toEqual([['fr', 'es', 'pt']])
    es.settle([place('Girona')])
    await flush()
    expect(waiting[waiting.length - 1]).toEqual(['fr', 'pt'])
    // A failure concludes a source too: it is no longer awaited
    fr.fail(new Error('504'))
    await flush()
    expect(waiting[waiting.length - 1]).toEqual(['pt'])
    pt.settle([place('Coimbra')])
    await search
    expect(waiting[waiting.length - 1]).toEqual([])
  })

  it('updates the waiting list before publishing the rows of the source that landed', async () => {
    const fr = leashed()
    const es = leashed()
    const events: string[] = []
    const search = new MergedGeocodeProvider([
      { country: 'fr', provider: fr.provider },
      { country: 'es', provider: es.provider },
    ]).search('qualquer', {
      onPending: (countries) => events.push(`pending:${countries.join(',')}`),
      onPartial: (res) => events.push(`rows:${res.map((r) => r.label).join(',')}`),
    })
    fr.settle([place('Toulouse')])
    await flush()
    expect(events).toEqual(['pending:fr,es', 'pending:es', 'rows:Toulouse'])
    es.settle([])
    await search
  })

  it('keeps the given order when the home country is asked first', async () => {
    const fr = leashed()
    const pt = leashed()
    const waiting: string[][] = []
    const search = new MergedGeocodeProvider([
      { country: 'fr', provider: fr.provider, covers: () => false },
      { country: 'pt', provider: pt.provider, covers: () => true },
    ]).search('valen', {
      near: { lat: 38.7, lng: -9.1 },
      onPending: (countries) => waiting.push([...countries]),
    })
    expect(waiting).toEqual([['fr', 'pt']])
    fr.settle([])
    pt.settle([])
    await search
  })
})

describe('MergedGeocodeProvider — the country the map looks at', () => {
  const place = (label: string): GeocodeResult => ({
    label,
    sublabel: '',
    point: { lat: 40, lng: -8 },
    kind: 'locality',
  })
  const merged = () =>
    new MergedGeocodeProvider([
      { country: 'fr', provider: { search: async () => [place('Valence')] }, covers: (p) => p.lng > 0 },
      { country: 'pt', provider: { search: async () => [place('Valença')] }, covers: (p) => p.lng < 0 },
    ])

  it('keeps the given order when the map is nowhere in particular', async () => {
    expect((await merged().search('valen')).map((r) => r.label)).toEqual(['Valence', 'Valença'])
  })

  it('puts the home country first', async () => {
    const res = await merged().search('valen', { near: { lat: 38.7, lng: -9.1 } })
    expect(res.map((r) => r.label)).toEqual(['Valença', 'Valence'])
  })

  it('still names the missing countries in the order they were given', async () => {
    const onIncomplete = vi.fn()
    const down: GeocodeProvider = {
      search: async () => {
        throw new Error('504')
      },
    }
    await new MergedGeocodeProvider([
      { country: 'fr', provider: down, covers: () => false },
      { country: 'pt', provider: { search: async () => [place('Valença')] }, covers: () => true },
      { country: 'es', provider: down, covers: () => false },
    ]).search('valen', { near: { lat: 38.7, lng: -9.1 }, onIncomplete })
    expect(onIncomplete).toHaveBeenCalledWith(['fr', 'es'])
  })
})

describe('FrGeocodeProvider — a backup when the Géoplateforme is down', () => {
  /** `fetch` answering per host and index; `undefined` is an outage */
  const stubFetch = (answer: (url: string) => unknown) => {
    const mock = vi.fn(async (input: unknown) => {
      const body = answer(String(input))
      if (body === undefined) return { ok: false, status: 504, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => body }
    })
    vi.stubGlobal('fetch', mock)
    return mock
  }

  afterEach(() => vi.unstubAllGlobals())

  const ban = {
    features: [
      {
        geometry: { coordinates: [7.27, 43.7] },
        properties: { label: 'Nice', context: '06, Alpes-Maritimes', type: 'municipality' },
      },
    ],
  }
  const poi = {
    features: [
      {
        geometry: { coordinates: [7.21, 43.66] },
        properties: { toponym: "Aéroport de Nice-Côte d'Azur", category: ['aérodrome'], city: ['Nice'] },
      },
    ],
  }
  const photon = {
    features: [
      {
        geometry: { coordinates: [7.26, 43.7] },
        properties: {
          countrycode: 'FR',
          type: 'house',
          housenumber: '4',
          street: 'Rue Pasteur',
          postcode: '06000',
          city: 'Nice',
          county: 'Alpes-Maritimes',
        },
      },
    ],
  }
  const isPhoton = (url: string) => url.includes('photon')

  it('does not ask the backup while the Géoplateforme answers', async () => {
    const mock = stubFetch((url) => (isPhoton(url) ? photon : url.includes('index=poi') ? poi : ban))
    const onIncomplete = vi.fn()
    const res = await new FrGeocodeProvider().search('nice', { onIncomplete })
    expect(res.map((r) => r.label)).toEqual(['Nice', "Aéroport de Nice-Côte d'Azur"])
    expect(mock.mock.calls.some(([url]) => isPhoton(String(url)))).toBe(false)
    expect(onIncomplete).not.toHaveBeenCalled()
  })

  it('answers from the backup when both indexes are down, as a complete answer', async () => {
    stubFetch((url) => (isPhoton(url) ? photon : undefined))
    const onIncomplete = vi.fn()
    const res = await new FrGeocodeProvider().search('4 rue pasteur nice', { onIncomplete })
    expect(res).toEqual([
      {
        label: '4 Rue Pasteur',
        sublabel: '06000 Nice, Alpes-Maritimes',
        point: { lat: 43.7, lng: 7.26 },
        kind: 'address',
      },
    ])
    // The backup covers named places too: nothing is missing from the list
    expect(onIncomplete).not.toHaveBeenCalled()
  })

  it('asks the backup inside metropolitan France', async () => {
    const mock = stubFetch((url) => (isPhoton(url) ? photon : undefined))
    await new FrGeocodeProvider().search('4 rue pasteur nice')
    const url = String(mock.mock.calls.map(([u]) => String(u)).find(isPhoton))
    expect(url).toContain('bbox=-5.3%2C41.2%2C9.7%2C51.2')
  })

  it('flags the list when only the points of interest are missing', async () => {
    const mock = stubFetch((url) => (url.includes('index=address') ? ban : undefined))
    const onIncomplete = vi.fn()
    const res = await new FrGeocodeProvider().search('nice', { onIncomplete })
    expect(res.map((r) => r.label)).toEqual(['Nice'])
    expect(onIncomplete).toHaveBeenCalledTimes(1)
    expect(mock.mock.calls.some(([url]) => isPhoton(String(url)))).toBe(false)
  })

  it('fails when the backup is down too', async () => {
    stubFetch(() => undefined)
    await expect(new FrGeocodeProvider().search('nice')).rejects.toThrow()
  })
})

