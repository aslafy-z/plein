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
import { PrtStationsProvider, prtCoversAlong, prtCoversNear } from '../prt/PrtStationsProvider';
import { PhotonGeocodeProvider } from '../prt/PhotonGeocodeProvider';
import { mergeByKind } from '../geocodeRank';

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
// Every source caps its own near-query (300 in fra and esp), but the merge used
// to just concatenate them: a zone where two coverage areas overlap — Le
// Perthus, Irún, the Pas de la Case, i.e. exactly what « auto » exists for —
// returned up to ~660 stations where a single source returns 300. That payload
// then flows through every selector pass, the marker diff in MapCanvas and the
// JSON.stringify of writeStationsCache, so the merge caps like a source does.
const NEAR_CAP = 300;

async function mergeSettled(tasks: Promise<Station[]>[]): Promise<Station[]> {
  if (tasks.length === 0) return [];
  const settled = await Promise.allSettled(tasks);
  const ok = settled.filter((s): s is PromiseFulfilledResult<Station[]> => s.status === 'fulfilled');
  if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  return ok.flatMap((s) => s.value);
}

/**
 * Keep the `cap` stations nearest to `center`, mirroring what each source
 * already does on its own result set. Below the cap the list is returned
 * untouched, so a single-source zone keeps the exact order its source chose.
 */
export function capNearest(stations: Station[], center: GeoPoint, cap = NEAR_CAP): Station[] {
  if (stations.length <= cap) return stations;
  return stations
    .map((st) => ({ st, distKm: haversineKm(center, { lat: st.lat, lng: st.lng }) }))
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, cap)
    .map(({ st }) => st);
}

export class AutoStationsProvider implements StationsProvider {
  readonly id = 'auto' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true,
  };

  private readonly fra = new FraStationsProvider();
  private readonly esp = new EspStationsProvider();
  private readonly and = new AndStationsProvider();
  private readonly prt = new PrtStationsProvider();

  async getStationsNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    const tasks: Promise<Station[]>[] = [];
    if (fraCoversNear(center, radiusKm)) tasks.push(this.fra.getStationsNear(center, radiusKm, opts));
    if (espCoversNear(center, radiusKm)) tasks.push(this.esp.getStationsNear(center, radiusKm, opts));
    if (andCoversNear(center, radiusKm)) tasks.push(this.and.getStationsNear(center, radiusKm, opts));
    if (prtCoversNear(center, radiusKm)) tasks.push(this.prt.getStationsNear(center, radiusKm, opts));
    return capNearest(await mergeSettled(tasks), center);
  }

  // No cap on the corridor, deliberately: unlike a disc, a route has no centre
  // to rank against — the natural key (distance to the polyline) would thin the
  // widest part of the corridor rather than its far end, and a positional cut
  // would simply truncate the route. No single source caps its corridor either
  // (fra bounds it per sample point, esp and and by the corridor itself), so
  // « auto » would be the only source silently dropping stations off a long
  // route. The corridor is already narrow enough to keep the payload sane.
  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    const tasks: Promise<Station[]>[] = [];
    if (fraCoversAlong(polyline, corridorKm)) tasks.push(this.fra.getStationsAlong(polyline, corridorKm));
    if (espCoversAlong(polyline, corridorKm)) tasks.push(this.esp.getStationsAlong(polyline, corridorKm));
    if (andCoversAlong(polyline, corridorKm)) tasks.push(this.and.getStationsAlong(polyline, corridorKm));
    if (prtCoversAlong(polyline, corridorKm)) tasks.push(this.prt.getStationsAlong(polyline, corridorKm));
    return mergeSettled(tasks);
  }
}

// ── Geocoding ────────────────────────────────────────────────────────────────
// The suggestion list scrolls, so it is worth carrying more than a screenful —
// four countries answering at once fill six rows with their first hits alone.
const MAX_RESULTS = 15;
// Once one country has actual results, the laggards get this long to land
// before being dropped from this round of suggestions.
const SLOW_SOURCE_GRACE_MS = 1500;

export class AutoGeocodeProvider implements GeocodeProvider {
  private readonly ban = new BanGeocodeProvider();
  private readonly cartociudad = new CartoCiudadGeocodeProvider();
  private readonly and = new AndGeocodeProvider();
  private readonly photon = new PhotonGeocodeProvider();

  async search(query: string): Promise<GeocodeResult[]> {
    // Queried, and interleaved below, in this order: France, Andorra,
    // Portugal, Spain — so no country fills the visible rows on its own.
    const sources = [this.ban, this.and, this.photon, this.cartociudad];
    // One slow geocoder must not hold the suggestions hostage (CartoCiudad
    // has spells where it only answers after its 6 s timeout, which used to
    // make the whole search look dead): a source still pending after the
    // grace simply counts as empty for this keystroke.
    const settled: (PromiseSettledResult<GeocodeResult[]> | undefined)[] = [];
    const wrapped = sources.map((source, i) =>
      source.search(query).then(
        (value) => {
          settled[i] = { status: 'fulfilled', value };
          return value;
        },
        (reason: unknown) => {
          settled[i] = { status: 'rejected', reason };
          return null;
        },
      ),
    );
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<void>((resolve) => {
      for (const w of wrapped) {
        void w.then((value) => {
          if (value && value.length > 0 && graceTimer === undefined) {
            graceTimer = setTimeout(resolve, SLOW_SOURCE_GRACE_MS);
          }
        });
      }
    });
    await Promise.race([Promise.all(wrapped), grace]);
    clearTimeout(graceTimer);

    // A source still pending is a hole in `settled`, not a rejection — only a
    // round where every source actually failed is a failed search.
    const outcomes = sources.map((_, i) => settled[i]);
    const failures = outcomes.filter((s) => s?.status === 'rejected');
    if (failures.length === outcomes.length) {
      throw (failures[0] as PromiseRejectedResult).reason;
    }
    // Localities of all four countries first, then their streets, then their
    // house numbers; inside one kind the sources interleave in `sources` order
    // so every country stays visible at the top.
    const lists = outcomes.map((s) => (s?.status === 'fulfilled' ? s.value : []));
    return mergeByKind(lists).slice(0, MAX_RESULTS);
  }
}
