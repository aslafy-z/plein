import { describe, expect, it } from 'vitest'
import type { FuelId, Route, RouteStation, Station } from '../data/types'
import {
  beginGeometry,
  commitCorridor,
  commitGeometry,
  initialRouteState,
} from './routePipeline'
import { INDEPENDENT_BRAND_ID } from '../lib/brandIcons'
import {
  answersAdBlue,
  CROW_ROAD_FACTOR,
  effectiveFuel,
  effectivePrice,
  fuelRange,
  priceCents,
  priceTier,
  roadReachOf,
  selectAdBlueAnswerable,
  selectAutonomy,
  selectByPrice,
  selectCheapest,
  selectDeals,
  selectFocusStation,
  selectMapStations,
  selectPriceRange,
  selectPriceStats,
  selectSorted,
  selectReachCandidates,
  selectRecommended,
  selectRouteAnalysis,
  selectVisible,
  selectZoneBrandCounts,
  selectZoneDelta,
  selectZoneFuels,
  sortFavoriteRows,
  type AppStore,
} from './store'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const BASE = { lat: 43.6047, lng: 1.4442 }
/** Point `km` kilometres north of the base position (1° lat ≈ 111 km) */
const north = (km: number) => ({ lat: BASE.lat + km / 111, lng: BASE.lng })

function station(over: Partial<Station> & { id: string }): Station {
  return {
    name: `Station ${over.id}`,
    init: 'ST',
    lat: BASE.lat,
    lng: BASE.lng,
    address: '',
    city: '',
    prices: {},
    tags: [],
    services: [],
    highway: false,
    ...over,
  }
}

const diesel = (value: number) => ({ diesel: { value } })

/** Minimal AppStore stub — only the fields the pure selectors read. */
function app(over: Partial<AppStore> = {}): AppStore {
  return {
    fuel: 'diesel' as FuelId,
    radius: 5,
    brandSel: [],
    serviceTags: {},
    sort: 'price',
    userPos: BASE,
    searchPos: BASE,
    focusStationId: null,
    stations: { status: 'ready', data: [], activeSource: 'demo', refreshing: false },
    roadReach: {},
    consumption: 6.5,
    tank: 50,
    startTankPct: 70,
    routeMode: 'balanced',
    plannedStops: {},
    routeState: initialRouteState,
    ...over,
  } as AppStore
}

// ── Fuel substitution ────────────────────────────────────────────────────────
describe('effectiveFuel', () => {
  it('lets Spanish and Andorran SP95 stand in for E10, never the reverse', () => {
    const esp = station({ id: 'esp-1', prices: { unleaded95: { value: 1.6 } } })
    const and = station({ id: 'and-1', prices: { unleaded95: { value: 1.5 } } })
    const fra = station({ id: 'fra-1', prices: { unleaded95: { value: 1.7 } } })
    expect(effectiveFuel(esp, 'e10')).toBe('unleaded95')
    expect(effectiveFuel(and, 'e10')).toBe('unleaded95')
    // French stations list both fuels separately — no substitution
    expect(effectiveFuel(fra, 'e10')).toBeNull()
    // An SP95-only engine must not be sent to an E10 pump
    const espE10 = station({ id: 'esp-2', prices: { e10: { value: 1.55 } } })
    expect(effectiveFuel(espE10, 'unleaded95')).toBeNull()
    expect(effectivePrice(esp, 'e10')?.value).toBe(1.6)
  })
})

// ── Comparison range (fiche : « le + bas », économie sur un plein) ────────────
describe('fuelRange', () => {
  it('compares E10 on the Spanish SP95 prices instead of coming back empty', () => {
    const zone = [
      station({ id: 'esp-1', prices: { unleaded95: { value: 1.6 } } }),
      station({ id: 'esp-2', prices: { unleaded95: { value: 1.75 } } }),
      station({ id: 'esp-3', prices: { unleaded95: { value: 1.68 }, diesel: { value: 1.5 } } }),
    ]
    // Not one Spanish pump serves E10 — reading the raw prices left the fiche
    // with no maximum and a 0,00 € saving on every station
    expect(zone.every((s) => s.prices.e10 == null)).toBe(true)
    expect(fuelRange(zone, 'e10')).toEqual({ min: 1.6, max: 1.75 })
    // (1,75 − 1,60) × 50 L = 7,50 € saved on a tank at the cheapest station
    expect((fuelRange(zone, 'e10')!.max - 1.6) * 50).toBeCloseTo(7.5, 5)
  })

  it('holds a single-station range and nulls out a fuel nobody sells', () => {
    const zone = [station({ id: 'fra-1', prices: diesel(1.82) })]
    expect(fuelRange(zone, 'diesel')).toEqual({ min: 1.82, max: 1.82 })
    // No substitution towards SP95 in France — the E10 range stays empty
    expect(fuelRange(zone, 'e10')).toBeNull()
    expect(fuelRange([], 'diesel')).toBeNull()
  })
})

