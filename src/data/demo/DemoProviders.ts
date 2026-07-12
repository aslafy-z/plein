// Demo providers — offline, deterministic, with a small fake latency so the
// loading states of the app get exercised.
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, lerpPoint, nearestOnPolyline } from '../../lib/geo';
import type {
  GeocodeProvider,
  GeocodeResult,
  Route,
  RouteProvider,
  SourceCapabilities,
  Station,
  StationsProvider,
} from '../types';
import { DEMO_PLACES, DEMO_ROUTE_STATIONS, DEMO_STATIONS } from './demoData';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Strip accents + lowercase for forgiving text matching */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ── Stations ─────────────────────────────────────────────────────────────────
export class DemoStationsProvider implements StationsProvider {
  readonly id = 'demo' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true,
    label: 'Données de démonstration',
    sublabel: 'hors-ligne · jeu de données fictif',
  };

  async getStationsNear(center: GeoPoint, radiusKm: number): Promise<Station[]> {
    await delay(250);
    return DEMO_STATIONS.filter(
      (s) => haversineKm(center, { lat: s.lat, lng: s.lng }) <= radiusKm,
    );
  }

  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    await delay(250);
    // Demo coordinates are approximate → allow a little extra slack.
    const tol = corridorKm + 3;
    const pool = [...DEMO_STATIONS, ...DEMO_ROUTE_STATIONS];
    return pool.filter(
      (s) => nearestOnPolyline({ lat: s.lat, lng: s.lng }, polyline).distKm <= tol,
    );
  }
}

// ── Geocoder ─────────────────────────────────────────────────────────────────
export class DemoGeocodeProvider implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    await delay(250);
    const q = norm(query);
    if (!q) return [];
    return DEMO_PLACES.filter((p) => {
      const label = norm(p.label);
      return label.includes(q) || q.includes(label);
    }).map((p) => ({ label: p.label, sublabel: p.sublabel, point: p.point }));
  }
}

// ── Route ────────────────────────────────────────────────────────────────────
export class DemoRouteProvider implements RouteProvider {
  async getRoute(from: GeoPoint, to: GeoPoint): Promise<Route> {
    await delay(250);
    const steps = 80;
    const polyline: GeoPoint[] = [];
    for (let i = 0; i <= steps; i++) polyline.push(lerpPoint(from, to, i / steps));
    const distanceKm = haversineKm(from, to) * 1.25;
    const durationMin = (distanceKm / 110) * 60 + 15;
    return { distanceKm, durationMin, polyline };
  }
}
