import { describe, expect, it } from 'vitest'
import type { GeoPoint } from './geo'
import { lerpPoint, nearestOnPolyline } from './geo'
import type { Route, Station } from '../data/types'
import { usableRangeKm } from './fuelEconomics'
import {
  estimatePlanLegs,
  matrixPlanLegs,
  projectCorridor,
  selectRouteCandidates,
  type RouteCandidate,
} from './routeCandidates'
import { planRoute } from './routeOptimizer'
import { DEMO_ROUTE_STATIONS, DEMO_STATIONS } from '../data/demo/demoData'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const START: GeoPoint = { lat: 43.0, lng: 1.0 }
/** Straight 111-vertex polyline heading north — 1 vertex per ~3.6 km */
function northRoute(routeKm: number): Route {
  const steps = 110
  const polyline: GeoPoint[] = []
  for (let i = 0; i <= steps; i++) {
    polyline.push({ lat: START.lat + ((routeKm / 111) * i) / steps, lng: START.lng })
  }
  return { distanceKm: routeKm, durationMin: routeKm * 0.6, polyline }
}

function station(id: string, alongKm: number, price: number, offKm = 0): Station {
  return {
    id,
    name: `Station ${id}`,
    init: 'ST',
    lat: START.lat + alongKm / 111,
    lng: START.lng + offKm / 111 / Math.cos((START.lat * Math.PI) / 180),
    address: '',
    city: '',
    prices: { diesel: { value: price, updatedAt: '2026-07-24T10:00:00Z' } },
    tags: [],
    services: [],
    highway: false,
  }
}

const dieselPrice = (s: Station) => s.prices.diesel

/**
 * Candidates over a raw corridor, projected first — the app projects once in
 * `loadRoute` and the selector reads the stored fields, so a test that skipped
 * the projection would not be testing the pipeline the app runs.
 */
const candidatesFor = (
  route: Route,
  stations: readonly Station[],
  opts: Parameters<typeof selectRouteCandidates>[3],
) => selectRouteCandidates(route, projectCorridor(route, stations), dieselPrice, opts)

