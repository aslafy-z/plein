// « Automatique » — every real source rendered on the same map.
// Each source is queried only when its coverage area can intersect the
// searched zone / route corridor, so a Toulouse map costs zero Spanish
// requests and a Madrid one zero French requests, while the border shows
// several countries at once. One source failing must not blank the others'
// stations: the call only throws when every RELEVANT source failed (which
// lets the store fall back to demo data as usual).
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, nearestOnPolyline } from '../../lib/geo';
import type {
  GeocodeProvider,
  GeocodeResult,
  SourceCapabilities,
  Station,
  StationsFetchOptions,
  StationsProvider,
} from '../types';
import { FraStationsProvider } from '../fra/FraStationsProvider';
import { BanGeocodeProvider } from '../fra/BanGeocodeProvider';
import { EspStationsProvider, espCoversAlong, espCoversNear } from '../esp/EspStationsProvider';
import { CartoCiudadGeocodeProvider } from '../esp/CartoCiudadGeocodeProvider';
import { AndStationsProvider, andCoversAlong, andCoversNear } from '../and/AndStationsProvider';
import { AndGeocodeProvider } from '../and/AndGeocodeProvider';

// ── French flux coverage ─────────────────────────────────────────────────────
// The gouv flux serves métropole + DOM; the ODS API filters geographically
// server-side, so gating here only avoids pointless requests. [lat, lng, r km]
const FRA_COVERAGE: ReadonlyArray<readonly [number, number, number]> = [
  [46.6, 2.4, 620], // métropole + Corse
  [15.5, -61.3, 220], // Antilles
  [4.5, -53.0, 320], // Guyane
  [-21.1, 55.5, 80], // La Réunion
  [-12.8, 45.15, 60], // Mayotte
];

function fraCoversNear(center: GeoPoint, radiusKm: number): boolean {
  return FRA_COVERAGE.some(([lat, lng, r]) => haversineKm(center, { lat, lng }) <= r + radiusKm);
}

function fraCoversAlong(polyline: GeoPoint[], corridorKm: number): boolean {
  return FRA_COVERAGE.some(
    ([lat, lng, r]) => nearestOnPolyline({ lat, lng }, polyline).distKm <= r + corridorKm,
  );
}

// ── Stations ─────────────────────────────────────────────────────────────────
async function mergeSettled(tasks: Promise<Station[]>[]): Promise<Station[]> {
  if (tasks.length === 0) return [];
  const settled = await Promise.allSettled(tasks);
  const ok = settled.filter((s): s is PromiseFulfilledResult<Station[]> => s.status === 'fulfilled');
  if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  return ok.flatMap((s) => s.value);
}

export class AutoStationsProvider implements StationsProvider {
  readonly id = 'auto' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true,
    label: 'Automatique',
    sublabel: 'France + Espagne + Andorre selon la zone',
  };

  private readonly fra = new FraStationsProvider();
  private readonly esp = new EspStationsProvider();
  private readonly and = new AndStationsProvider();

  async getStationsNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    const tasks: Promise<Station[]>[] = [];
    if (fraCoversNear(center, radiusKm)) tasks.push(this.fra.getStationsNear(center, radiusKm, opts));
    if (espCoversNear(center, radiusKm)) tasks.push(this.esp.getStationsNear(center, radiusKm, opts));
    if (andCoversNear(center, radiusKm)) tasks.push(this.and.getStationsNear(center, radiusKm, opts));
    return mergeSettled(tasks);
  }

  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    const tasks: Promise<Station[]>[] = [];
    if (fraCoversAlong(polyline, corridorKm)) tasks.push(this.fra.getStationsAlong(polyline, corridorKm));
    if (espCoversAlong(polyline, corridorKm)) tasks.push(this.esp.getStationsAlong(polyline, corridorKm));
    if (andCoversAlong(polyline, corridorKm)) tasks.push(this.and.getStationsAlong(polyline, corridorKm));
    return mergeSettled(tasks);
  }
}

// ── Geocoding ────────────────────────────────────────────────────────────────
const MAX_RESULTS = 6;

export class AutoGeocodeProvider implements GeocodeProvider {
  private readonly ban = new BanGeocodeProvider();
  private readonly cartociudad = new CartoCiudadGeocodeProvider();
  private readonly and = new AndGeocodeProvider();

  async search(query: string): Promise<GeocodeResult[]> {
    const [fr, es, ad] = await Promise.allSettled([
      this.ban.search(query),
      this.cartociudad.search(query),
      this.and.search(query), // static index — never actually rejects
    ]);
    if (fr.status === 'rejected' && es.status === 'rejected') throw fr.reason;
    const a = fr.status === 'fulfilled' ? fr.value : [];
    const b = es.status === 'fulfilled' ? es.value : [];
    const c = ad.status === 'fulfilled' ? ad.value : [];
    // Interleave (France first, then Andorra, then Spain) so every country
    // stays visible in the top 6
    const out: GeocodeResult[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < Math.max(a.length, b.length, c.length); i++) {
      for (const r of [a[i], c[i], b[i]]) {
        if (r && !seen.has(r.label)) {
          seen.add(r.label);
          out.push(r);
        }
      }
    }
    return out.slice(0, MAX_RESULTS);
  }
}
