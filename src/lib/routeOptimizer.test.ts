import { describe, expect, it } from 'vitest'
import {
  FUEL_UNIT_LITRES,
  planRoute,
  type OptimizerInput,
  type PlanQuality,
  type RouteStrategy,
  type TravelLeg,
} from './routeOptimizer'
import { RESERVE_FRACTION, legIsFeasible, litresForKm, usableRangeKm } from './fuelEconomics'

// ── Fixture builder ──────────────────────────────────────────────────────────
// A synthetic straight-road world: driving between two corridor points costs
// the along-route km plus a perpendicular access hop per off-route endpoint.
// `patch` lets a test contradict the geometry — that is exactly what a real
// road matrix does (bridges, motorway exits, one-ways).
const MIN_PER_KM = 0.6 // 100 km/h cruise
const ACCESS_MIN_PER_KM = 1.5 // 40 km/h local roads
const ROAD_FACTOR = 1.3

interface SpecStation {
  id: string
  km: number
  price: number
  off?: number
  updatedAt?: string
}

interface Spec {
  routeKm: number
  stations: SpecStation[]
  startFuel: number
  tank?: number
  cons?: number
  strategy?: RouteStrategy
  required?: string[]
  quality?: PlanQuality
  patch?: (legs: {
    direct: TravelLeg
    origin: Array<TravelLeg | null>
    destination: Array<TravelLeg | null>
    between: Array<Array<TravelLeg | null>>
  }) => void
}

function buildInput(spec: Spec): OptimizerInput {
  const access = (s: SpecStation) => (s.off ?? 0) * ROAD_FACTOR
  const leg = (along: number, extra: number): TravelLeg => ({
    distanceKm: along + extra,
    durationMin: along * MIN_PER_KM + extra * ACCESS_MIN_PER_KM,
  })
  const legs = {
    direct: { distanceKm: spec.routeKm, durationMin: spec.routeKm * MIN_PER_KM },
    origin: spec.stations.map((s) => leg(s.km, access(s))) as Array<TravelLeg | null>,
    destination: spec.stations.map((s) => leg(spec.routeKm - s.km, access(s))) as Array<
      TravelLeg | null
    >,
    between: spec.stations.map((a) =>
      spec.stations.map((b) => (b.km > a.km ? leg(b.km - a.km, access(a) + access(b)) : null)),
    ) as Array<Array<TravelLeg | null>>,
  }
  spec.patch?.(legs)
  return {
    stations: spec.stations.map((s) => ({
      id: s.id,
      positionKm: s.km,
      priceMilli: Math.round(s.price * 1000),
      priceUpdatedAt: s.updatedAt,
    })),
    direct: legs.direct,
    originLegs: legs.origin,
    destinationLegs: legs.destination,
    stationLegs: legs.between,
    tankLitres: spec.tank ?? 50,
    consumptionLitresPer100Km: spec.cons ?? 6.5,
    startFuelLitres: spec.startFuel,
    strategy: spec.strategy ?? 'balanced',
    requiredStationIds: spec.required,
    quality: spec.quality ?? 'routed',
  }
}

/** The three-way fixture: cheap-but-far-off A, fair on-corridor B, pricey on-route C */
const THREE_WAY: Spec = {
  routeKm: 300,
  startFuel: 10, // usable 123 km — a stop is mandatory
  stations: [
    { id: 'a-cheap-detour', km: 100, price: 1.5, off: 3 },
    { id: 'b-balanced', km: 110, price: 1.65, off: 0.5 },
    { id: 'c-on-route-pricey', km: 105, price: 1.9, off: 0 },
  ],
}

