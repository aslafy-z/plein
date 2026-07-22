import { describe, expect, it } from 'vitest'
import type { FuelId, RouteStation, Station } from '../data/types'
import {
  effectiveFuel,
  effectivePrice,
  priceCents,
  priceTier,
  selectAutonomy,
  selectByPrice,
  selectPriceStats,
  selectRecommended,
  selectRouteAnalysis,
  selectVisible,
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
    cat: 'unknown',
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

const gazole = (value: number) => ({ gazole: { value } })

/** Minimal AppStore stub — only the fields the pure selectors read. */
function app(over: Partial<AppStore> = {}): AppStore {
  return {
    fuel: 'gazole' as FuelId,
    radius: 5,
    brandSel: [],
    serviceTags: {},
    sort: 'prix',
    userPos: BASE,
    searchPos: BASE,
    focusStationId: null,
    stations: { status: 'ready', data: [], activeSource: 'demo', fellBack: false, refreshing: false },
    roadReach: {},
    conso: 6.5,
    tank: 50,
    startTankPct: 70,
    routeMode: 'compromis',
    tour: {},
    routeState: { status: 'idle', route: null, stations: [], fellBack: false },
    ...over,
  } as AppStore
}

// ── Fuel substitution ────────────────────────────────────────────────────────
describe('effectiveFuel', () => {
  it('lets Spanish and Andorran SP95 stand in for E10, never the reverse', () => {
    const esp = station({ id: 'esp-1', prices: { sp95: { value: 1.6 } } })
    const and = station({ id: 'and-1', prices: { sp95: { value: 1.5 } } })
    const fra = station({ id: 'fra-1', prices: { sp95: { value: 1.7 } } })
    expect(effectiveFuel(esp, 'e10')).toBe('sp95')
    expect(effectiveFuel(and, 'e10')).toBe('sp95')
    // French stations list both fuels separately — no substitution
    expect(effectiveFuel(fra, 'e10')).toBeNull()
    // An SP95-only engine must not be sent to an E10 pump
    const espE10 = station({ id: 'esp-2', prices: { e10: { value: 1.55 } } })
    expect(effectiveFuel(espE10, 'sp95')).toBeNull()
    expect(effectivePrice(esp, 'e10')?.value).toBe(1.6)
  })
})

// ── Zone filtering ───────────────────────────────────────────────────────────
describe('selectVisible', () => {
  const zone = [
    station({ id: 'near', ...north(1), prices: gazole(1.7), tags: ['24/24', 'Lavage'], brand: 'Intermarché' }),
    station({ id: 'mid', ...north(4), prices: gazole(1.8), tags: ['24/24'] }),
    station({ id: 'far', ...north(12), prices: gazole(1.6), tags: ['24/24', 'Lavage'] }),
    station({ id: 'nofuel', ...north(2), prices: { e10: { value: 1.8 } } }),
  ]

  it('applies the radius, the fuel and every selected service tag', () => {
    const base = app({ stations: { status: 'ready', data: zone, activeSource: 'demo', fellBack: false, refreshing: false } })
    expect(selectVisible(base).map((s) => s.id)).toEqual(['near', 'mid'])
    // radius widened → the cheap far station joins
    expect(selectVisible(app({ ...base, radius: 25 })).map((s) => s.id)).toContain('far')
    // service tags compose with AND
    expect(
      selectVisible(app({ ...base, serviceTags: { '24/24': true, Lavage: true } })).map((s) => s.id),
    ).toEqual(['near'])
  })

  it('filters brands by group, brandless stations passing as « Indépendants »', () => {
    const base = app({ stations: { status: 'ready', data: zone, activeSource: 'demo', fellBack: false, refreshing: false } })
    expect(selectVisible(app({ ...base, brandSel: ['Intermarché'] })).map((s) => s.id)).toEqual(['near'])
    expect(
      selectVisible(app({ ...base, brandSel: ['Indépendants & autres'] })).map((s) => s.id),
    ).toEqual(['mid'])
  })

  it('selectZoneFuels only names fuels the pumps actually serve (no SP95 fallback)', () => {
    const esp = station({ id: 'esp-9', ...north(1), prices: { sp95: { value: 1.6 } } })
    const a = app({ stations: { status: 'ready', data: [esp], activeSource: 'esp', fellBack: false, refreshing: false } })
    expect(selectZoneFuels(a)).toEqual(['sp95'])
  })
})

// ── Ranking & recommendation ─────────────────────────────────────────────────
describe('selectByPrice / selectRecommended', () => {
  it('ranks at displayed cent precision, nearest first inside a cent', () => {
    // 1,896 and 1,904 both read « 1,90 € » — the nearest must come first
    const data = [
      station({ id: 'far-sub-cent', ...north(3.3), prices: gazole(1.896) }),
      station({ id: 'near', ...north(0.9), prices: gazole(1.904) }),
    ]
    const a = app({ stations: { status: 'ready', data, activeSource: 'demo', fellBack: false, refreshing: false } })
    expect(selectByPrice(a).map((s) => s.id)).toEqual(['near', 'far-sub-cent'])
    expect(selectRecommended(a)?.id).toBe('near')
  })

  it('crowns the best deal, not the best sticker price, once the détour is paid', () => {
    // 1,86 € at ~15.9 km vs 1,89 € at ~11.8 km (6,5 L/100 km, 50 L):
    // effective 1,937 vs 1,948 €/L → within the 1-ct tie margin → NEAREST wins
    const data = [
      station({ id: 'far-cheap', ...north(15.9), prices: gazole(1.86) }),
      station({ id: 'near-deal', ...north(11.8), prices: gazole(1.89) }),
      station({ id: 'filler', ...north(1), prices: gazole(1.99) }),
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
      station({ id: 'bridge', ...north(2.2), prices: gazole(1.85) }),
      station({ id: 'direct', ...north(3.3), prices: gazole(1.87) }),
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
})

// ── Price tiers ──────────────────────────────────────────────────────────────
describe('selectPriceStats / priceTier', () => {
  const withData = (prices: number[], positions?: ReturnType<typeof north>[]) =>
    app({
      stations: {
        status: 'ready',
        data: prices.map((p, i) => station({ id: `s${i}`, ...(positions?.[i] ?? north(1)), prices: gazole(p) })),
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
})

// ── Favoris sorting ──────────────────────────────────────────────────────────
describe('sortFavoriteRows', () => {
  const cfg = { conso: 6.5, tank: 50 }
  const rows = [
    { id: 'far-cheap', price: 1.65, distKm: 7.4 }, // effective ≈ 1,682
    { id: 'near', price: 1.67, distKm: 0.9 }, // effective ≈ 1,674
    { id: 'unloaded', price: null, distKm: 2 },
  ]

  it('« Recommandé » counts the détour, « Prix » keeps the sticker order', () => {
    expect(sortFavoriteRows(rows, 'reco', cfg).map((r) => r.id)).toEqual([
      'near',
      'far-cheap',
      'unloaded',
    ])
    expect(sortFavoriteRows(rows, 'prix', cfg).map((r) => r.id)).toEqual([
      'far-cheap',
      'near',
      'unloaded',
    ])
    expect(sortFavoriteRows(rows, 'dist', cfg).map((r) => r.id)).toEqual([
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
    expect(sortFavoriteRows(blind, 'prix', cfg).map((r) => r.id)).toEqual(['a', 'b'])
    expect(sortFavoriteRows(blind, 'reco', cfg).map((r) => r.id)).toEqual(['a', 'b'])
  })
})

// ── Route analysis ───────────────────────────────────────────────────────────
const routeStation = (
  id: string,
  price: number,
  kmAlong: number,
  detourMin: number,
): RouteStation => ({ ...station({ id, prices: gazole(price) }), kmAlong, detourMin })

const CORRIDOR: RouteStation[] = [
  routeStation('cheapest-far-detour', 1.63, 119, 7),
  routeStation('balanced', 1.66, 85, 2),
  routeStation('on-route-pricey', 1.84, 58, 0),
  routeStation('max', 1.9, 150, 3),
]

const routeApp = (over: Partial<AppStore> = {}) =>
  app({
    routeState: {
      status: 'ready',
      route: { distanceKm: 260, durationMin: 150, polyline: [] },
      stations: CORRIDOR,
      fellBack: false,
    },
    ...over,
  })

describe('selectAutonomy', () => {
  it('derives autonomy from tank × level ÷ conso, with a ~20 % reserve', () => {
    expect(selectAutonomy(app())).toEqual({ autonomyKm: 538, limitKm: 430 })
    expect(selectAutonomy(app({ startTankPct: 10 }))).toEqual({ autonomyKm: 77, limitKm: 60 })
  })
})

describe('selectRouteAnalysis', () => {
  it('each strategy crowns its own stop with its own justification', () => {
    const compromis = selectRouteAnalysis(routeApp())
    // 1,66 € + 2 min beats 1,63 € + 7 min once the détour minutes are priced
    expect(compromis.recoId).toBe('balanced')
    expect(compromis.recoSub).toBe('Le plein ici : −12,00 € vs le + cher du trajet')

    const prix = selectRouteAnalysis(routeApp({ routeMode: 'prix' }))
    expect(prix.recoId).toBe('cheapest-far-detour')
    expect(prix.recoSub).toBe('Prix le plus bas du trajet : −13,50 €')

    const detour = selectRouteAnalysis(routeApp({ routeMode: 'detour' }))
    expect(detour.recoId).toBe('on-route-pricey')
    expect(detour.recoSub).toBe('Sur votre route · sans détour')
  })

  it('a low departure tank forces a REACHABLE recommendation', () => {
    // 10 % of 50 L at 6,5 L/100 km → limit KM 60: only the on-route station
    // (KM 58) is reachable — the corridor-wide winners are beyond the limit
    const a = selectRouteAnalysis(routeApp({ startTankPct: 10 }))
    expect(a.needsStop).toBe(true)
    expect(a.limitKm).toBe(60)
    expect(a.recoId).toBe('on-route-pricey')
    expect(a.arrivalLabel).toBe('sans arrêt : autonomie insuffisante (limite ≈ KM 60)')
    // …and the shown stops always include the best reachable one
    expect(a.stops.map((s) => s.id)).toContain('on-route-pricey')
  })

  it('prices the whole trip at the recommended stop', () => {
    const a = selectRouteAnalysis(routeApp())
    // 260 km × 6,5 L/100 km = 16,9 L, at the compromis price 1,66 €/L
    expect(a.tripLitres).toBeCloseTo(16.9, 10)
    expect(a.tripCost).toBeCloseTo(16.9 * 1.66, 10)
  })

  it('tour selections survive strategy switches even off the top list', () => {
    const a = selectRouteAnalysis(routeApp({ routeMode: 'detour', tour: { max: true } }))
    expect(a.tourStops.map((s) => s.id)).toEqual(['max'])
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
