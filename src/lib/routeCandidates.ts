// Candidate selection for the fuel-stop optimizer, and the geometric fallback
// travel model used when no routing matrix can be obtained.
//
// The matrix call is the scarce resource: public servers cap table sizes, so
// only a bounded, geographically distributed subset of the corridor stations
// can get measured road legs. The selection here is deterministic and favours
// coverage over global price order — a cluster of cheap stations near the
// destination must never evict every reachable station near the departure.
import { cumulativeKm, nearestOnPolyline } from './geo';
import type { Route, RouteStation, Station } from '../data/types';
import { CROW_ROAD_FACTOR, priceMilliPerLitre } from './fuelEconomics';
import type { PlanQuality, TravelLeg } from './routeOptimizer';

/** Off-route access speed of the estimated model (~40 km/h local roads) */
const OFF_ROUTE_MIN_PER_KM = 1.5;

/**
 * Project a corridor onto the route: km along it (on the route's OWN distance
 * scale — a simplified polyline measures shorter than the road distance it
 * claims, and the autonomy limit is on road km) and crow-flies km off it.
 *
 * Costs O(stations × polyline vertices), which is hundreds of milliseconds on
 * a long route, so it runs EXACTLY ONCE per corridor — when the route loads.
 * `selectRouteCandidates` then reads the stored fields instead of measuring
 * again on every recompute.
 */
export function projectCorridor(route: Route, stations: readonly Station[]): RouteStation[] {
  const cum = cumulativeKm(route.polyline);
  const polyLen = cum[cum.length - 1] || 1;
  const scale = route.distanceKm > 0 ? route.distanceKm / polyLen : 1;
  return stations.map((st) => {
    const near = nearestOnPolyline({ lat: st.lat, lng: st.lng }, route.polyline, cum);
    return {
      ...st,
      kmAlong: near.alongKm * scale,
      offRouteKm: near.distKm,
      // Estimated access: crow-flies lifted to the road scale, there and back
      // at local-road speed — the display fallback until routed legs exist.
      detourMin:
        near.distKm < 0.4
          ? 0
          : Math.max(1, Math.round(near.distKm * CROW_ROAD_FACTOR * OFF_ROUTE_MIN_PER_KM * 2)),
    };
  });
}

/** A station projected onto the route, priced, ready for the matrix call */
export interface RouteCandidate {
  station: RouteStation;
  /** km along the route at the nearest polyline vertex, on the route's own
      distance scale (demo polylines are straight lines shorter than the
      claimed road distance — the scale keeps both on the same axis) */
  projectionKm: number;
  /** crow-flies km from the station to the route */
  offRouteKm: number;
  /** Selected-fuel price, integer milli-euros per litre */
  priceMilli: number;
  priceUpdatedAt?: string;
}

export interface CandidateOptions {
  /** Hard cap — what one matrix call can measure, minus origin & destination */
  maxCandidates: number;
  /** Usable km from the departure fuel — the first mandatory stopping window */
  firstWindowKm: number;
  /** User-picked stops that must survive the thinning when possible */
  requiredIds?: readonly string[];
}

/** Stations glued to the very ends of the route are not stops, they are noise */
const EDGE_MARGIN_KM = 1;
/** The one total order of the module: progress along the route, then id */
const byRoute = (a: RouteCandidate, b: RouteCandidate) =>
  a.projectionKm - b.projectionKm || (a.station.id < b.station.id ? -1 : 1);
/** Aimed bucket width — a bucket per ~50 km of route, bounded below */
const BUCKET_TARGET_KM = 50;
const MAX_BUCKETS = 12;
/** Reachable-from-departure stations always kept (cheapest first) */
const FIRST_WINDOW_KEEP = 4;
/** ~110 m grid — two pumps this close at the same price are one candidate */
const DEDUPE_DECIMALS = 3;