// ── 1. Direct route ──────────────────────────────────────────────────────────
describe('direct route', () => {
  it('returns a zero-stop plan when the tank already covers the trip', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 100,
        startFuel: 20,
        stations: [{ id: 's1', km: 50, price: 1.2 }],
      }),
    )
    expect(plan.status).toBe('direct')
    expect(plan.stops).toEqual([])
    expect(plan.totalPurchaseCostCents).toBe(0)
    expect(plan.extraDurationMin).toBe(0)
    expect(plan.destinationFuelLitres).toBeGreaterThan(12)
  })

  it('10. refuses a direct run that would eat into the safety reserve', () => {
    // 130 km burns 8.45 L: less than the 10 L on board, but more than the
    // 80 % the reserve allows — the optimizer must plan a stop instead.
    const plan = planRoute(
      buildInput({
        routeKm: 130,
        startFuel: 10,
        stations: [{ id: 's1', km: 60, price: 1.7 }],
      }),
    )
    expect(legIsFeasible(10, litresForKm(130, 6.5))).toBe(false)
    expect(plan.status).toBe('planned')
    expect(plan.stops.map((s) => s.stationId)).toEqual(['s1'])
    expect(plan.stops[0].purchasedLitres).toBeGreaterThan(0)
  })
})

// ── 2 & 11. Strategy objectives ──────────────────────────────────────────────
describe('strategies', () => {
  it('balanced: the cheapest sticker loses when its real road detour costs more time than it saves', () => {
    const plan = planRoute(buildInput({ ...THREE_WAY, strategy: 'balanced' }))
    expect(plan.status).toBe('planned')
    expect(plan.stops.map((s) => s.stationId)).toEqual(['b-balanced'])
  })

  it('price: minimizes actual spend — the bulk lands at the cheap pump', () => {
    const plan = planRoute(buildInput({ ...THREE_WAY, strategy: 'price' }))
    // Spend is the primary objective, stop count only a tie-breaker: a tiny
    // top-up at the next station shaves the reserve overcarry a long final
    // leg would force, so it beats the one-stop plan on money.
    expect(plan.stops[0].stationId).toBe('a-cheap-detour')
    expect(plan.stops[0].purchasedLitres).toBeGreaterThan(10)
    const others = planRoute(buildInput({ ...THREE_WAY, strategy: 'balanced' }))
    expect(plan.totalPurchaseCostCents).toBeLessThan(others.totalPurchaseCostCents)
  })

  it('detour: minimizes extra time, price only breaks ties', () => {
    const plan = planRoute(buildInput({ ...THREE_WAY, strategy: 'detour' }))
    expect(plan.stops.map((s) => s.stationId)).toEqual(['c-on-route-pricey'])
  })

  it('11. the three strategies produce three different valid plans on the same fixture', () => {
    const plans = (['price', 'detour', 'balanced'] as const).map((strategy) =>
      planRoute(buildInput({ ...THREE_WAY, strategy })),
    )
    const picks = plans.map((p) => p.stops.map((s) => s.stationId).join('+'))
    expect(new Set(picks).size).toBe(3)
    for (const p of plans) expect(p.status).toBe('planned')
  })
})

// ── 3. Road matrix contradicts geometric proximity ───────────────────────────
describe('routed vs geometric legs', () => {
  const spec: Spec = {
    routeKm: 300,
    startFuel: 10,
    strategy: 'balanced',
    stations: [
      // 500 m from the polyline… but the only exit is 15 km further on
      { id: 'x-near-polyline', km: 100, price: 1.6, off: 0.5 },
      { id: 'y-honest', km: 102, price: 1.62, off: 2 },
    ],
  }

  it('prefers the geometrically-near station on estimated legs', () => {
    expect(planRoute(buildInput(spec)).stops.map((s) => s.stationId)).toEqual(['x-near-polyline'])
  })

  it('uses the routed detour once the matrix reveals the motorway exit', () => {
    const plan = planRoute(
      buildInput({
        ...spec,
        patch: (legs) => {
          const long = (l: TravelLeg | null): TravelLeg | null =>
            l && { distanceKm: l.distanceKm + 15, durationMin: l.durationMin + 12 }
          legs.origin[0] = long(legs.origin[0])
          legs.destination[0] = long(legs.destination[0])
          legs.between[0] = legs.between[0].map(long)
        },
      }),
    )
    expect(plan.stops.map((s) => s.stationId)).toEqual(['y-honest'])
  })
})

