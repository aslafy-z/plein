import { describe, expect, it } from 'vitest'
import type { FuelId, RouteStation, Station } from '../data/types'
import { INDEPENDENT_BRAND_ID } from '../lib/brandIcons'
import {
  CROW_ROAD_FACTOR,
  effectiveFuel,
  effectivePrice,
  fuelRange,
  priceCents,
  priceTier,
  roadReachOf,
  selectAutonomy,
  selectByPrice,
  selectCheapest,
  selectDeals,
  selectFocusStation,
  selectMapStations,
  selectPriceRange,
  selectPriceStats,
  selectSorted,
  selectPlanCandidates,
  selectReachCandidates,
  selectRecommended,
  selectRouteAnalysis,
  selectVisible,
  travelMatrixKey,
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
    stations: { status: 'ready', data: [], activeSource: 'demo', fellBack: false, refreshing: false },
    roadReach: {},
    consumption: 6.5,
    tank: 50,
    startTankPct: 70,
    routeMode: 'balanced',
    plannedStops: {},
    routeState: { status: 'idle', route: null, stations: [], fellBack: false },
    routeMatrix: { status: 'idle', key: null, cells: null },
    sourceId: 'demo',
    vehicle: 'car',
    avoidMotorway: false,
    avoidToll: false,
    fromPoint: null,
    toPoint: null,
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
    const base = app({ stations: { status: 'ready', data: zone, activeSource: 'demo', fellBack: false, refreshing: false } })
    expect(selectVisible(base).map((s) => s.id)).toEqual(['near', 'mid'])
    // radius widened → the cheap far station joins
    expect(selectVisible(app({ ...base, radius: 25 })).map((s) => s.id)).toContain('far')
    // service tags compose with AND
    expect(
      selectVisible(app({ ...base, serviceTags: { open24h: true, carWash: true } })).map((s) => s.id),
    ).toEqual(['near'])
  })

  it('filters brands by group, brandless stations passing as the « independent » group', () => {
    const base = app({ stations: { status: 'ready', data: zone, activeSource: 'demo', fellBack: false, refreshing: false } })
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
      stations: { status: 'ready', data: brands, activeSource: 'demo', fellBack: false, refreshing: false },
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
    const a = app({ stations: { status: 'ready', data: [esp], activeSource: 'esp', fellBack: false, refreshing: false } })
    expect(selectZoneFuels(a)).toEqual(['unleaded95'])
  })

  it('selectZoneFuels lists every fuel of the zone, in the fuel order, filters applied', () => {
    const data = [
      station({ id: 'a', ...north(1), prices: { diesel: { value: 1.7 }, e85: { value: 0.9 } }, brand: 'Shell' }),
      station({ id: 'b', ...north(2), prices: { unleaded98: { value: 1.9 } }, tags: ['carWash'] }),
      // Out of the radius — its GPL must not join the list
      station({ id: 'c', ...north(30), prices: { lpg: { value: 0.99 } } }),
    ]
    const base = app({ stations: { status: 'ready', data, activeSource: 'demo', fellBack: false, refreshing: false } })
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
      fellBack: false,
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
    const a = app({ stations: { status: 'ready', data, activeSource: 'demo', fellBack: false, refreshing: false } })
    expect(selectByPrice(a).map((s) => s.id)).toEqual(['near', 'far-sub-cent'])
    expect(selectRecommended(a)?.id).toBe('near')
  })

  it('crowns the best deal, not the best sticker price, once the détour is paid', () => {
    // 1,86 € at ~15.9 km vs 1,89 € at ~11.8 km (6,5 L/100 km, 50 L):
    // effective 1,937 vs 1,948 €/L → within the 1-ct tie margin → NEAREST wins
    const data = [
      station({ id: 'far-cheap', ...north(15.9), prices: diesel(1.86) }),
      station({ id: 'near-deal', ...north(11.8), prices: diesel(1.89) }),
      station({ id: 'filler', ...north(1), prices: diesel(1.99) }),
    ]
    const a = app({ radius: 25, stations: { status: 'ready', data, activeSource: 'demo', fellBack: false, refreshing: false } })
    // The sticker ranking still puts the cheapest first…
    expect(selectByPrice(a)[0].id).toBe('far-cheap')
    // …but the recommendation counts the fuel burnt to get there
    expect(selectRecommended(a)?.id).toBe('near-deal')
  })

  it('ranks on road distances when the reach matrix knows the stations', () => {
    // « bridge » looks closest as the crow flies (2,2 km) and is sticker-
    // cheapest, but the river makes it 12 km by road; « direct » is 3,5 km.
    // Effective: 1,85 × (1 + 24×0,0013) ≈ 1,908 vs 1,87 × (1 + 7×0,0013) ≈ 1,887
    const data = [
      station({ id: 'bridge', ...north(2.2), prices: diesel(1.85) }),
      station({ id: 'direct', ...north(3.3), prices: diesel(1.87) }),
    ]
    const stations = { status: 'ready', data, activeSource: 'demo', fellBack: false, refreshing: false } as AppStore['stations']
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
    // out with no matrix row. On raw crow-flies « missed » wins the reco
    // (1,75 × (1 + 24×0,0026) ≈ 1,859 vs 1,877 €/L) — but 24 km of straight
    // line is ~31 road km, and at that scale it loses (≈ 1,892 €/L).
    const data = [
      station({ id: 'measured', ...north(3), prices: diesel(1.86) }),
      station({ id: 'missed', ...north(24), prices: diesel(1.75) }),
    ]
    const a = app({
      radius: 25,
      stations: { status: 'ready', data, activeSource: 'demo', fellBack: false, refreshing: false },
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
        fellBack: false,
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
        fellBack: false,
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
// Corridor stations carry REAL coordinates: the plan pipeline projects them
// onto the route polyline itself — kmAlong/detourMin are display metadata.
const ROUTE_KM = 260
const routeLine = () =>
  Array.from({ length: 53 }, (_, i) => north((ROUTE_KM / 52) * i))

const corridorStation = (
  id: string,
  price: number,
  kmAlong: number,
  offKm = 0,
): RouteStation => ({
  ...station({ id, prices: diesel(price) }),
  lat: BASE.lat + kmAlong / 111,
  lng: BASE.lng + offKm / (111 * Math.cos((BASE.lat * Math.PI) / 180)),
  kmAlong,
  detourMin: Math.round(offKm * 4),
})

// Positions sit on polyline vertices (5 km grid) so the projection is exact
const CORRIDOR: RouteStation[] = [
  corridorStation('on-route-pricey', 1.84, 55, 0),
  corridorStation('balanced', 1.55, 85, 0.5),
  corridorStation('cheapest-far-detour', 1.52, 120, 8),
  corridorStation('max', 1.9, 150, 0),
]

const routeApp = (over: Partial<AppStore> = {}) =>
  app({
    routeState: {
      status: 'ready',
      route: { distanceKm: ROUTE_KM, durationMin: 156, polyline: routeLine() },
      stations: CORRIDOR,
      fellBack: false,
    },
    fromPoint: BASE,
    toPoint: north(ROUTE_KM),
    ...over,
  })

describe('selectAutonomy', () => {
  it('derives autonomy from tank × level ÷ consumption, with a ~20 % reserve', () => {
    expect(selectAutonomy(app())).toEqual({ autonomyKm: 538, limitKm: 430 })
    expect(selectAutonomy(app({ startTankPct: 10 }))).toEqual({ autonomyKm: 77, limitKm: 60 })
  })
})

describe('selectRouteAnalysis', () => {
  it('a tank that covers the trip yields a zero-stop plan, stations stay optional', () => {
    // 70 % of 50 L → 538 km of autonomy for 260 km of route
    const a = selectRouteAnalysis(routeApp())
    expect(a.plan?.status).toBe('direct')
    expect(a.planStops).toEqual([])
    expect(a.purchaseCostCents).toBe(0)
    expect(a.needsStop).toBe(false)
    expect(a.arrival?.kind).toBe('direct')
    // Cheap corridor stations are still offered — as alternatives, never as
    // a required or « optimal » stop
    expect(a.alternatives.length).toBeGreaterThan(0)
  })

  it('a low departure tank forces a plan that starts at a REACHABLE station', () => {
    // 10 % of 50 L at 6,5 L/100 km → limit KM 60: only the on-route station
    // (KM 55) can open the plan, whatever the strategy prefers further on
    for (const routeMode of ['balanced', 'price', 'detour'] as const) {
      const a = selectRouteAnalysis(routeApp({ startTankPct: 10, routeMode }))
      expect(a.needsStop).toBe(true)
      expect(a.limitKm).toBe(60)
      expect(a.plan?.status).toBe('planned')
      expect(a.planStops[0].station.id).toBe('on-route-pricey')
    }
  })

  it('the strategy changes the plan, and the cheap-but-far pump loses on real detour cost', () => {
    const price = selectRouteAnalysis(routeApp({ startTankPct: 10, routeMode: 'price' }))
    const detour = selectRouteAnalysis(routeApp({ startTankPct: 10, routeMode: 'detour' }))
    // Detour: one forced stop, no hop to a cheaper pump
    expect(detour.planStops.map((p) => p.station.id)).toEqual(['on-route-pricey'])
    // Price: tops up at the forced stop, buys the bulk at the cheap
    // on-corridor pump. The 1,52 € sticker never wins: its 8 km off-road
    // access burns more fuel than the 3 ct/L discount pays for — it stays
    // an alternative.
    const priceIds = price.planStops.map((p) => p.station.id)
    expect(priceIds.slice(0, 2)).toEqual(['on-route-pricey', 'balanced'])
    expect(priceIds).not.toContain('cheapest-far-detour')
    expect(price.planStops[0].stop.purchasedLitres).toBeLessThan(
      price.planStops[1].stop.purchasedLitres,
    )
    expect(price.alternatives.map((s) => s.id)).toContain('cheapest-far-detour')
    // A plan stop states what to buy there, in integer cents
    for (const p of price.planStops) {
      expect(p.stop.purchaseCostCents).toBe(
        Math.round((p.stop.purchasedLitres * p.stop.priceMilli) / 10),
      )
    }
  })

  it('no reachable station at all → infeasible, with the arrival saying so', () => {
    const a = selectRouteAnalysis(
      routeApp({
        startTankPct: 10,
        routeState: {
          status: 'ready',
          route: { distanceKm: ROUTE_KM, durationMin: 156, polyline: routeLine() },
          stations: CORRIDOR.filter((s) => s.kmAlong > 100),
          fellBack: false,
        },
      }),
    )
    expect(a.plan?.status).toBe('infeasible')
    expect(a.plan?.diagnostics?.noStationInRange).toBe(true)
    expect(a.arrival).toEqual({ kind: 'autonomyShort', limitKm: 60 })
    expect(a.planStops).toEqual([])
  })

  it('a picked stop is constrained INTO the plan and its litres recomputed', () => {
    const a = selectRouteAnalysis(routeApp({ plannedStops: { max: true } }))
    expect(a.plan?.status).toBe('planned')
    expect(a.planStops.map((p) => p.station.id)).toContain('max')
    expect(a.invalidPlannedStopIds).toEqual([])
    expect(a.plannedStops.map((s) => s.id)).toEqual(['max'])
  })

  it('a picked stop without a usable price is flagged, not silently accepted', () => {
    const e10Only = {
      ...corridorStation('no-diesel', 1.8, 100),
      prices: { e10: { value: 1.8 } },
    }
    const a = selectRouteAnalysis(
      routeApp({
        routeState: {
          status: 'ready',
          route: { distanceKm: ROUTE_KM, durationMin: 156, polyline: routeLine() },
          stations: [...CORRIDOR, e10Only],
          fellBack: false,
        },
        plannedStops: { 'no-diesel': true },
      }),
    )
    expect(a.invalidPlannedStopIds).toEqual(['no-diesel'])
  })

  it('runs on the geometric estimate until a matching matrix lands, then routed', () => {
    const base = routeApp()
    expect(selectRouteAnalysis(base).quality).toBe('estimated')

    const candidates = selectPlanCandidates(base)
    const key = travelMatrixKey('demo', BASE, north(ROUTE_KM), candidates, {
      avoidMotorway: false,
      avoidToll: false,
      vehicle: 'car',
    })
    const n = candidates.length + 2
    const cells = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => ({ distanceKm: 60, durationMin: 40 })),
    )
    const routed = selectRouteAnalysis(
      routeApp({ routeMatrix: { status: 'ready', key, cells } }),
    )
    expect(routed.quality).toBe('routed')
    // A stale matrix (candidate set moved on) must NOT be trusted
    const stale = selectRouteAnalysis(
      routeApp({ routeMatrix: { status: 'ready', key: 'other', cells } }),
    )
    expect(stale.quality).toBe('estimated')
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