/**
 * Pick the candidate set for one matrix call. Deterministic: same inputs,
 * same output, always ordered by (projectionKm, id).
 *
 * `stations` arrive ALREADY projected — `kmAlong` and `offRouteKm` are measured
 * once when the corridor loads (see `loadRoute`). Projecting is O(polyline
 * vertices) per station, so a corridor of a few hundred stations against a few
 * thousand vertices costs seconds; this function runs inside a selector and
 * must stay O(stations log stations).
 *
 * `priceOf` injects the effective-fuel logic (SP95-for-E10 etc.) so this
 * module stays free of catalog knowledge; stations it returns undefined for
 * are excluded — a missing price is never replaced by a fake large one.
 */
export function selectRouteCandidates(
  route: Route,
  stations: readonly RouteStation[],
  priceOf: (s: RouteStation) => { value: number; updatedAt?: string } | undefined,
  opts: CandidateOptions,
): RouteCandidate[] {
  if (opts.maxCandidates <= 0) return [];

  // Price + filter (the projection already happened at load)
  const all: RouteCandidate[] = [];
  for (const s of stations) {
    const price = priceOf(s);
    if (price == null) continue;
    if (s.kmAlong <= EDGE_MARGIN_KM || s.kmAlong >= route.distanceKm - EDGE_MARGIN_KM) continue;
    all.push({
      station: s,
      projectionKm: s.kmAlong,
      offRouteKm: s.offRouteKm,
      priceMilli: priceMilliPerLitre(price.value),
      priceUpdatedAt: price.updatedAt,
    });
  }

  const required = new Set(opts.requiredIds ?? []);

  // Deduplicate near-identical stations (same ~110 m cell, same price). A stop
  // the user pinned always wins its cell: dropping it in favour of the twin
  // next door would report the pin back as unplannable, which it is not.
  const byCell = new Map<string, RouteCandidate>();
  for (const c of all) {
    const key = `${c.station.lat.toFixed(DEDUPE_DECIMALS)},${c.station.lng.toFixed(DEDUPE_DECIMALS)},${c.priceMilli}`;
    const cur = byCell.get(key);
    if (cur && required.has(cur.station.id)) continue;
    if (!cur || required.has(c.station.id) || c.station.id < cur.station.id) byCell.set(key, c);
  }
  // Route order up front: every step below then thins a deterministic list,
  // whatever order the corridor arrived in.
  const deduped = [...byCell.values()].sort(byRoute);

  const byPrice = (a: RouteCandidate, b: RouteCandidate) =>
    a.priceMilli - b.priceMilli || (a.station.id < b.station.id ? -1 : 1);

  const picked = new Map<string, RouteCandidate>();
  const take = (c: RouteCandidate) => picked.set(c.station.id, c);

  // 1. User-picked stops survive whenever they are priced and on the corridor —
  //    but never past the cap: `maxCandidates` is what one matrix call can
  //    measure, and overflowing it makes the PROVIDER reject the request, which
  //    would degrade the whole plan to estimated legs. Pins beyond the cap are
  //    dropped in route order, so the caller reports them as unplannable.
  for (const c of deduped) {
    if (picked.size >= opts.maxCandidates) break;
    if (required.has(c.station.id)) take(c);
  }

  // 2. The first mandatory stopping window: with a low departure tank these
  //    are the only stations that can ever start a plan — keep the cheapest
  //    reachable ones ahead of any bucket fill.
  const reachableFirst = deduped
    .filter((c) => c.projectionKm + c.offRouteKm * CROW_ROAD_FACTOR <= opts.firstWindowKm)
    .sort(byPrice);
  for (const c of reachableFirst.slice(0, FIRST_WINDOW_KEEP)) {
    if (picked.size >= opts.maxCandidates) break;
    take(c);
  }

  // 3. Distance buckets along the route, filled round-robin: cheapest first,
  //    with each bucket's closest-to-route station promoted so a bucket never
  //    holds only far-off-road bargains.
  const bucketCount = Math.max(1, Math.min(MAX_BUCKETS, Math.ceil(route.distanceKm / BUCKET_TARGET_KM)));
  const bucketWidth = route.distanceKm / bucketCount;
  const buckets: RouteCandidate[][] = Array.from({ length: bucketCount }, () => []);
  for (const c of deduped) {
    buckets[Math.min(bucketCount - 1, Math.floor(c.projectionKm / bucketWidth))].push(c);
  }
  const bucketQueues = buckets.map((list) => {
    const queue = [...list].sort(byPrice);
    const closest = [...list].sort(
      (a, b) => a.offRouteKm - b.offRouteKm || (a.station.id < b.station.id ? -1 : 1),
    )[0];
    // Promote the on-route option into the bucket's first two picks
    if (closest && queue.indexOf(closest) > 1) {
      queue.splice(queue.indexOf(closest), 1);
      queue.splice(1, 0, closest);
    }
    return queue;
  });
  for (let round = 0; picked.size < opts.maxCandidates; round++) {
    let added = false;
    for (const queue of bucketQueues) {
      if (picked.size >= opts.maxCandidates) break;
      // Skip entries already taken by earlier steps
      while (queue.length && picked.has(queue[0].station.id)) queue.shift();
      const next = queue.shift();
      if (next) {
        take(next);
        added = true;
      }
    }
    if (!added) break;
  }

  return [...picked.values()].sort(byRoute);
}