// ── 4 & 5. Reachability ──────────────────────────────────────────────────────
describe('reachability', () => {
  it('4. an unreachable globally-cheapest station yields to a reachable pricier one', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 300,
        startFuel: 5, // usable 61.5 km
        strategy: 'price',
        stations: [
          { id: 'reachable-pricey', km: 50, price: 1.85 },
          { id: 'cheapest-too-far', km: 200, price: 1.4 },
        ],
      }),
    )
    expect(plan.status).toBe('planned')
    expect(plan.stops[0].stationId).toBe('reachable-pricey')
  })

  it('5. no station before the dry point → infeasible with diagnostics', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 300,
        startFuel: 5,
        stations: [{ id: 'too-far', km: 100, price: 1.5 }],
      }),
    )
    expect(plan.status).toBe('infeasible')
    expect(plan.diagnostics).toMatchObject({ noStationInRange: true })
    expect(plan.diagnostics!.furthestReachableKm).toBeCloseTo(usableRangeKm(5, 6.5), 1)
    expect(plan.stops).toEqual([])
  })

  it('a reachable station that cannot connect onwards → infeasible, stranded there', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 800,
        startFuel: 10,
        tank: 20, // full tank usable ≈ 246 km — the 400 km gap is a wall
        stations: [
          { id: 'first', km: 100, price: 1.6 },
          { id: 'after-the-gap', km: 700, price: 1.5 },
        ],
      }),
    )
    expect(plan.status).toBe('infeasible')
    expect(plan.diagnostics).toMatchObject({
      noStationInRange: false,
      strandedStationId: 'first',
    })
  })
})

// ── 6. Multi-stop ────────────────────────────────────────────────────────────
describe('multi-stop plans', () => {
  it('chains two stops when no single stop can cover the route', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 400,
        startFuel: 10,
        tank: 20, // usable full-tank range ≈ 246 km
        strategy: 'balanced',
        stations: [
          { id: 'early', km: 100, price: 1.7 },
          { id: 'late', km: 300, price: 1.68 },
        ],
      }),
    )
    expect(plan.status).toBe('planned')
    expect(plan.stops.map((s) => s.stationId)).toEqual(['early', 'late'])
    // In driving order, with coherent arrival clocks
    expect(plan.stops[0].arrivalAtMinute).toBeLessThan(plan.stops[1].arrivalAtMinute)
  })
})

// ── 7. Partial purchase ──────────────────────────────────────────────────────
describe('partial purchases', () => {
  it('buys just enough at an expensive forced stop to reach a cheaper one', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 280,
        startFuel: 6, // usable 73.8 km — the expensive stop is unavoidable
        strategy: 'price',
        stations: [
          { id: 'expensive-early', km: 70, price: 2.0 },
          { id: 'cheap-later', km: 140, price: 1.6 },
        ],
      }),
    )
    expect(plan.stops.map((s) => s.stationId)).toEqual(['expensive-early', 'cheap-later'])
    const [early, later] = plan.stops
    // Enough for the 70 km hop (4.55 L / reserve ⇒ ~5.7 L on board), not a full tank
    expect(early.departureFuelLitres).toBeLessThan(8)
    expect(early.purchasedLitres).toBeLessThan(7)
    // The bulk is bought at the cheap pump
    expect(later.purchasedLitres).toBeGreaterThan(early.purchasedLitres)
    // …and the totals stay integer cents derived from litres × price
    expect(early.purchaseCostCents).toBe(Math.round(early.purchasedLitres * 2000) / 10)
  })
})

// ── 8. Detour fuel ───────────────────────────────────────────────────────────
describe('detour fuel', () => {
  it('extra road km increase consumption and the litres purchased', () => {
    const base: Spec = {
      routeKm: 300,
      startFuel: 10,
      strategy: 'price',
      stations: [{ id: 'only', km: 100, price: 1.7, off: 0 }],
    }
    const onRoute = planRoute(buildInput(base))
    const offRoute = planRoute(
      buildInput({ ...base, stations: [{ id: 'only', km: 100, price: 1.7, off: 6 }] }),
    )
    expect(offRoute.fuelConsumedLitres).toBeGreaterThan(onRoute.fuelConsumedLitres)
    expect(offRoute.stops[0].purchasedLitres).toBeGreaterThan(onRoute.stops[0].purchasedLitres)
    expect(offRoute.extraDistanceKm).toBeGreaterThan(onRoute.extraDistanceKm)
  })
})