// ── Zone filtering ───────────────────────────────────────────────────────────
describe('selectVisible', () => {
  const zone = [
    station({ id: 'near', ...north(1), prices: diesel(1.7), tags: ['open24h', 'carWash'], brand: 'Intermarché' }),
    station({ id: 'mid', ...north(4), prices: diesel(1.8), tags: ['open24h'] }),
    station({ id: 'far', ...north(12), prices: diesel(1.6), tags: ['open24h', 'carWash'] }),
    station({ id: 'nofuel', ...north(2), prices: { e10: { value: 1.8 } } }),
  ]

  it('applies the radius, the fuel and every selected service tag', () => {
    const base = app({ stations: { status: 'ready', data: zone, activeSource: 'demo', refreshing: false } })
    expect(selectVisible(base).map((s) => s.id)).toEqual(['near', 'mid'])
    // radius widened → the cheap far station joins
    expect(selectVisible(app({ ...base, radius: 25 })).map((s) => s.id)).toContain('far')
    // service tags compose with AND
    expect(
      selectVisible(app({ ...base, serviceTags: { open24h: true, carWash: true } })).map((s) => s.id),
    ).toEqual(['near'])
  })

  it('keeps stations whose source never publishes AdBlue, drops those that declare none', () => {
    // esp/and declare the products on sale; fra/prt never mention AdBlue, so
    // their silence is « never asked », not « not sold ». Demo ids sit outside
    // the scheme and the fixture speaks the app's own ids, so they answer.
    const mixed = [
      station({ id: 'esp-1', ...north(1), prices: diesel(1.7), tags: ['adBlue'] }),
      station({ id: 'esp-2', ...north(1), prices: diesel(1.7) }),
      station({ id: 'and-1', ...north(1), prices: diesel(1.7), tags: ['adBlue'] }),
      station({ id: 'fra-1', ...north(1), prices: diesel(1.7) }),
      station({ id: 'prt-1', ...north(1), prices: diesel(1.7) }),
      station({ id: 'demo1', ...north(1), prices: diesel(1.7) }),
    ]
    const base = app({
      stations: { status: 'ready', data: mixed, activeSource: 'auto', refreshing: false },
    })
    expect(selectVisible(base).map((s) => s.id)).toHaveLength(6)
    expect(selectVisible(app({ ...base, serviceTags: { adBlue: true } })).map((s) => s.id)).toEqual([
      'esp-1',
      'and-1',
      'fra-1',
      'prt-1',
    ])
  })

  it('composes AdBlue with the other tags, which stay strict', () => {
    const data = [
      station({ id: 'esp-1', ...north(1), prices: diesel(1.7), tags: ['adBlue', 'carWash'] }),
      station({ id: 'esp-2', ...north(1), prices: diesel(1.7), tags: ['adBlue'] }),
      // Unknown for AdBlue, but « Lavage » is a tag every source can answer
      station({ id: 'fra-1', ...north(1), prices: diesel(1.7), tags: ['carWash'] }),
      station({ id: 'fra-2', ...north(1), prices: diesel(1.7) }),
    ]
    const base = app({
      stations: { status: 'ready', data, activeSource: 'auto', refreshing: false },
    })
    expect(
      selectVisible(app({ ...base, serviceTags: { adBlue: true, carWash: true } })).map((s) => s.id),
    ).toEqual(['esp-1', 'fra-1'])
  })

  it('selectAdBlueAnswerable gates the chip on what is actually loaded', () => {
    const ready = (data: Station[]) =>
      app({ stations: { status: 'ready', data, activeSource: 'auto', refreshing: false } })
    expect(selectAdBlueAnswerable(ready([]))).toBe(false)
    expect(
      selectAdBlueAnswerable(ready([station({ id: 'fra-1' }), station({ id: 'prt-1' })])),
    ).toBe(false)
    expect(selectAdBlueAnswerable(ready([station({ id: 'fra-1' }), station({ id: 'esp-1' })]))).toBe(
      true,
    )
    expect(selectAdBlueAnswerable(ready([station({ id: 'and-1' })]))).toBe(true)
    // Demo ids are outside the country scheme and the fixture does declare it
    expect(selectAdBlueAnswerable(ready([station({ id: 'su' })]))).toBe(true)
  })

  it('answersAdBlue reads the country out of the station id', () => {
    expect(answersAdBlue(station({ id: 'esp-1' }))).toBe(true)
    expect(answersAdBlue(station({ id: 'and-1' }))).toBe(true)
    expect(answersAdBlue(station({ id: 'fra-1' }))).toBe(false)
    expect(answersAdBlue(station({ id: 'prt-1' }))).toBe(false)
    expect(answersAdBlue(station({ id: 'su' }))).toBe(true)
  })

  it('filters brands by group, brandless stations passing as the « independent » group', () => {
    const base = app({ stations: { status: 'ready', data: zone, activeSource: 'demo', refreshing: false } })
    expect(selectVisible(app({ ...base, brandSel: ['Intermarché'] })).map((s) => s.id)).toEqual(['near'])
    expect(
      selectVisible(app({ ...base, brandSel: [INDEPENDENT_BRAND_ID] })).map((s) => s.id),
    ).toEqual(['mid'])
  })

  it('counts brand groups over the fuel/service filters, ignoring only the brand selection', () => {
    const brands = [
      station({ id: 'i1', ...north(1), prices: diesel(1.7), tags: ['carWash'], brand: 'Intermarché' }),
      // Same brand, but sells no diesel → must not inflate the Intermarché row
      station({ id: 'i2', ...north(1), prices: { e85: { value: 0.9 } }, brand: 'Intermarché' }),
      // Right fuel, no « Lavage » → drops out as soon as the service is asked
      station({ id: 'i3', ...north(2), prices: diesel(1.8), brand: 'Intermarché' }),
      station({ id: 's1', ...north(2), prices: diesel(1.9), tags: ['carWash'], brand: 'Shell' }),
      // Out of the radius → counted nowhere
      station({ id: 's2', ...north(12), prices: diesel(1.6), tags: ['carWash'], brand: 'Shell' }),
      station({ id: 'x1', ...north(3), prices: diesel(1.75), tags: ['carWash'] }),
    ]
    const base = app({
      stations: { status: 'ready', data: brands, activeSource: 'demo', refreshing: false },
    })
    expect([...selectZoneBrandCounts(base).entries()].sort()).toEqual([
      ['Intermarché', 2],
      ['Shell', 1],
      [INDEPENDENT_BRAND_ID, 1],
    ])
    // A selected brand never shrinks the other rows…
    expect([...selectZoneBrandCounts(app({ ...base, brandSel: ['Shell'] })).entries()].sort()).toEqual([
      ['Intermarché', 2],
      ['Shell', 1],
      [INDEPENDENT_BRAND_ID, 1],
    ])
    // …but a service filter does, and every row stays reachable
    const washed = app({ ...base, serviceTags: { carWash: true } })
    expect([...selectZoneBrandCounts(washed).entries()].sort()).toEqual([
      ['Intermarché', 1],
      ['Shell', 1],
      [INDEPENDENT_BRAND_ID, 1],
    ])
    // A fuel nobody serves here empties the list rather than promising rows
    expect([...selectZoneBrandCounts(app({ ...base, fuel: 'e85' })).entries()]).toEqual([
      ['Intermarché', 1],
    ])
    // The count of a group always equals what selecting it yields
    for (const [group, n] of selectZoneBrandCounts(washed)) {
      expect(selectVisible(app({ ...washed, brandSel: [group] })).length).toBe(n)
    }
  })

  it('selectZoneFuels only names fuels the pumps actually serve (no SP95 fallback)', () => {
    const esp = station({ id: 'esp-9', ...north(1), prices: { unleaded95: { value: 1.6 } } })
    const a = app({ stations: { status: 'ready', data: [esp], activeSource: 'esp', refreshing: false } })
    expect(selectZoneFuels(a)).toEqual(['unleaded95'])
  })

  it('selectZoneFuels lists every fuel of the zone, in the fuel order, filters applied', () => {
    const data = [
      station({ id: 'a', ...north(1), prices: { diesel: { value: 1.7 }, e85: { value: 0.9 } }, brand: 'Shell' }),
      station({ id: 'b', ...north(2), prices: { unleaded98: { value: 1.9 } }, tags: ['carWash'] }),
      // Out of the radius — its GPL must not join the list
      station({ id: 'c', ...north(30), prices: { lpg: { value: 0.99 } } }),
    ]
    const base = app({ stations: { status: 'ready', data, activeSource: 'demo', refreshing: false } })
    expect(selectZoneFuels(base)).toEqual(['diesel', 'unleaded98', 'e85'])
    // …and the brand/service filters narrow it like any other zone selector
    expect(selectZoneFuels(app({ ...base, brandSel: ['Shell'] }))).toEqual(['diesel', 'e85'])
    expect(selectZoneFuels(app({ ...base, serviceTags: { carWash: true } }))).toEqual(['unleaded98'])
  })
})

