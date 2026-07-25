// Real routing.
// – Default: OSRM public demo (fast, but its car profile has no exclusions).
// – « Éviter autoroutes / péages » : Valhalla (FOSSGIS public server), whose
//   costing options support use_highways / use_tolls.
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import type { ReachInfo, Route, RouteOptions, RouteProvider } from '../types';

const OSRM_ROOT = IS_DEV ? '/proxy/osrm' : 'https://router.project-osrm.org';
const OSRM_BASE = OSRM_ROOT + '/route/v1/driving';
const OSRM_TABLE_BASE = OSRM_ROOT + '/table/v1/driving';
const VALHALLA_ROOT = IS_DEV ? '/proxy/valhalla' : 'https://valhalla1.openstreetmap.de';
const VALHALLA_BASE = VALHALLA_ROOT + '/route';
const VALHALLA_MATRIX_BASE = VALHALLA_ROOT + '/sources_to_targets';
const TIMEOUT_MS = 12000;
/**
 * Hard ceiling one travel-matrix call may carry, whichever backend answers: the
 * FOSSGIS Valhalla instance caps matrix locations at 50 per side and OSRM's
 * public demo table accepts more, so the stricter one governs both. The store
 * asks for fewer than this today (MATRIX_MAX_POINTS) — this value is what the
 * SERVER will take, not what we choose to send.
 */
const TRAVEL_MATRIX_MAX_POINTS = 50;

// ── OSRM ─────────────────────────────────────────────────────────────────────
interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: unknown };
  }>;
}

async function osrmRoute(from: GeoPoint, to: GeoPoint): Promise<Route> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&alternatives=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const json = (await res.json()) as OsrmResponse;
  const route = json.routes?.[0];
  if (json.code !== 'Ok' || !route) throw new Error(`OSRM code ${json.code ?? 'unknown'}`);

  const rawCoords = route.geometry?.coordinates;
  const polyline: GeoPoint[] = [];
  if (Array.isArray(rawCoords)) {
    for (const c of rawCoords) {
      if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
        polyline.push({ lat: c[1], lng: c[0] });
      }
    }
  }
  if (!polyline.length) throw new Error('OSRM empty geometry');

  return {
    distanceKm: (route.distance ?? 0) / 1000,
    durationMin: (route.duration ?? 0) / 60,
    polyline,
  };
}