// ── 9 & 10. Physical invariants ──────────────────────────────────────────────
describe('physical invariants', () => {
  const plans = (['price', 'detour', 'balanced'] as const).map((strategy) =>
    planRoute(
      buildInput({
        routeKm: 500,
        startFuel: 8,
        tank: 30,
        strategy,
        stations: [
          { id: 's1', km: 60, price: 1.9, off: 1 },
          { id: 's2', km: 180, price: 1.55, off: 4 },
          { id: 's3', km: 210, price: 1.75 },
          { id: 's4', km: 380, price: 1.62, off: 2 },
        ],
      }),
    ),
  )

  it('9. no state ever exceeds the tank capacity', () => {
    for (const plan of plans) {
      for (const stop of plan.stops) {
        expect(stop.departureFuelLitres).toBeLessThanOrEqual(30 + 1e-9)
        expect(stop.arrivalFuelLitres).toBeGreaterThanOrEqual(0)
        expect(stop.departureFuelLitres).toBeCloseTo(
          stop.arrivalFuelLitres + stop.purchasedLitres,
          10,
        )
      }
      expect(plan.destinationFuelLitres).toBeGreaterThanOrEqual(0)
    }
  })

  it('10. every travelled leg honours the safety reserve', () => {
    // Reserve invariant, checked through the reported fuel states: each stop
    // is reached with at least RESERVE_FRACTION of its leg's departure fuel.
    for (const plan of plans) {
      let departure = 8
      for (const stop of plan.stops) {
        expect(stop.arrivalFuelLitres).toBeGreaterThanOrEqual(
          departure * RESERVE_FRACTION - FUEL_UNIT_LITRES,
        )
        departure = stop.departureFuelLitres
      }
    }
  })
})

// ── 12. Determinism ──────────────────────────────────────────────────────────
describe('determinism', () => {
  it('repeated runs and shuffled inputs return exactly the same plan', () => {
    const spec: Spec = {
      routeKm: 420,
      startFuel: 9,
      strategy: 'balanced',
      stations: [
        { id: 'n2', km: 90, price: 1.7 },
        { id: 'n1', km: 90, price: 1.7 }, // exact tie — id order must decide
        { id: 'n3', km: 250, price: 1.66, off: 1 },
        { id: 'n4', km: 340, price: 1.72 },
      ],
    }
    const a = planRoute(buildInput(spec))
    const b = planRoute(buildInput(spec))
    const shuffled = planRoute(
      buildInput({ ...spec, stations: [...spec.stations].reverse() }),
    )
    expect(b).toEqual(a)
    expect(shuffled.stops.map((s) => s.stationId)).toEqual(a.stops.map((s) => s.stationId))
    expect(shuffled.totalPurchaseCostCents).toBe(a.totalPurchaseCostCents)
    // The tie between the twin stations lands on the lower id, every time
    expect(a.stops[0].stationId).toBe('n1')
  })
})

// ── Residual fuel value & stop cost (the 0.5 L micro-stop regression) ────────
describe('no absurd micro-stops', () => {
  // Regression shaped like a real Toulouse → Lille run: 896 km, 35 L on
  // board, a fair station a third in and an expensive one near the end. The
  // solver used to add a 0.5 L stop at the expensive pump purely to shave
  // the reserve overcarry of the long final leg — because it valued arrival
  // fuel at zero. The residual credit and the price strategy's stop cost
  // must keep the plan at one honest fill.
  const spec: Spec = {
    routeKm: 896,
    startFuel: 35,
    stations: [
      { id: 'fair-mid-route', km: 371, price: 1.99, off: 1 },
      { id: 'expensive-late', km: 804, price: 2.1, off: 0 },
    ],
  }

  it.each(['price', 'balanced', 'detour'] as const)(
    '%s: one fill, no 0.5 L top-up at the expensive pump',
    (strategy) => {
      const plan = planRoute(buildInput({ ...spec, strategy }))
      expect(plan.stops.map((s) => s.stationId)).toEqual(['fair-mid-route'])
      expect(plan.stops[0].purchasedLitres).toBeGreaterThan(20)
    },
  )

  it('fuel left at destination is an asset, not a reason to stop again', () => {
    const plan = planRoute(buildInput({ ...spec, strategy: 'price' }))
    // The single fill honours the reserve of the 525 km final leg, so the
    // vehicle arrives with a real margin instead of planned-empty.
    expect(plan.destinationFuelLitres).toBeGreaterThan(5)
  })
})

