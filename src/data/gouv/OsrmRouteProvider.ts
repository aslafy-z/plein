// OSRM public routing — https://router.project-osrm.org
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import type { Route, RouteProvider } from '../types';

const BASE =
  (IS_DEV ? '/proxy/osrm' : 'https://router.project-osrm.org') + '/route/v1/driving';
const TIMEOUT_MS = 9000;

interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: unknown };
  }>;
}

export class OsrmRouteProvider implements RouteProvider {
  async getRoute(from: GeoPoint, to: GeoPoint): Promise<Route> {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${BASE}/${coords}?overview=full&geometries=geojson&alternatives=false`;
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
}