// ── Travel legs ──────────────────────────────────────────────────────────────

/** Every leg the optimizer needs, plus where the numbers came from */
export interface PlanLegs {
  direct: TravelLeg;
  origin: Array<TravelLeg | null>;
  destination: Array<TravelLeg | null>;
  between: Array<Array<TravelLeg | null>>;
  quality: PlanQuality;
}

/**
 * Geometric fallback when no road matrix can be obtained (offline demo,
 * matrix request failed, provider without a matrix endpoint). Model: driving
 * between two points on the corridor follows the route between their
 * projections, plus a perpendicular access hop per off-route endpoint —
 * crow-flies lifted by CROW_ROAD_FACTOR at local-road speed. Honest about
 * being an estimate: plans built on it carry quality 'estimated'.
 */
export function estimatePlanLegs(route: Route, candidates: readonly RouteCandidate[]): PlanLegs {
  const minPerKm = route.distanceKm > 0 ? route.durationMin / route.distanceKm : 1;
  const accessKm = (c: RouteCandidate) => c.offRouteKm * CROW_ROAD_FACTOR;
  const leg = (alongKm: number, extraKm: number): TravelLeg => ({
    distanceKm: alongKm + extraKm,
    durationMin: alongKm * minPerKm + extraKm * OFF_ROUTE_MIN_PER_KM,
  });

  return {
    direct: { distanceKm: route.distanceKm, durationMin: route.durationMin },
    origin: candidates.map((c) => leg(c.projectionKm, accessKm(c))),
    destination: candidates.map((c) => leg(route.distanceKm - c.projectionKm, accessKm(c))),
    // Forward pairs under the SAME total order the optimizer sorts its graph by
    // — comparing projectionKm alone left two stations at an identical
    // projection unable to chain in either direction, though the solver orders
    // them by id and would happily drive from one to the other.
    between: candidates.map((a) =>
      candidates.map((b) =>
        byRoute(a, b) < 0
          ? leg(Math.max(0, b.projectionKm - a.projectionKm), accessKm(a) + accessKm(b))
          : null,
      ),
    ),
    quality: 'estimated',
  };
}

/**
 * Reshape a provider's square matrix over [origin, ...candidates, destination]
 * into optimizer legs. Returns null when the matrix does not match the
 * candidate set (caller falls back to the estimate).
 */
export function matrixPlanLegs(
  cells: ReadonlyArray<ReadonlyArray<TravelLeg | null>>,
  candidateCount: number,
  route: Route,
): PlanLegs | null {
  const size = candidateCount + 2;
  if (cells.length !== size || cells.some((row) => row.length !== size)) return null;
  const destCol = size - 1;
  return {
    // The matrix's own origin→destination keeps every comparison on one scale;
    // the route's figures only step in when that cell is unroutable.
    direct: cells[0][destCol] ?? { distanceKm: route.distanceKm, durationMin: route.durationMin },
    origin: cells[0].slice(1, destCol).map((c) => c ?? null),
    destination: cells.slice(1, destCol).map((row) => row[destCol] ?? null),
    between: cells.slice(1, destCol).map((row) => row.slice(1, destCol).map((c) => c ?? null)),
    quality: 'routed',
  };
}