describe('selectRouteCandidates', () => {
  it('keeps only priced stations projected inside the route', () => {
    const route = northRoute(200)
    const stations = [
      station('ok', 100, 1.7),
      station('no-price', 120, 1.7),
      station('at-departure', 0.5, 1.5),
      station('past-arrival', 199.7, 1.5),
    ]
    stations[1].prices = {}
    const picked = candidatesFor(route, stations, {
      maxCandidates: 10,
      firstWindowKm: 500,
    })
    expect(picked.map((c) => c.station.id)).toEqual(['ok'])
    expect(picked[0].projectionKm).toBeCloseTo(100, 0)
    expect(picked[0].priceMilli).toBe(1700)
  })

  it('13. cheap stations near the destination cannot evict reachable early ones', () => {
    const route = northRoute(600)
    // Forty temptingly cheap stations in the last 100 km…
    const stations: Station[] = Array.from({ length: 40 }, (_, i) =>
      station(`cheap-end-${String(i).padStart(2, '0')}`, 480 + i * 2.5, 1.5),
    )
    // …and two mid-priced ones inside the departure fuel's reach
    stations.push(station('early-a', 40, 1.8), station('early-b', 70, 1.85))
    const picked = candidatesFor(route, stations, {
      maxCandidates: 10,
      firstWindowKm: usableRangeKm(8, 6.5), // ≈ 98 km
    })
    const ids = picked.map((c) => c.station.id)
    expect(ids).toContain('early-a')
    expect(ids).toContain('early-b')
    expect(picked.length).toBeLessThanOrEqual(10)
    // Determinism: same inputs, same set, same order
    const again = candidatesFor(route, stations, {
      maxCandidates: 10,
      firstWindowKm: usableRangeKm(8, 6.5),
    })
    expect(again).toEqual(picked)
  })

  it('spreads the picks across the route instead of price-sorting globally', () => {
    const route = northRoute(600)
    const stations: Station[] = []
    for (let km = 30; km < 600; km += 30) {
      // Prices fall towards the destination — a global sort would keep only the end
      stations.push(station(`s-${String(km).padStart(3, '0')}`, km, 2.0 - km / 1000))
    }
    const picked = candidatesFor(route, stations, {
      maxCandidates: 12,
      firstWindowKm: 500,
    })
    const kms = picked.map((c) => c.projectionKm)
    // At least one candidate in each third of the route
    expect(kms.some((km) => km < 200)).toBe(true)
    expect(kms.some((km) => km >= 200 && km < 400)).toBe(true)
    expect(kms.some((km) => km >= 400)).toBe(true)
  })

  it('preserves user-picked stops and deduplicates near-identical pumps', () => {
    const route = northRoute(300)
    const twin1 = station('twin-b', 150, 1.7)
    const twin2 = station('twin-a', 150, 1.7) // same cell, same price → one survives
    const stations = [twin1, twin2, station('pricey-pick', 200, 1.95), station('cheap', 100, 1.55)]
    const picked = candidatesFor(route, stations, {
      maxCandidates: 2,
      firstWindowKm: 500,
      requiredIds: ['pricey-pick'],
    })
    const ids = picked.map((c) => c.station.id)
    expect(ids).toContain('pricey-pick')
    expect(ids).not.toContain('twin-b') // lower id wins the dedupe
    expect(ids.length).toBeLessThanOrEqual(2)
  })

  it('lets a user-picked stop win its dedupe cell against a lower id', () => {
    // Two pumps ~11 m apart at the same price collapse into one candidate. If
    // the twin with the lower id won, the pin would come back as unplannable
    // through invalidPlannedStopIds — about a perfectly valid station.
    const route = northRoute(300)
    const picked = candidatesFor(
      route,
      [station('twin-a', 150, 1.7), station('twin-b', 150.01, 1.7)],
      { maxCandidates: 10, firstWindowKm: 500, requiredIds: ['twin-b'] },
    )
    expect(picked.map((c) => c.station.id)).toEqual(['twin-b'])
  })

  it('never lets user-picked stops overflow the matrix cap', () => {
    // maxCandidates is what ONE matrix call can measure. More pins than that
    // and the provider rejects the request, degrading every leg to an estimate,
    // so the pins past the cap are dropped in route order instead.
    const route = northRoute(300)
    const stations = Array.from({ length: 12 }, (_, i) =>
      station(`pin-${String(i).padStart(2, '0')}`, 20 + i * 20, 1.7),
    )
    const picked = candidatesFor(route, stations, {
      maxCandidates: 3,
      firstWindowKm: 500,
      requiredIds: stations.map((s) => s.id),
    })
    expect(picked).toHaveLength(3)
    expect(picked.map((c) => c.station.id)).toEqual(['pin-00', 'pin-01', 'pin-02'])
  })

  it('reads the stored projection instead of measuring the polyline again', () => {
    // Projecting is O(stations × vertices) — far too expensive for a selector
    // that reruns on every store update, so it happens once at load. Proof:
    // with the polyline emptied, an already-projected corridor still resolves.
    const route = northRoute(300)
    const projected = projectCorridor(route, [station('a', 80, 1.7), station('b', 200, 1.6)])
    const picked = selectRouteCandidates({ ...route, polyline: [] }, projected, dieselPrice, {
      maxCandidates: 10,
      firstWindowKm: 500,
    })
    expect(picked.map((c) => c.station.id)).toEqual(['a', 'b'])
    // Projections snap to the nearest vertex (2.7 km apart on this fixture)
    expect(picked[0].projectionKm).toBeGreaterThan(77)
    expect(picked[0].projectionKm).toBeLessThan(83)
  })

  it('respects the matrix size cap', () => {
    const route = northRoute(500)
    const stations = Array.from({ length: 60 }, (_, i) =>
      station(`s${String(i).padStart(2, '0')}`, 10 + i * 8, 1.6 + (i % 10) / 100),
    )
    expect(
      candidatesFor(route, stations, {
        maxCandidates: 28,
        firstWindowKm: 400,
      }).length,
    ).toBe(28)
  })
})