// ── OSRM table (one-to-many road distances) ──────────────────────────────────
interface OsrmTableResponse {
  code?: string;
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

async function osrmReachMatrix(
  from: GeoPoint,
  targets: GeoPoint[],
): Promise<Array<ReachInfo | null>> {
  if (!targets.length) return [];
  // 5 decimals ≈ 1 m — keeps the URL short with dozens of coordinates
  const coords = [from, ...targets]
    .map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`)
    .join(';');
  const url = `${OSRM_TABLE_BASE}/${coords}?sources=0&annotations=duration,distance`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const json = (await res.json()) as OsrmTableResponse;
  // Row 0 covers every coordinate, origin included — targets start at column 1
  const durations = json.durations?.[0];
  const distances = json.distances?.[0];
  if (json.code !== 'Ok' || !durations || !distances)
    throw new Error(`OSRM table code ${json.code ?? 'unknown'}`);
  return targets.map((_, i) => {
    const meters = distances[i + 1];
    const seconds = durations[i + 1];
    return meters != null && seconds != null
      ? { distanceKm: meters / 1000, durationMin: seconds / 60 }
      : null;
  });
}

// ── OSRM table (full square matrix for the route fuel-stop plan) ─────────────
async function osrmTravelMatrix(points: GeoPoint[]): Promise<Array<Array<ReachInfo | null>>> {
  if (!points.length) return [];
  const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  // No sources/destinations restriction: every point is source AND target
  const url = `${OSRM_TABLE_BASE}/${coords}?annotations=duration,distance`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const json = (await res.json()) as OsrmTableResponse;
  const { durations, distances } = json;
  if (json.code !== 'Ok' || !durations || !distances)
    throw new Error(`OSRM table code ${json.code ?? 'unknown'}`);
  return points.map((_, i) =>
    points.map((_, j) => {
      const meters = distances[i]?.[j];
      const seconds = durations[i]?.[j];
      return meters != null && seconds != null
        ? { distanceKm: meters / 1000, durationMin: seconds / 60 }
        : null;
    }),
  );
}

// ── Valhalla ─────────────────────────────────────────────────────────────────
/**
 * Decode a Valhalla shape string (Google polyline, 1e-6 precision)
 * @internal exported for unit tests
 */
export function decodePolyline6(encoded: string): GeoPoint[] {
  const out: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    out.push({ lat: lat / 1e6, lng: lng / 1e6 });
  }
  return out;
}

interface ValhallaResponse {
  trip?: {
    summary?: { length?: number; time?: number };
    legs?: Array<{ shape?: string }>;
  };
}

/** Costing profile + options shared by the route and matrix calls */
function valhallaCosting(opts: RouteOptions): {
  costing: string;
  costing_options: Record<string, Record<string, number>>;
} {
  const costing = opts.vehicle === 'motorcycle' ? 'motorcycle' : 'auto';
  return {
    costing,
    costing_options: {
      [costing]: {
        ...(opts.avoidMotorway ? { use_highways: 0 } : {}),
        ...(opts.avoidToll ? { use_tolls: 0 } : {}),
      },
    },
  };
}

async function valhallaRoute(from: GeoPoint, to: GeoPoint, opts: RouteOptions): Promise<Route> {
  const body = {
    locations: [
      { lat: from.lat, lon: from.lng },
      { lat: to.lat, lon: to.lng },
    ],
    ...valhallaCosting(opts),
    directions_type: 'none',
  };
  const url = `${VALHALLA_BASE}?json=${encodeURIComponent(JSON.stringify(body))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Valhalla HTTP ${res.status}`);
  const json = (await res.json()) as ValhallaResponse;
  const trip = json.trip;
  if (!trip?.summary || !trip.legs?.length) throw new Error('Valhalla empty trip');

  const polyline = trip.legs.flatMap((leg) => (leg.shape ? decodePolyline6(leg.shape) : []));
  if (!polyline.length) throw new Error('Valhalla empty shape');

  return {
    distanceKm: trip.summary.length ?? 0,
    durationMin: (trip.summary.time ?? 0) / 60,
    polyline,
  };
}

// ── Valhalla sources_to_targets (matrix for avoid-options / motorcycle) ──────
// Official matrix endpoint of the same public FOSSGIS instance the route call
// uses — distances come back in km, times in seconds; unroutable pairs carry
// null fields. https://valhalla.github.io/valhalla/api/matrix/api-reference/
interface ValhallaMatrixResponse {
  sources_to_targets?: Array<Array<{ distance?: number | null; time?: number | null }>>;
}

async function valhallaTravelMatrix(
  points: GeoPoint[],
  opts: RouteOptions,
): Promise<Array<Array<ReachInfo | null>>> {
  if (!points.length) return [];
  const locations = points.map((p) => ({ lat: p.lat, lon: p.lng }));
  const body = {
    sources: locations,
    targets: locations,
    ...valhallaCosting(opts),
    units: 'kilometers',
  };
  const url = `${VALHALLA_MATRIX_BASE}?json=${encodeURIComponent(JSON.stringify(body))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Valhalla HTTP ${res.status}`);
  const json = (await res.json()) as ValhallaMatrixResponse;
  const rows = json.sources_to_targets;
  if (!rows || rows.length !== points.length) throw new Error('Valhalla matrix shape');
  return rows.map((row) =>
    points.map((_, j) => {
      const cell = row[j];
      return cell && cell.distance != null && cell.time != null
        ? { distanceKm: cell.distance, durationMin: cell.time / 60 }
        : null;
    }),
  );
}

// ── Provider ─────────────────────────────────────────────────────────────────
export class RealRouteProvider implements RouteProvider {
  async getRoute(from: GeoPoint, to: GeoPoint, options: RouteOptions = {}): Promise<Route> {
    // Valhalla handles everything OSRM's demo profile can't: road-class /
    // toll avoidance and the motorcycle profile.
    if (options.avoidMotorway || options.avoidToll || options.vehicle === 'motorcycle') {
      return valhallaRoute(from, to, options);
    }
    return osrmRoute(from, to);
  }

  // Road-class / vehicle nuances shift a short hop by seconds, not km — the
  // plain car profile is accurate enough for every profile here.
  getReachMatrix(from: GeoPoint, targets: GeoPoint[]): Promise<Array<ReachInfo | null>> {
    return osrmReachMatrix(from, targets);
  }

  readonly travelMatrixMaxPoints = TRAVEL_MATRIX_MAX_POINTS;

  // Same split as getRoute, so the matrix legs live on the same cost model as
  // the route they annotate: Valhalla when an avoid option or the motorcycle
  // profile is on, OSRM's table endpoint otherwise.
  getTravelMatrix(
    points: GeoPoint[],
    options: RouteOptions = {},
  ): Promise<Array<Array<ReachInfo | null>>> {
    if (options.avoidMotorway || options.avoidToll || options.vehicle === 'motorcycle') {
      return valhallaTravelMatrix(points, options);
    }
    return osrmTravelMatrix(points);
  }
}
