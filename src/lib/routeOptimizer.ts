// Fuel-stop optimizer — pure, deterministic, React-free.
//
// Given the selected route, the fuel already in the tank and the priced
// candidate stations along the way, compute the refuelling plan (which
// stations, how many litres at each) that best serves the selected strategy.
//
// Model: an ephemeral directed acyclic graph ordered by progress along the
// route — origin → candidate stations → destination — solved by dynamic
// programming over (node, fuel level) states. Fuel is discretized to
// FUEL_UNIT_LITRES; money, time and distance are tracked as integers, so
// every comparison is exact and immune to floating-point noise:
//   - money in 1/20 cent units (one 0.5 L step at priceMilli m€/L costs
//     exactly `priceMilli` such units);
//   - time in tenths of a minute;
//   - distance in hundredths of a km.
//
// Physical totals are computed first; strategy scoring is applied on top and
// never leaks into the displayed monetary amounts. Fuel present at departure
// is a sunk input — it is never priced at any station.
//
// Two objective terms keep the optimum humane:
// - RESIDUAL FUEL CREDIT: fuel still in the tank at the destination is an
//   asset, not waste — the objective credits it at the cheapest candidate
//   price of the route. Without it the solver values arriving empty and
//   spawns absurd 0.5 L top-up stops whose only purpose is to shave the
//   reserve overcarry of a long final leg.
// - STOP COST: the price strategy's primary objective is money and its time
//   tie-break only fires on exact ties, so without a monetary cost per stop
//   a saving of a few cents justifies an extra halt. Each stop carries its
//   own time valued at the shared value-of-time (REFUEL_STOP_MIN ×
//   VALUE_OF_TIME_CENTS_PER_MIN ≈ 1.40 €) inside the price objective — the
//   balanced and detour strategies already price the stop through their
//   time term. Both terms shape the RANKING only: displayed totals remain
//   the litres actually bought at the pump.
import {
  REFUEL_STOP_MIN,
  RESERVE_FRACTION,
  VALUE_OF_TIME_CENTS_PER_MIN,
  litresForKm,
  speedConsumptionFactor,
  usableRangeKm,
} from './fuelEconomics';

/** Fuel state granularity of the solver (documented precision) */
export const FUEL_UNIT_LITRES = 0.5;

/**
 * Smallest purchase a stop may plan. Forecourts commonly refuse or frown at
 * micro-purchases (and nobody halts for one litre): a stop that buys, buys
 * at least this much — a user-pinned stop may still be a zero-litre halt.
 */
export const MIN_PURCHASE_LITRES = 5;

export type RouteStrategy = 'balanced' | 'price' | 'detour';
/** routed = road matrix legs; estimated = geometric fallback legs */
export type PlanQuality = 'routed' | 'estimated';

/** One road leg between two plan nodes, as the matrix (or estimate) measured it */
export interface TravelLeg {
  distanceKm: number;
  durationMin: number;
}

export interface OptimizerStation {
  id: string;
  /** Progress along the baseline route (km) — orders the graph */
  positionKm: number;
  /** Selected-fuel price, integer milli-euros per litre (1.896 €/L → 1896) */
  priceMilli: number;
  /** Freshness of that price, as the source stamped it */
  priceUpdatedAt?: string;
}

export interface OptimizerInput {
  stations: OptimizerStation[];
  /** origin → destination without any stop, on the same scale as the legs */
  direct: TravelLeg;
  /** origin → station, aligned with `stations` (null = unroutable) */
  originLegs: ReadonlyArray<TravelLeg | null>;
  /** station → destination, aligned with `stations` */
  destinationLegs: ReadonlyArray<TravelLeg | null>;
  /** stationLegs[i][j]: station i → station j (only forward transitions used) */
  stationLegs: ReadonlyArray<ReadonlyArray<TravelLeg | null>>;
  tankLitres: number;
  consumptionLitresPer100Km: number;
  startFuelLitres: number;
  strategy: RouteStrategy;
  /** Stations the plan MUST stop at (user-picked), by id */
  requiredStationIds?: readonly string[];
  quality: PlanQuality;
}