// ── Memoization ──────────────────────────────────────────────────────────────
describe('selector memoization', () => {
  /** A store whose `stations.data` counts how many times it is walked */
  function counting(data: Station[]) {
    const counter = { passes: 0 }
    const stations = {
      status: 'ready',
      get data() {
        counter.passes++
        return data
      },
      activeSource: 'demo',
      refreshing: false,
    } as AppStore['stations']
    return { store: app({ stations }), counter }
  }

  const ZONE = [
    station({ id: 'near', ...north(1), prices: diesel(1.7), brand: 'Shell' }),
    station({ id: 'mid', ...north(3), prices: diesel(1.8) }),
    station({ id: 'off-map', ...north(30), prices: diesel(1.6) }),
  ]

  it('walks stations.data once per store identity, whatever the screen asks for', () => {
    const { store, counter } = counting(ZONE)
    // Roughly what one MapSheet + MapCanvas render pass costs
    selectVisible(store)
    selectSorted(store)
    selectCheapest(store)
    selectRecommended(store)
    selectMapStations(store)
    selectPriceStats(store)
    selectPriceRange(store)
    selectDeals(store)
    selectZoneFuels(store)
    selectZoneBrandCounts(store)
    selectFocusStation(store)
    expect(counter.passes).toBe(1)
  })

  it('hands back the same array so callers can compare by reference', () => {
    const { store } = counting(ZONE)
    expect(selectVisible(store)).toBe(selectVisible(store))
    expect(selectMapStations(store)).toBe(selectMapStations(store))
    expect(selectPriceStats(store)).toBe(selectPriceStats(store))
  })

  it('recomputes for a new store object — the cache never outlives its inputs', () => {
    const { store, counter } = counting(ZONE)
    expect(selectVisible(store).map((s) => s.id)).toEqual(['near', 'mid'])
    // Same data, widened radius: a fresh store object is a fresh answer
    const wider = app({ ...store, radius: 40 })
    expect(selectVisible(wider).map((s) => s.id)).toEqual(['near', 'mid', 'off-map'])
    expect(counter.passes).toBe(2)
  })
})

