// Demo providers — offline, deterministic, with a small fake latency so the
// loading states of the app get exercised.
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, lerpPoint, nearestOnPolyline, polylineLengthKm } from '../../lib/geo';
import type {
  ChargeProvider,
  ChargeStation,
  GeocodeProvider,
  GeocodeResult,
  Route,
  RouteOptions,
  RouteProvider,
  SourceCapabilities,
  Station,
  StationsProvider,
} from '../types';
import { DEMO_PLACES, DEMO_ROUTE_STATIONS, DEMO_STATIONS } from './demoData';
import { DEMO_CHARGE_STATIONS } from './demoChargeData';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Anchor of the fictional dataset (Toulouse Capitole) */
const TOULOUSE: GeoPoint = { lat: 43.6047, lng: 1.4442 };

/**
 * Synthetic corridor stops used when a demo route doesn't follow one of the
 * pre-built axes (or when the user is geolocated far from Toulouse): fictional
 * motorway-area names that claim no real geography, placed deterministically
 * along the polyline. detourMin is encoded via a perpendicular offset
 * (the store estimates ~2 min per km off-route).
 */
const SYNTH_TEMPLATES: ReadonlyArray<{
  frac: number;
  name: string;
  init: string;
  brand: string;
  cat: Station['cat'];
  gazole: number;
  detourMin: number;
  highway: boolean;
  services: string[];
}> = [
  { frac: 0.14, name: 'Intermarché · Aire des Chênes', init: 'IN', brand: 'Intermarché', cat: 'gs', gazole: 1.71, detourMin: 4, highway: false, services: ['Ouvert 24/24', 'Lavage'] },
  { frac: 0.3, name: 'Total Relais · Aire du Val', init: 'TR', brand: 'TotalEnergies', cat: 'pet', gazole: 1.84, detourMin: 0, highway: true, services: ['Ouvert 24/24', 'Boutique', 'Gonflage'] },
  { frac: 0.46, name: 'Leclerc · Les Quatre Vents', init: 'LE', brand: 'E.Leclerc', cat: 'gs', gazole: 1.66, detourMin: 2, highway: false, services: ['Ouvert 24/24', 'Lavage', 'Boutique'] },
  { frac: 0.6, name: 'Carrefour · Porte du Sud', init: 'CA', brand: 'Carrefour', cat: 'gs', gazole: 1.63, detourMin: 9, highway: false, services: ['Boutique'] },
  { frac: 0.74, name: 'Avia · Relais des Bruyères', init: 'AV', brand: 'Avia', cat: 'ind', gazole: 1.68, detourMin: 7, highway: false, services: ['Gonflage'] },
  { frac: 0.88, name: 'Super U · La Croisée', init: 'SU', brand: 'Système U', cat: 'gs', gazole: 1.73, detourMin: 4, highway: false, services: ['Ouvert 24/24', 'Lavage', 'Boutique'] },
];

function synthCorridorStations(polyline: GeoPoint[]): Station[] {
  const updatedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  return SYNTH_TEMPLATES.map((t, i) => {
    const at = polyline[Math.min(polyline.length - 1, Math.round(t.frac * (polyline.length - 1)))];
    // ~2 min of detour per km off-route (see store), 1° lat ≈ 111 km
    const off = t.detourMin / 2 / 111;
    return {
      id: `synth-${i}`,
      name: t.name,
      init: t.init,
      brand: t.brand,
      cat: t.cat,
      lat: at.lat + (i % 2 === 0 ? off : -off),
      lng: at.lng,
      address: 'Aire de service',
      city: '',
      prices: {
        gazole: { value: t.gazole, updatedAt },
        e10: { value: +(t.gazole + 0.11).toFixed(2), updatedAt },
        e85: { value: +(t.gazole - 0.82).toFixed(2), updatedAt },
      },
      tags: t.services.map((s) => (s === 'Ouvert 24/24' ? '24/24' : s)) as Station['tags'],
      services: t.services,
      highway: t.highway,
      confirmations: 4 + i,
    };
  });
}

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
    // The fictional set surrounds Toulouse; for users geolocated elsewhere,
    // translate it around them so the demo works anywhere in France.
    const dLat = center.lat - TOULOUSE.lat;
    const dLng = center.lng - TOULOUSE.lng;
    const shift = haversineKm(center, TOULOUSE) > 30;
    const pool = shift
      ? DEMO_STATIONS.map((s) => ({ ...s, lat: s.lat + dLat, lng: s.lng + dLng }))
      : DEMO_STATIONS;
    return pool.filter(
      (s) => haversineKm(center, { lat: s.lat, lng: s.lng }) <= radiusKm,
    );
  }

  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    await delay(250);
    // Demo coordinates are approximate → allow a little extra slack.
    const tol = corridorKm + 3;
    const totalKm = polylineLengthKm(polyline);
    const pool = [...DEMO_STATIONS, ...DEMO_ROUTE_STATIONS];
    const found: { station: Station; alongKm: number }[] = [];
    for (const s of pool) {
      const near = nearestOnPolyline({ lat: s.lat, lng: s.lng }, polyline);
      if (near.distKm <= tol) found.push({ station: s, alongKm: near.alongKm });
    }
    // The pre-built axes only cover a few destinations. If the matches don't
    // actually spread along the route (e.g. all clustered near the departure),
    // add fictional corridor stops so the Trajet screen works from anywhere.
    const deep = found.filter((f) => f.alongKm > totalKm * 0.25).length;
    const stations = found.map((f) => f.station);
    if (deep < 3) return [...stations, ...synthCorridorStations(polyline)];
    return stations;
  }
}

// ── Charge stations ──────────────────────────────────────────────────────────
export class DemoChargeProvider implements ChargeProvider {
  async getChargeNear(center: GeoPoint, radiusKm: number): Promise<ChargeStation[]> {
    await delay(250);
    // Same trick as the fuel set: translate the fictional Toulouse stations
    // around users geolocated elsewhere so the demo works anywhere.
    const dLat = center.lat - TOULOUSE.lat;
    const dLng = center.lng - TOULOUSE.lng;
    const shift = haversineKm(center, TOULOUSE) > 30;
    const pool = shift
      ? DEMO_CHARGE_STATIONS.map((s) => ({ ...s, lat: s.lat + dLat, lng: s.lng + dLng }))
      : DEMO_CHARGE_STATIONS;
    return pool.filter((s) => haversineKm(center, { lat: s.lat, lng: s.lng }) <= radiusKm);
  }

  async getChargeAlong(polyline: GeoPoint[], corridorKm: number): Promise<ChargeStation[]> {
    await delay(250);
    const tol = corridorKm + 3;
    return DEMO_CHARGE_STATIONS.filter(
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
  async getRoute(from: GeoPoint, to: GeoPoint, options: RouteOptions = {}): Promise<Route> {
    await delay(250);
    const steps = 80;
    const polyline: GeoPoint[] = [];
    for (let i = 0; i <= steps; i++) polyline.push(lerpPoint(from, to, i / steps));
    const distanceKm = haversineKm(from, to) * 1.25;
    // Avoiding motorways → slower average speed in the fictional model
    const avgKmh = options.avoidMotorway ? 75 : 110;
    const durationMin = (distanceKm / avgKmh) * 60 + 15;
    return { distanceKm, durationMin, polyline };
  }
}