export interface PlannedFuelStop {
  stationId: string;
  positionKm: number;
  priceMilli: number;
  priceUpdatedAt?: string;
  arrivalFuelLitres: number;
  purchasedLitres: number;
  departureFuelLitres: number;
  purchaseCostCents: number;
  /** Minutes after departure when the vehicle reaches this stop (driving + previous refuelling stops) */
  arrivalAtMinute: number;
}

/** Structured why-not when no safe plan exists — the view writes the sentence */
export interface InfeasibleDiagnostics {
  /**
   * Furthest km along the route the vehicle can safely reach: from the start
   * fuel alone when no station is reachable, from the furthest reachable
   * station with a full tank otherwise.
   */
  furthestReachableKm: number;
  /** Not one candidate station is reachable from the departure fuel */
  noStationInRange: boolean;
  /** Furthest station that can be reached but cannot connect onwards */
  strandedStationId?: string;
  /** A user-required stop no feasible sequence can reach */
  unreachableRequiredStationId?: string;
}

export interface RoutePlan {
  status: 'direct' | 'planned' | 'infeasible';
  quality: PlanQuality;
  stops: PlannedFuelStop[];
  /** Σ purchases, integer cents — the only cash amount of the plan */
  totalPurchaseCostCents: number;
  totalDistanceKm: number;
  /** Driving + refuelling stops */
  totalDurationMin: number;
  extraDistanceKm: number;
  /** vs the direct leg, refuelling time included */
  extraDurationMin: number;
  fuelConsumedLitres: number;
  destinationFuelLitres: number;
  /**
   * The strategy's own ranking figure — price: cents; detour: minutes;
   * balanced: cents + time valued at VALUE_OF_TIME_CENTS_PER_MIN. Never cash.
   */
  objectiveScore: number;
  /** Oldest price stamp among the purchase stops (stale-price transparency) */
  oldestPriceUpdatedAt?: string;
  diagnostics?: InfeasibleDiagnostics;
}

const EPS = 1e-9;
const ORIGIN = -1;
/** Negative extras larger than this are shown, not hidden — only rounding noise is clamped */
const ROUNDING_CLAMP_MIN = -2;
/**
 * Objective cost of one stop for the PRICE strategy, in 1/20-cent money
 * units: the stop's own duration valued at the shared value of time. Never
 * displayed, never part of totalPurchaseCostCents.
 */
const PRICE_STOP_COST = REFUEL_STOP_MIN * VALUE_OF_TIME_CENTS_PER_MIN * 20;

/** Additive cost components every DP state carries (all integers) */
interface CostTuple {
  money: number;
  timeTenths: number;
  distHundredths: number;
  stops: number;
}

interface ArriveState extends CostTuple {
  /** Node driven from (ORIGIN for the first leg) */
  fromNode: number;
  /** Fuel units on arrival at fromNode, before its purchase */
  fromArrivalUnits: number;
  /** Units purchased at fromNode before departing */
  fromPurchasedUnits: number;
}

interface DepartState extends CostTuple {
  arrivalUnits: number;
  purchasedUnits: number;
}