// ── Ranking & recommendation ─────────────────────────────────────────────────
describe('selectByPrice / selectRecommended', () => {
  it('ranks at displayed cent precision, nearest first inside a cent', () => {
    // 1,896 and 1,904 both read « 1,90 € » — the nearest must come first
    const data = [
      station({ id: 'far-sub-cent', ...north(3.3), prices: diesel(1.896) }),
      station({ id: 'near', ...north(0.9), prices: diesel(1.904) }),
    ]
    const a = app({ stations: { status: 'ready', data, activeSource: 'demo', refreshing: false } })
    expect(selectByPrice(a).map((s) => s.id)).toEqual(['near', 'far-sub-cent'])
    expect(selectRecommended(a)?.id).toBe('near')
  })

  it('crowns the best deal, not the best sticker price, once the détour is paid', () => {
    // 1,86 € at ~15.9 km vs 1,89 € at ~11.8 km (6,5 L/100 km, 50 L):
    // effective 1,940 vs 1,950 €/L → within the 1-ct tie margin → NEAREST wins
    const data = [
      station({ id: 'far-cheap', ...north(15.9), prices: diesel(1.86) }),
      station({ id: 'near-deal', ...north(11.8), prices: diesel(1.89) }),
      station({ id: 'filler', ...north(1), prices: diesel(1.99) }),
    ]
    const a = app({ radius: 25, stations: { status: 'ready', data, activeSource: 'demo', refreshing: false } })
    // The sticker ranking still puts the cheapest first…
    expect(selectByPrice(a)[0].id).toBe('far-cheap')
    // …but the recommendation counts the fuel burnt to get there
    expect(selectRecommended(a)?.id).toBe('near-deal')
  })

  it('ranks on road distances when the reach matrix knows the stations', () => {
    // « bridge » looks closest as the crow flies (2,2 km) and is sticker-
    // cheapest, but the river makes it 12 km by road; « direct » is 3,5 km.
    // Effective: 1,85 × 50/(50 − 1,56) ≈ 1,910 vs 1,87 × 50/(50 − 0,455) ≈ 1,887
    const data = [
      station({ id: 'bridge', ...north(2.2), prices: diesel(1.85) }),
      station({ id: 'direct', ...north(3.3), prices: diesel(1.87) }),
    ]
    const stations = { status: 'ready', data, activeSource: 'demo', refreshing: false } as AppStore['stations']
    // Crow-flies fallback (no matrix): the bridge station looks like the deal
    expect(selectRecommended(app({ stations }))?.id).toBe('bridge')
    const withRoads = app({
      stations,
      roadReach: {
        bridge: { distanceKm: 12, durationMin: 15 },
        direct: { distanceKm: 3.5, durationMin: 6 },
      },
    })
    expect(selectRecommended(withRoads)?.id).toBe('direct')
    // The displayed distance is the road one, not the crow-flies estimate
    expect(selectVisible(withRoads).find((s) => s.id === 'direct')?.distKm).toBe(3.5)
  })

  it('never ranks a matrix-covered station against a raw crow-flies one', () => {
    // The matrix only covers the nearest stations: « measured » is 3 km out
    // as the crow flies and known to be 3,5 km by road, « missed » sits 24 km
    // out with no matrix row. On raw crow-flies « missed » reads ≈ 1,866 €/L,
    // within a cent of the measured station's 1,877 — but 24 km of straight
    // line is ~31 road km, and at that scale it loses (≈ 1,904 €/L).
    const data = [
      station({ id: 'measured', ...north(3), prices: diesel(1.86) }),
      station({ id: 'missed', ...north(24), prices: diesel(1.75) }),
    ]
    const a = app({
      radius: 25,
      stations: { status: 'ready', data, activeSource: 'demo', refreshing: false },
      roadReach: { measured: { distanceKm: 3.5, durationMin: 6 } },
    })
    expect(selectRecommended(a)?.id).toBe('measured')

    const missed = selectVisible(a).find((s) => s.id === 'missed')!
    // …because the uncovered station is compared on the road scale too
    expect(missed.distKm).toBeCloseTo(missed.searchKm * CROW_ROAD_FACTOR, 10)
    // The radius filter stays crow-flies: 24 km out is still inside the 25 km
    // search area even though the road estimate reads ~31 km
    expect(missed.searchKm).toBeLessThan(25)
    expect(missed.distKm).toBeGreaterThan(25)
  })

  it('still crowns the nearest station when no round trip fits the tank', () => {
    // A tiny tank on a wide zone: every effective price is Infinity — the
    // card must fall back to the nearest station, not read as an empty zone
    const data = [
      station({ id: 'far', ...north(24), prices: diesel(1.55) }),
      station({ id: 'nearest', ...north(21), prices: diesel(1.95) }),
    ]
    const a = app({
      radius: 25,
      tank: 4,
      consumption: 10,
      stations: { status: 'ready', data, activeSource: 'demo', refreshing: false },
      roadReach: {
        far: { distanceKm: 24, durationMin: 20 },
        nearest: { distanceKm: 21, durationMin: 18 },
      },
    })
    expect(selectRecommended(a)?.id).toBe('nearest')
  })
})

