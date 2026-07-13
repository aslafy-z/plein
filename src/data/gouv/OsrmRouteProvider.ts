// Real routing.
// – Default: OSRM public demo (fast, but its car profile has no exclusions).
// – « Éviter autoroutes / péages » : Valhalla (FOSSGIS public server), whose
//   costing options support use_highways / use_tolls.
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import type { Route, RouteOptions, RouteProvider } from '../types';

const OSRM_BASE =
  (IS_DEV ? '/proxy/osrm' : 'https://router.project-osrm.org') + '/route/v1/driving';
const VALHALLA_BASE = (IS_DEV ? '/proxy/valhalla' : 'https://valhalla1.openstreetmap.de') + '/route';
const TIMEOUT_MS = 12000;

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

// ── Valhalla ─────────────────────────────────────────────────────────────────
/** Decode a Valhalla shape string (Google polyline, 1e-6 precision) */
function decodePolyline6(encoded: string): GeoPoint[] {
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

async function valhallaRoute(from: GeoPoint, to: GeoPoint, opts: RouteOptions): Promise<Route> {
  const costing = opts.vehicle === 'moto' ? 'motorcycle' : 'auto';
  const body = {
    locations: [
      { lat: from.lat, lon: from.lng },
      { lat: to.lat, lon: to.lng },
    ],
    costing,
    costing_options: {
      [costing]: {
        ...(opts.avoidMotorway ? { use_highways: 0 } : {}),
        ...(opts.avoidToll ? { use_tolls: 0 } : {}),
      },
    },
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

// ── Provider ─────────────────────────────────────────────────────────────────
export class RealRouteProvider implements RouteProvider {
  async getRoute(from: GeoPoint, to: GeoPoint, options: RouteOptions = {}): Promise<Route> {
    // Valhalla handles everything OSRM's demo profile can't: road-class /
    // toll avoidance and the motorcycle profile.
    if (options.avoidMotorway || options.avoidToll || options.vehicle === 'moto') {
      return valhallaRoute(from, to, options);
    }
    return osrmRoute(from, to);
  }
}