describe('estimatePlanLegs', () => {
  it('models along-route driving plus an off-route access hop, on the route scale', () => {
    const route = northRoute(200)
    const candidates = candidatesFor(route, [station('mid', 100, 1.7, 4)], { maxCandidates: 5, firstWindowKm: 500 })
    const legs = estimatePlanLegs(route, candidates)
    expect(legs.quality).toBe('estimated')
    expect(legs.direct).toEqual({ distanceKm: 200, durationMin: 120 })
    // 100 km along + 4 km × road factor of access
    expect(legs.origin[0]!.distanceKm).toBeCloseTo(100 + 4 * 1.3, 0)
    expect(legs.destination[0]!.distanceKm).toBeCloseTo(100 + 4 * 1.3, 0)
    // Detour vs direct is strictly positive for an off-route station
    const detour =
      legs.origin[0]!.durationMin + legs.destination[0]!.durationMin - legs.direct.durationMin
    expect(detour).toBeGreaterThan(5)
  })

  it('lets two stations at the same projection chain in id order', () => {
    // The optimizer orders its graph by (projectionKm, id), so an identical
    // projection is a tie it resolves — not a pair that cannot connect. A
    // `between` built on projectionKm alone returned null both ways.
    const route = northRoute(200)
    const candidates = candidatesFor(route, [station('b-twin', 100, 1.8), station('a-twin', 100, 1.6)], {
      maxCandidates: 5,
      firstWindowKm: 500,
    })
    expect(candidates.map((c) => c.station.id)).toEqual(['a-twin', 'b-twin'])
    const legs = estimatePlanLegs(route, candidates)
    expect(legs.between[0][1]).not.toBeNull()
    expect(legs.between[0][1]!.distanceKm).toBe(0)
    expect(legs.between[1][0]).toBeNull()
  })

  it('scales polyline projections up to the claimed road distance', () => {
    // The demo draws straight polylines shorter than the road distance it
    // claims — projections must live on the road-distance axis.
    const route = { ...northRoute(200), distanceKm: 250 }
    const candidates = candidatesFor(route, [station('mid', 100, 1.7)], {
      maxCandidates: 5,
      firstWindowKm: 500,
    })
    expect(candidates[0].projectionKm).toBeCloseTo(125, 0)
  })
})

describe('matrixPlanLegs', () => {
  const route = northRoute(100)
  const leg = (d: number) => ({ distanceKm: d, durationMin: d * 0.6 })

  it('reshapes a square provider matrix into optimizer legs', () => {
    const cells = [
      [leg(0), leg(40), leg(100)],
      [leg(40), leg(0), leg(62)],
      [leg(100), leg(61), leg(0)],
    ]
    const legs = matrixPlanLegs(cells, 1, route)!
    expect(legs.quality).toBe('routed')
    expect(legs.direct).toEqual(leg(100))
    expect(legs.origin).toEqual([leg(40)])
    expect(legs.destination).toEqual([leg(62)])
    expect(legs.between).toEqual([[leg(0)]])
  })

  it('rejects a matrix whose shape does not match the candidates', () => {
    expect(matrixPlanLegs([[leg(0)]], 1, route)).toBeNull()
  })
})