export function planRoute(input: OptimizerInput): RoutePlan {
  const unit = FUEL_UNIT_LITRES;
  const cons = input.consumptionLitresPer100Km;
  const tankUnits = Math.max(0, Math.round(input.tankLitres / unit));
  const startUnits = Math.max(
    0,
    Math.min(tankUnits, Math.floor(input.startFuelLitres / unit + EPS)),
  );

  // Stable node order: progress along the route, then id — the graph is a DAG
  // over this order, which is also what makes the result deterministic.
  const order = input.stations
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) =>
        a.s.positionKm - b.s.positionKm || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0),
    );
  const n = order.length;
  const DEST = n;
  const stationAt = (k: number) => order[k].s;
  const legFromOrigin = (k: number) => input.originLegs[order[k].i] ?? null;
  const legToDest = (k: number) => input.destinationLegs[order[k].i] ?? null;
  const legBetween = (a: number, b: number) => input.stationLegs[order[a].i]?.[order[b].i] ?? null;

  const requiredIds = new Set(input.requiredStationIds ?? []);
  const requiredNodes: number[] = [];
  for (let k = 0; k < n; k++) if (requiredIds.has(stationAt(k).id)) requiredNodes.push(k);

  const strategy = input.strategy;
  /** Strictly better under the strategy's lexicographic objective? */
  function better(a: CostTuple, b: CostTuple): boolean {
    let d: number;
    if (strategy === 'balanced') {
      // money[1/20 c] + VOT[c/min] × time[0.1 min] → both in 1/20 cent
      d =
        a.money +
        2 * VALUE_OF_TIME_CENTS_PER_MIN * a.timeTenths -
        (b.money + 2 * VALUE_OF_TIME_CENTS_PER_MIN * b.timeTenths);
      if (d) return d < 0;
    } else if (strategy === 'detour') {
      d = a.timeTenths - b.timeTenths;
      if (d) return d < 0;
    }
    d = a.money - b.money;
    if (d) return d < 0;
    d = a.timeTenths - b.timeTenths;
    if (d) return d < 0;
    d = a.stops - b.stops;
    if (d) return d < 0;
    d = a.distHundredths - b.distHundredths;
    if (d) return d < 0;
    return false;
  }

  // arrive[k][f] — best way to REACH node k (station, or DEST) with f fuel
  // units, before any purchase there.
  const arrive: Array<Array<ArriveState | undefined>> = Array.from(
    { length: n + 1 },
    () => new Array<ArriveState | undefined>(tankUnits + 1),
  );

  // Motorway pace burns more than the configured mixed average, so every leg
  // is planned at the route's speed factor (see speedConsumptionFactor). The
  // factor keys on the DIRECT route's average speed, not each leg's own: a
  // leg mixing fast cruise with slow station access averages below cruise
  // speed, and a per-leg factor would under-charge exactly the legs that
  // detour — rewarding detours with cheaper fuel physics.
  const directSpeedKmh =
    input.direct.durationMin > 0 ? (input.direct.distanceKm / input.direct.durationMin) * 60 : 0;
  const consFactor = speedConsumptionFactor(directSpeedKmh);
  const legLitres = (leg: TravelLeg): number => litresForKm(leg.distanceKm, cons) * consFactor;

  function traverse(
    fromNode: number,
    departRow: ReadonlyArray<DepartState | undefined>,
    leg: TravelLeg,
    target: number,
  ) {
    const litres = legLitres(leg);
    // The reserve constrains the DEPARTURE fuel of each leg (legIsFeasible)
    const minUnits = Math.max(0, Math.ceil(litres / (1 - RESERVE_FRACTION) / unit - EPS));
    const timeT = Math.max(0, Math.round(leg.durationMin * 10));
    const distH = Math.max(0, Math.round(leg.distanceKm * 100));
    const row = arrive[target];
    for (let d = minUnits; d <= tankUnits; d++) {
      const st = departRow[d];
      if (!st) continue;
      const b = Math.max(0, Math.floor(d - litres / unit + EPS));
      const cand: ArriveState = {
        money: st.money,
        timeTenths: st.timeTenths + timeT,
        distHundredths: st.distHundredths + distH,
        stops: st.stops,
        fromNode,
        fromArrivalUnits: st.arrivalUnits,
        fromPurchasedUnits: st.purchasedUnits,
      };
      const cur = row[b];
      if (!cur || better(cand, cur)) row[b] = cand;
    }
  }

  // ── Origin: no purchase possible, single known fuel level ──────────────────
  const originDepart: Array<DepartState | undefined> = new Array(tankUnits + 1);
  originDepart[startUnits] = {
    money: 0,
    timeTenths: 0,
    distHundredths: 0,
    stops: 0,
    arrivalUnits: startUnits,
    purchasedUnits: 0,
  };
  const firstRequired = requiredNodes.length ? requiredNodes[0] : Infinity;
  for (let j = 0; j < n && j <= firstRequired; j++) {
    const leg = legFromOrigin(j);
    if (leg) traverse(ORIGIN, originDepart, leg, j);
  }
  // A required stop forbids driving straight through to the destination
  if (firstRequired === Infinity) traverse(ORIGIN, originDepart, input.direct, DEST);

  // ── Stations, in route order ────────────────────────────────────────────────
  for (let k = 0; k < n; k++) {
    const arriveRow = arrive[k];
    const price = stationAt(k).priceMilli;
    const isRequired = requiredIds.has(stationAt(k).id);
    // Visiting a node IS stopping there: the graph carries a direct leg for
    // every forward pair, so nothing ever needs to pass through a station —
    // and a free pass-through would reset the rolling reserve without the
    // stop that justifies it. A visit therefore charges the stop time, and a
    // stop the user did not pin must buy at least one fuel unit to exist.
    const stopAt = (a: ArriveState, f: number): DepartState => ({
      // The price strategy pays the stop in money (see PRICE_STOP_COST);
      // balanced and detour pay it through the time term below.
      money: a.money + (strategy === 'price' ? PRICE_STOP_COST : 0),
      timeTenths: a.timeTenths + REFUEL_STOP_MIN * 10,
      distHundredths: a.distHundredths,
      stops: a.stops + 1,
      arrivalUnits: f,
      purchasedUnits: 0,
    });
    const departRow: Array<DepartState | undefined> = new Array(tankUnits + 1);
    // Prefix sweep: purchase[f] = best over a ≤ f − minBuy of
    // arrive[a] + stop + price×(f−a). Adding one step to purchase[f−1]
    // covers every eligible a exactly — partial purchases of any size above
    // the forecourt minimum come out of this recurrence for free.
    const minBuyUnits = Math.max(
      1,
      Math.min(Math.round(MIN_PURCHASE_LITRES / unit), tankUnits),
    );
    let purchase: DepartState | undefined;
    for (let f = 0; f <= tankUnits; f++) {
      if (purchase) {
        purchase = {
          ...purchase,
          money: purchase.money + price,
          purchasedUnits: purchase.purchasedUnits + 1,
        };
      }
      const seed = f >= minBuyUnits ? arriveRow[f - minBuyUnits] : undefined;
      if (seed) {
        const stopped = stopAt(seed, f - minBuyUnits);
        const minBuy: DepartState = {
          ...stopped,
          money: stopped.money + minBuyUnits * price,
          purchasedUnits: minBuyUnits,
        };
        if (!purchase || better(minBuy, purchase)) purchase = minBuy;
      }
      // A pinned stop may leave without buying (the user wants the halt);
      // anywhere else a zero-litre stop is pointless and stays illegal.
      const a = arriveRow[f];
      const zeroBuy = isRequired && a ? stopAt(a, f) : undefined;
      departRow[f] =
        purchase && (!zeroBuy || better(purchase, zeroBuy)) ? purchase : zeroBuy;
    }
    // Successors: forward only (the order is the DAG), never past the next
    // required stop — that is what constrains user-picked stops into the plan.
    const nextRequired = requiredNodes.find((r) => r > k) ?? Infinity;
    for (let j = k + 1; j < n && j <= nextRequired; j++) {
      const leg = legBetween(k, j);
      if (leg) traverse(k, departRow, leg, j);
    }
    if (nextRequired === Infinity) {
      const leg = legToDest(k);
      if (leg) traverse(k, departRow, leg, DEST);
    }
  }

  // ── Best terminal state ─────────────────────────────────────────────────────
  // The residual fuel credit only matters here: mid-route states are always
  // compared at the SAME fuel level, so crediting the destination fuel at the
  // cheapest candidate price cannot break the DP's optimality — it only
  // decides which arrival fuel level actually wins. Credited at the cheapest
  // price, banking extra litres at that very station is objective-neutral and
  // the tie-breaks (first-found, lowest fuel) keep purchases minimal.
  const creditMilli = input.stations.length
    ? Math.min(...input.stations.map((s) => s.priceMilli))
    : 0;
  let best: ArriveState | undefined;
  let bestAdjusted: CostTuple | undefined;
  let bestFuel = 0;
  const destRow = arrive[DEST];
  for (let f = 0; f <= tankUnits; f++) {
    const s = destRow[f];
    if (!s) continue;
    const adjusted: CostTuple = { ...s, money: s.money - creditMilli * f };
    if (!bestAdjusted || better(adjusted, bestAdjusted)) {
      best = s;
      bestAdjusted = adjusted;
      bestFuel = f;
    }
  }

  const emptyTotals = {
    stops: [] as PlannedFuelStop[],
    totalPurchaseCostCents: 0,
    totalDistanceKm: 0,
    totalDurationMin: 0,
    extraDistanceKm: 0,
    extraDurationMin: 0,
    fuelConsumedLitres: 0,
    destinationFuelLitres: 0,
    objectiveScore: 0,
  };

  if (!best) {
    let strandedK = -1;
    for (let k = n - 1; k >= 0; k--) {
      if (arrive[k].some(Boolean)) {
        strandedK = k;
        break;
      }
    }
    const startRange = usableRangeKm(startUnits * unit, cons);
    const furthest =
      strandedK >= 0
        ? Math.max(
            startRange,
            stationAt(strandedK).positionKm + usableRangeKm(tankUnits * unit, cons),
          )
        : startRange;
    const unreachableRequired = requiredNodes.find((r) => !arrive[r].some(Boolean));
    return {
      status: 'infeasible',
      quality: input.quality,
      ...emptyTotals,
      diagnostics: {
        furthestReachableKm: Math.round(furthest * 10) / 10,
        noStationInRange: strandedK < 0,
        strandedStationId: strandedK >= 0 ? stationAt(strandedK).id : undefined,
        unreachableRequiredStationId:
          unreachableRequired != null ? stationAt(unreachableRequired).id : undefined,
      },
    };
  }

  // ── Walk the winning chain back into a plan ─────────────────────────────────
  const stops: PlannedFuelStop[] = [];
  let fuelConsumedLitres = 0;
  let cursor: { node: number; state: ArriveState } = { node: DEST, state: best };
  for (;;) {
    const { node, state } = cursor;
    const from = state.fromNode;
    const leg =
      from === ORIGIN
        ? node === DEST
          ? input.direct
          : legFromOrigin(node)
        : node === DEST
          ? legToDest(from)
          : legBetween(from, node);
    if (leg) fuelConsumedLitres += legLitres(leg);
    if (from === ORIGIN) break;
    const fromState = arrive[from][state.fromArrivalUnits];
    if (!fromState) break; // unreachable by construction
    const st = stationAt(from);
    const purchased = state.fromPurchasedUnits;
    if (purchased > 0 || requiredIds.has(st.id)) {
      const purchasedLitres = purchased * unit;
      stops.unshift({
        stationId: st.id,
        positionKm: st.positionKm,
        priceMilli: st.priceMilli,
        priceUpdatedAt: st.priceUpdatedAt,
        arrivalFuelLitres: state.fromArrivalUnits * unit,
        purchasedLitres,
        departureFuelLitres: (state.fromArrivalUnits + purchased) * unit,
        purchaseCostCents: Math.round((purchasedLitres * st.priceMilli) / 10),
        arrivalAtMinute: Math.round(fromState.timeTenths) / 10,
      });
    }
    cursor = { node: from, state: fromState };
  }

  const totalPurchaseCostCents = stops.reduce((a, s) => a + s.purchaseCostCents, 0);
  const totalDistanceKm = best.distHundredths / 100;
  const totalDurationMin = best.timeTenths / 10;
  const clampTiny = (v: number) => (v < 0 && v > ROUNDING_CLAMP_MIN ? 0 : v);
  const extraDistanceKm = clampTiny(totalDistanceKm - input.direct.distanceKm);
  const extraDurationMin = clampTiny(totalDurationMin - input.direct.durationMin);
  const objectiveScore =
    strategy === 'price'
      ? totalPurchaseCostCents
      : strategy === 'detour'
        ? extraDurationMin
        : totalPurchaseCostCents + (VALUE_OF_TIME_CENTS_PER_MIN * extraDurationMin) / 1;
  let oldestPriceUpdatedAt: string | undefined;
  for (const s of stops) {
    if (s.priceUpdatedAt && (!oldestPriceUpdatedAt || s.priceUpdatedAt < oldestPriceUpdatedAt)) {
      oldestPriceUpdatedAt = s.priceUpdatedAt;
    }
  }

  return {
    status: stops.length ? 'planned' : 'direct',
    quality: input.quality,
    stops,
    totalPurchaseCostCents,
    totalDistanceKm,
    totalDurationMin,
    extraDistanceKm,
    extraDurationMin,
    fuelConsumedLitres,
    destinationFuelLitres: bestFuel * unit,
    objectiveScore,
    oldestPriceUpdatedAt,
  };
}