// ── Zone list order ──────────────────────────────────────────────────────────
describe('selectSorted', () => {
  const data = [
    station({ id: 'far-cheap', ...north(12), prices: diesel(1.85) }),
    station({ id: 'near-deal', ...north(3.5), prices: diesel(1.87) }),
    station({ id: 'filler', ...north(1), prices: diesel(1.99) }),
  ]
  const stations = { status: 'ready', data, activeSource: 'demo', refreshing: false } as AppStore['stations']

  it('« Recommandé » ranks on the effective price, not the sticker', () => {
    // 1,85 € at ~15.6 road km vs 1,87 € at ~4.6 road km (6,5 L/100 km, 50 L):
    // effective ≈ 1,928 vs 1,892 €/L — the sticker order flips
    const a = app({ radius: 25, sort: 'recommended', stations })
    expect(selectSorted(a).map((s) => s.id)).toEqual(['near-deal', 'far-cheap', 'filler'])
    // « Prix » and « Distance » keep their own orders
    expect(selectSorted(app({ ...a, sort: 'price' })).map((s) => s.id)).toEqual([
      'far-cheap',
      'near-deal',
      'filler',
    ])
    expect(selectSorted(app({ ...a, sort: 'distance' })).map((s) => s.id)).toEqual([
      'filler',
      'near-deal',
      'far-cheap',
    ])
  })

  it('sinks stations beyond a full tank round trip, nearest of them first', () => {
    // Tank 4 L at 10 L/100 km: unreachable beyond 20 road km. Both stranded
    // stations have no effective price — they trail the reachable one in
    // distance order, whatever their stickers say
    const stranded = [
      station({ id: 'ok', ...north(2), prices: diesel(1.9) }),
      station({ id: 'stranded-far', ...north(30), prices: diesel(1.4) }),
      station({ id: 'stranded-near', ...north(25), prices: diesel(1.5) }),
    ]
    const a = app({
      radius: 45,
      tank: 4,
      consumption: 10,
      sort: 'recommended',
      stations: { status: 'ready', data: stranded, activeSource: 'demo', refreshing: false },
    })
    expect(selectSorted(a).map((s) => s.id)).toEqual(['ok', 'stranded-near', 'stranded-far'])
  })
})

// ── Road-distance scale ──────────────────────────────────────────────────────
describe('roadReachOf', () => {
  it('measures when the matrix covered the station, estimates otherwise', () => {
    expect(roadReachOf(10, { distanceKm: 12.4, durationMin: 21 })).toEqual({
      distKm: 12.4,
      driveMin: 21,
    })
    // No matrix row → crow-flies lifted onto the road scale, never raw
    const est = roadReachOf(10)
    expect(est.distKm).toBeCloseTo(10 * CROW_ROAD_FACTOR, 10)
    expect(est.driveMin).toBe(20)
    // A pump across the street still reads as a minute away
    expect(roadReachOf(0.1).driveMin).toBe(1)
  })
})