// ── 14. Estimated quality flows through ──────────────────────────────────────
describe('estimated fallback', () => {
  it('a plan built on geometric legs is marked estimated', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 300,
        startFuel: 10,
        quality: 'estimated',
        stations: [{ id: 's1', km: 100, price: 1.7 }],
      }),
    )
    expect(plan.quality).toBe('estimated')
    expect(plan.status).toBe('planned')
  })
})

// ── Required (user-picked) stops ─────────────────────────────────────────────
describe('required stops', () => {
  it('constrains the plan through a user-picked station and recomputes quantities', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 300,
        startFuel: 10,
        strategy: 'balanced',
        required: ['c-on-route-pricey'],
        stations: THREE_WAY.stations,
      }),
    )
    expect(plan.stops.some((s) => s.stationId === 'c-on-route-pricey')).toBe(true)
  })

  it('rejects a manual sequence the tank cannot honour', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 300,
        startFuel: 5, // usable 61.5 km — km 100 is beyond reach
        required: ['too-far'],
        stations: [
          { id: 'reachable', km: 40, price: 1.6 },
          { id: 'too-far', km: 100, price: 1.5 },
        ],
        patch: (legs) => {
          // The reachable station cannot bridge to the required one either
          // (900 km burns 58.5 L — beyond what a 50 L tank may safely spend)
          legs.between[0][1] = { distanceKm: 900, durationMin: 540 }
        },
      }),
    )
    expect(plan.status).toBe('infeasible')
    expect(plan.diagnostics?.unreachableRequiredStationId).toBe('too-far')
  })
})

// ── Price freshness metadata ─────────────────────────────────────────────────
describe('price freshness', () => {
  it('exposes the oldest price stamp among the purchase stops', () => {
    const plan = planRoute(
      buildInput({
        routeKm: 400,
        startFuel: 10,
        tank: 20,
        strategy: 'price',
        stations: [
          { id: 'early', km: 100, price: 1.7, updatedAt: '2026-07-24T10:00:00Z' },
          { id: 'late', km: 300, price: 1.68, updatedAt: '2026-07-20T08:00:00Z' },
        ],
      }),
    )
    expect(plan.stops.map((s) => s.priceUpdatedAt)).toEqual([
      '2026-07-24T10:00:00Z',
      '2026-07-20T08:00:00Z',
    ])
    expect(plan.oldestPriceUpdatedAt).toBe('2026-07-20T08:00:00Z')
  })
})

// ── Solver budget ────────────────────────────────────────────────────────────
describe('solver budget', () => {
  it('stays comfortably interactive at the matrix cap (30 stations × 200 fuel units)', () => {
    const stations: SpecStation[] = Array.from({ length: 30 }, (_, i) => ({
      id: `s${String(i).padStart(2, '0')}`,
      km: 20 + i * 30,
      price: 1.5 + ((i * 7) % 40) / 100,
      off: (i * 3) % 5,
    }))
    const input = buildInput({
      routeKm: 950,
      startFuel: 12,
      tank: 100, // 200 fuel units
      strategy: 'balanced',
      stations,
    })
    const t0 = performance.now()
    const plan = planRoute(input)
    const elapsed = performance.now() - t0
    expect(plan.status).toBe('planned')
    // Generous CI margin; interactive use sits far below this.
    expect(elapsed).toBeLessThan(500)
  })
})