// ── Demo corridor integration ────────────────────────────────────────────────
// Full pipeline over the deterministic demo dataset, exactly as the app runs
// it offline: demo route model → corridor stations → candidates → estimated
// legs → optimizer. The e2e suite asserts the same plans through the UI, so
// this test is the cheap canary that keeps those expectations honest.
describe('demo corridor (Toulouse → Bordeaux)', () => {
  const TOULOUSE: GeoPoint = { lat: 43.6047, lng: 1.4442 }
  const BORDEAUX: GeoPoint = { lat: 44.8378, lng: -0.5792 }

  function demoRoute(): Route {
    const steps = 80
    const polyline: GeoPoint[] = []
    for (let i = 0; i <= steps; i++) polyline.push(lerpPoint(TOULOUSE, BORDEAUX, i / steps))
    const crow = 211.1 // haversine Toulouse → Bordeaux
    return { distanceKm: crow * 1.25, durationMin: (crow * 1.25) / 110 * 60 + 15, polyline }
  }

  function planFor(
    strategy: 'balanced' | 'price' | 'detour',
    startTankPct: number,
    vehicle: { tank: number; consumption: number } = { tank: 50, consumption: 6.5 },
  ) {
    const route = demoRoute()
    // Same corridor the demo stations provider serves (5 km + 3 km slack)
    const pool = [...DEMO_STATIONS, ...DEMO_ROUTE_STATIONS].filter(
      (s) => nearestOnPolyline({ lat: s.lat, lng: s.lng }, route.polyline).distKm <= 8,
    )
    const startFuel = (vehicle.tank * startTankPct) / 100
    const candidates: RouteCandidate[] = candidatesFor(route, pool, {
      maxCandidates: 28,
      firstWindowKm: usableRangeKm(startFuel, vehicle.consumption),
    })
    const legs = estimatePlanLegs(route, candidates)
    return planRoute({
      stations: candidates.map((c) => ({
        id: c.station.id,
        positionKm: c.projectionKm,
        priceMilli: c.priceMilli,
        priceUpdatedAt: c.priceUpdatedAt,
      })),
      direct: legs.direct,
      originLegs: legs.origin,
      destinationLegs: legs.destination,
      stationLegs: legs.between,
      tankLitres: vehicle.tank,
      consumptionLitresPer100Km: vehicle.consumption,
      startFuelLitres: startFuel,
      strategy,
      quality: legs.quality,
    })
  }

  it('a 70 % tank crosses without any stop', () => {
    const plan = planFor('balanced', 70)
    expect(plan.status).toBe('direct')
    expect(plan.stops).toEqual([])
    expect(plan.totalPurchaseCostCents).toBe(0)
  })

  it('a 10 % tank forces a plan opening at the one reachable station', () => {
    const names = (strategy: 'balanced' | 'price' | 'detour') =>
      planFor(strategy, 10).stops.map((s) => s.stationId)
    // One reachable opener + a fill that covers the rest: every strategy lands
    // on the same single stop. Pinned so the e2e specs can assert the same
    // stations by name; if the demo dataset moves, update both together.
    //
    // « Price » used to answer `au` here — 5 ct/L cheaper on the sticker, but
    // 5,9 km off the road: 32,37 € and 186 min against 30,78 € and 168 min.
    // Worse on cash, distance AND time. It won by 4 cents of residual-fuel
    // credit while its 18 extra minutes cost the objective nothing, because
    // the price strategy charged no value of time at all.
    expect(names('balanced')).toMatchInlineSnapshot(`
      [
        "r-grisolles",
      ]
    `)
    expect(names('price')).toMatchInlineSnapshot(`
      [
        "r-grisolles",
      ]
    `)
    expect(names('detour')).toMatchInlineSnapshot(`
      [
        "r-grisolles",
      ]
    `)
  })

  it('a 20 % tank reaches the on-motorway station — detour picks it', () => {
    const names = (strategy: 'balanced' | 'price' | 'detour') =>
      planFor(strategy, 20).stops.map((s) => s.stationId)
    expect(names('balanced')).toMatchInlineSnapshot(`
      [
        "r-valence",
      ]
    `)
    expect(names('price')).toMatchInlineSnapshot(`
      [
        "r-valence",
      ]
    `)
    expect(names('detour')).toMatchInlineSnapshot(`
      [
        "r-a62",
      ]
    `)
  })

  it('a small tank must chain two stops — rendered in driving order', () => {
    // 15 L tank at 20 %: no single stop can cover the remaining ~220 km, so
    // the plan chains a near-Toulouse opener with a mid-corridor fill.
    const plan = planFor('balanced', 20, { tank: 15, consumption: 6.5 })
    expect(plan.status).toBe('planned')
    expect(plan.stops.length).toBeGreaterThanOrEqual(2)
    expect(plan.stops.map((s) => s.stationId)).toMatchInlineSnapshot(`
      [
        "tac",
        "r-valence",
      ]
    `)
  })

  it('a thirsty vehicle with a small tank cannot bridge the corridor gaps', () => {
    // Full-tank usable range ≈ 47 km — shorter than the Valence → Aiguillon
    // hop. The plan must come back infeasible with a stranded diagnostic,
    // never a plan that secretly runs the tank dry.
    const plan = planFor('balanced', 40, { tank: 10, consumption: 17 })
    expect(plan.status).toBe('infeasible')
    expect(plan.diagnostics?.noStationInRange).toBe(false)
    expect(plan.diagnostics?.strandedStationId).toMatchInlineSnapshot(`"tac"`)
  })
})