describe('selectReachCandidates', () => {
  it('keeps the nearest stations within the search radius, nearest first', () => {
    const data = [
      station({ id: 'far', ...north(9) }),
      station({ id: 'close', ...north(1) }),
      station({ id: 'mid', ...north(4) }),
    ]
    expect(selectReachCandidates(data, BASE).map((s) => s.id)).toEqual(['close', 'mid', 'far'])
  })

  it('comes back empty when every station sits beyond the search radius', () => {
    // Searching a faraway area: nothing is "near me" — no routing call is
    // worth it, and the caller must fall back to crow-flies rather than keep
    // the previous area's measurements (they were taken from another position)
    const data = [station({ id: 'a', ...north(40) }), station({ id: 'b', ...north(120) })]
    expect(selectReachCandidates(data, BASE)).toEqual([])
    expect(selectReachCandidates([], BASE)).toEqual([])
  })

  it('caps the set at one matrix call', () => {
    const data = Array.from({ length: 80 }, (_, i) =>
      station({ id: `s${i}`, ...north(20 - i * 0.1) }),
    )
    const picked = selectReachCandidates(data, BASE)
    expect(picked).toHaveLength(60)
    // …the 60 nearest, not the first 60 of the input
    expect(picked[0].id).toBe('s79')
  })
})

// ── Price tiers ──────────────────────────────────────────────────────────────
describe('selectPriceStats / priceTier', () => {
  const withData = (prices: number[], positions?: ReturnType<typeof north>[]) =>
    app({
      stations: {
        status: 'ready',
        data: prices.map((p, i) => station({ id: `s${i}`, ...(positions?.[i] ?? north(1)), prices: diesel(p) })),
        activeSource: 'demo',
        refreshing: false,
      },
    })

  it('widens the « bon plan » tier to the low-price cluster, tints the max tier', () => {
    const a = withData([1.6, 1.61, 1.62, 1.75, 1.76, 1.77, 1.78, 1.85, 1.85])
    const stats = selectPriceStats(a)!
    expect([1.6, 1.61, 1.62].map((p) => priceTier(p, stats))).toEqual(['deal', 'deal', 'deal'])
    expect(priceTier(1.75, stats)).toBe('mid')
    expect(priceTier(1.85, stats)).toBe('high')
  })

  it('judges tiers at displayed precision: same shown cent → same tier', () => {
    // dealMax ≈ 1,9001 falls INSIDE the displayed cent: 1,896 and 1,904 both
    // read « 1,90 € » and must share the deal tier
    const a = withData([1.872, 1.896, 1.904, 2.1, 2.15])
    const stats = selectPriceStats(a)!
    expect(priceTier(1.896, stats)).toBe('deal')
    expect(priceTier(1.904, stats)).toBe('deal')
    expect(priceTier(2.15, stats)).toBe('high')
  })

  it("keeps the circle's cheapest green without repainting the wider map", () => {
    // One lone 2,05 in the circle; cheaper stations ~30 km out on the map
    const a = withData(
      [2.05, 1.8, 1.81, 1.9, 2.1],
      [north(2), north(30), north(31), north(32), north(33)],
    )
    const stats = selectPriceStats(a)!
    expect(stats.zoneDealMax).toBeCloseTo(2.06, 10)
    // In the circle the zone floor applies; outside it must not
    expect(priceTier(2.05, stats, true)).toBe('deal')
    expect(priceTier(2.05, stats, false)).toBe('mid')
    expect(priceTier(1.9, stats, false)).toBe('mid')
    expect(priceTier(2.1, stats, false)).toBe('high')
  })

  it('selectDeals keeps the low-price cluster, and says nothing without a distribution', () => {
    const a = withData([1.6, 1.61, 1.75, 1.85])
    expect(selectDeals(a).map((s) => s.id)).toEqual(['s0', 's1'])
    // No station on the map → no distribution → nothing is a « bon plan »
    expect(selectPriceStats(app())).toBeNull()
    expect(selectDeals(app())).toEqual([])
  })
})

// ── « vs the zone » chip of the sheet card ───────────────────────────────────
describe('selectZoneDelta', () => {
  const withData = (prices: number[], positions: ReturnType<typeof north>[], over: Partial<AppStore> = {}) =>
    app({
      stations: {
        status: 'ready',
        data: prices.map((p, i) => station({ id: `s${i}`, ...positions[i], prices: diesel(p) })),
        activeSource: 'demo',
        refreshing: false,
      },
      ...over,
    })

  const shown = (a: AppStore, id: string) => selectMapStations(a).find((s) => s.id === id)!

  it("shows the zone spread on the circle's cheapest, the gap to it on the others", () => {
    const a = withData([1.7, 1.75, 1.9], [north(1), north(2), north(3)])
    // The cheapest saves the whole zone spread (« −0,20 €/L »)…
    expect(selectZoneDelta(a, shown(a, 's0'))?.best).toBe(true)
    expect(selectZoneDelta(a, shown(a, 's0'))?.amount).toBeCloseTo(0.2, 10)
    // …the others state what they cost more than it
    expect(selectZoneDelta(a, shown(a, 's1'))?.best).toBe(false)
    expect(selectZoneDelta(a, shown(a, 's1'))?.amount).toBeCloseTo(0.05, 10)
    expect(selectZoneDelta(a, shown(a, 's2'))?.amount).toBeCloseTo(0.2, 10)
  })

  it('compares at displayed precision, never a tenth-of-a-cent artifact', () => {
    // 1,896 and 1,904 both read « 1,90 € » — the chip must read « +0,00 »
    const a = withData([1.896, 1.904], [north(1), north(2)])
    expect(selectZoneDelta(a, shown(a, 's1'))).toEqual({ amount: 0, best: false })
  })

  it('says nothing when the search circle is empty', () => {
    // A tapped pin keeps its card even outside the radius (pins are not
    // radius-limited) — with no zone, « +1,67 €/L » would just be the price
    const a = withData([1.67], [north(30)])
    expect(selectPriceRange(a)).toBeNull()
    expect(selectZoneDelta(a, shown(a, 's0'))).toBeNull()
  })

  it('says nothing for a station selected outside a non-empty circle', () => {
    const a = withData([1.8, 1.6], [north(2), north(30)])
    expect(selectZoneDelta(a, shown(a, 's0'))).toEqual({ amount: 0, best: true })
    expect(selectZoneDelta(a, shown(a, 's1'))).toBeNull()
    expect(selectZoneDelta(a, null)).toBeNull()
  })
})

// ── Favoris sorting ──────────────────────────────────────────────────────────
describe('sortFavoriteRows', () => {
  const cfg = { consumption: 6.5, tank: 50 }
  const rows = [
    { id: 'far-cheap', price: 1.65, distKm: 7.4 }, // effective ≈ 1,682
    { id: 'near', price: 1.67, distKm: 0.9 }, // effective ≈ 1,674
    { id: 'unloaded', price: null, distKm: 2 },
  ]

  it('« Recommandé » counts the détour, « Prix » keeps the sticker order', () => {
    expect(sortFavoriteRows(rows, 'recommended', cfg).map((r) => r.id)).toEqual([
      'near',
      'far-cheap',
      'unloaded',
    ])
    expect(sortFavoriteRows(rows, 'price', cfg).map((r) => r.id)).toEqual([
      'far-cheap',
      'near',
      'unloaded',
    ])
    expect(sortFavoriteRows(rows, 'distance', cfg).map((r) => r.id)).toEqual([
      'near',
      'unloaded',
      'far-cheap',
    ])
  })

  it('never sends the user past what the tank round trip can cover', () => {
    // The linear detour model used to crown 1,53 € at 157 km over 2,20 € at
    // 3,7 km, and to rank stations hundreds of km out on a finite « effective
    // price » as if the tank could make the trip. Burning part of the tank
    // you came to buy is what the price must carry: 1,53 × 50/(50 − 20,4)
    // ≈ 2,58 €/L loses to 2,20 €/L next door, and a round trip past the
    // tank's range has no effective price at all — those rows sink together,
    // closest first.
    const stranded = [
      { id: 'far-cheap', price: 1.53, distKm: 156.8 },
      { id: 'next-door', price: 2.2, distKm: 3.7 },
      { id: 'in-town', price: 2.3, distKm: 9.3 },
      { id: 'out-of-range', price: 1.6, distKm: 670.5 },
      { id: 'other-region', price: 2.27, distKm: 445.8 },
      { id: 'abroad', price: 2.09, distKm: 1216.7 },
    ]
    expect(sortFavoriteRows(stranded, 'recommended', cfg).map((r) => r.id)).toEqual([
      'next-door',
      'in-town',
      'far-cheap',
      'other-region',
      'out-of-range',
      'abroad',
    ])
  })

  it('priceless rows sink to the bottom, closest first', () => {
    const blind = [
      { id: 'b', price: null, distKm: 9 },
      { id: 'a', price: null, distKm: 3 },
    ]
    expect(sortFavoriteRows(blind, 'price', cfg).map((r) => r.id)).toEqual(['a', 'b'])
    expect(sortFavoriteRows(blind, 'recommended', cfg).map((r) => r.id)).toEqual(['a', 'b'])
  })
})

// ── Route analysis ───────────────────────────────────────────────────────────
const routeStation = (
  id: string,
  price: number,
  kmAlong: number,
  detourMin: number,
): RouteStation => ({ ...station({ id, prices: diesel(price) }), kmAlong, detourMin })

const CORRIDOR: RouteStation[] = [
  routeStation('cheapest-far-detour', 1.63, 119, 7),
  routeStation('balanced', 1.66, 85, 2),
  routeStation('on-route-pricey', 1.84, 58, 0),
  routeStation('max', 1.9, 150, 3),
]

const ROUTE: Route = { distanceKm: 260, durationMin: 150, polyline: [] }
const ENDS = { from: 'Lyon', to: 'Nantes' }

/** A finished computation: geometry committed, then the corridor stops. */
const readyRouteState = commitCorridor(
  commitGeometry(beginGeometry(initialRouteState, 'k'), 'k', ROUTE, ENDS),
  'k',
  CORRIDOR,
)

const routeApp = (over: Partial<AppStore> = {}) =>
  app({
    routeState: readyRouteState,
    ...over,
  })

describe('selectAutonomy', () => {
  it('derives autonomy from tank × level ÷ consumption, with a ~20 % reserve', () => {
    expect(selectAutonomy(app())).toEqual({ autonomyKm: 538, limitKm: 430 })
    expect(selectAutonomy(app({ startTankPct: 10 }))).toEqual({ autonomyKm: 77, limitKm: 60 })
  })
})

describe('selectRouteAnalysis at the geometry stage', () => {
  // The corridor stage has not answered yet: the timeline still has to render
  // the trip, so the analysis must describe it without a single station.
  const geometryOnly = commitGeometry(beginGeometry(initialRouteState, 'k'), 'k', ROUTE, ENDS)

  it('describes the trip before any station is known', () => {
    const a = selectRouteAnalysis(app({ routeState: geometryOnly }))
    expect(a.stops).toEqual([])
    expect(a.recoId).toBeNull()
    expect(a.recoReason).toBeNull()
    expect(a.arrival).not.toBeNull()
    expect(a.tripLitres).toBeCloseTo(16.9, 10)
    expect(a.limitKm).toBe(430)
  })

  it('is unchanged by the provisional flag', () => {
    const stale = selectRouteAnalysis(
      app({ routeState: { ...readyRouteState, provisional: true } }),
    )
    const fresh = selectRouteAnalysis(routeApp())
    expect({ ...stale, arrival: null }).toEqual({ ...fresh, arrival: null })
  })
})

describe('selectRouteAnalysis', () => {
  it('each strategy crowns its own stop with its own justification', () => {
    const balanced = selectRouteAnalysis(routeApp())
    // 1,66 € + 2 min beats 1,63 € + 7 min once the détour minutes are priced
    expect(balanced.recoId).toBe('balanced')
    expect(balanced.recoReason).toEqual({ kind: 'balanced', saving: 12 })

    const price = selectRouteAnalysis(routeApp({ routeMode: 'price' }))
    expect(price.recoId).toBe('cheapest-far-detour')
    expect(price.recoReason).toEqual({ kind: 'lowestPrice', saving: 13.5 })

    const detour = selectRouteAnalysis(routeApp({ routeMode: 'detour' }))
    expect(detour.recoId).toBe('on-route-pricey')
    expect(detour.recoReason).toEqual({ kind: 'noDetour' })
  })

  it('a low departure tank forces a REACHABLE recommendation', () => {
    // 10 % of 50 L at 6,5 L/100 km → limit KM 60: only the on-route station
    // (KM 58) is reachable — the corridor-wide winners are beyond the limit
    const a = selectRouteAnalysis(routeApp({ startTankPct: 10 }))
    expect(a.needsStop).toBe(true)
    expect(a.limitKm).toBe(60)
    expect(a.recoId).toBe('on-route-pricey')
    expect(a.arrival).toEqual({ kind: 'autonomyShort', limitKm: 60 })
    // …and the shown stops always include the best reachable one
    expect(a.stops.map((s) => s.id)).toContain('on-route-pricey')
  })

  it('prices the whole trip at the recommended stop', () => {
    const a = selectRouteAnalysis(routeApp())
    // 260 km × 6,5 L/100 km = 16,9 L, at the compromis price 1,66 €/L
    expect(a.tripLitres).toBeCloseTo(16.9, 10)
    expect(a.tripCost).toBeCloseTo(16.9 * 1.66, 10)
  })

  it('picked stops survive strategy switches even off the top list', () => {
    const a = selectRouteAnalysis(
      routeApp({ routeMode: 'detour', plannedStops: { max: true } }),
    )
    expect(a.plannedStops.map((s) => s.id)).toEqual(['max'])
  })
})

// ── Cent arithmetic ──────────────────────────────────────────────────────────
describe('priceCents', () => {
  it('rounds to the displayed cent', () => {
    expect(priceCents(1.896)).toBe(190)
    expect(priceCents(1.904)).toBe(190)
    expect(priceCents(1.905)).toBe(191)
  })
})
