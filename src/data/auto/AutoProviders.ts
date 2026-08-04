// « Automatic » — every real source rendered on the same map.
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
  GeocodeSearchOptions,
  SourceCapabilities,
  Station,
  StationsFetchOptions,
  StationsProvider,
} from '../types';
import { FrStationsProvider } from '../fr/FrStationsProvider';
import { BanGeocodeProvider } from '../fr/BanGeocodeProvider';
import { EsStationsProvider, esCoversAlong, esCoversNear } from '../es/EsStationsProvider';
import { CartoCiudadGeocodeProvider } from '../es/CartoCiudadGeocodeProvider';
import { AdStationsProvider, adCoversAlong, adCoversNear } from '../ad/AdStationsProvider';
import { AdGeocodeProvider } from '../ad/AdGeocodeProvider';
import { PtStationsProvider, ptCoversAlong, ptCoversNear } from '../pt/PtStationsProvider';
import { PhotonGeocodeProvider } from '../pt/PhotonGeocodeProvider';
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

function frCoversNear(center: GeoPoint, radiusKm: number): boolean {
  return FRA_COVERAGE.some(([lat, lng, r]) => haversineKm(center, { lat, lng }) <= r + radiusKm);
}

function frCoversAlong(polyline: GeoPoint[], corridorKm: number): boolean {
  return FRA_COVERAGE.some(
    ([lat, lng, r]) => nearestOnPolyline({ lat, lng }, polyline).distKm <= r + corridorKm,
  );
}

// ── Stations ─────────────────────────────────────────────────────────────────
// Every source caps its own near-query (300 in fr and es), but the merge used
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

  private readonly fr = new FrStationsProvider();
  private readonly es = new EsStationsProvider();
  private readonly ad = new AdStationsProvider();
  private readonly pt = new PtStationsProvider();

  async getStationsNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    const tasks: Promise<Station[]>[] = [];
    if (frCoversNear(center, radiusKm)) tasks.push(this.fr.getStationsNear(center, radiusKm, opts));
    if (esCoversNear(center, radiusKm)) tasks.push(this.es.getStationsNear(center, radiusKm, opts));
    if (adCoversNear(center, radiusKm)) tasks.push(this.ad.getStationsNear(center, radiusKm, opts));
    if (ptCoversNear(center, radiusKm)) tasks.push(this.pt.getStationsNear(center, radiusKm, opts));
    return capNearest(await mergeSettled(tasks), center);
  }

  // No cap on the corridor, deliberately: unlike a disc, a route has no centre
  // to rank against — the natural key (distance to the polyline) would thin the
  // widest part of the corridor rather than its far end, and a positional cut
  // would simply truncate the route. No single source caps its corridor either
  // (fr bounds it per sample point, es and ad by the corridor itself), so
  // « auto » would be the only source silently dropping stations off a long
  // route. The corridor is already narrow enough to keep the payload sane.
  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    const tasks: Promise<Station[]>[] = [];
    if (frCoversAlong(polyline, corridorKm)) tasks.push(this.fr.getStationsAlong(polyline, corridorKm));
    if (esCoversAlong(polyline, corridorKm)) tasks.push(this.es.getStationsAlong(polyline, corridorKm));
    if (adCoversAlong(polyline, corridorKm)) tasks.push(this.ad.getStationsAlong(polyline, corridorKm));
    if (ptCoversAlong(polyline, corridorKm)) tasks.push(this.pt.getStationsAlong(polyline, corridorKm));
    return mergeSettled(tasks);
  }
}

// ── Geocoding ────────────────────────────────────────────────────────────────
// The suggestion list scrolls, so it is worth carrying more than a screenful —
// four countries answering at once fill six rows with their first hits alone.
const MAX_RESULTS = 15;

/**
 * Merge geocoders that answer at their own pace. One slow source must not hold
 * the suggestions hostage (CartoCiudad has spells where it only answers after
 * its timeout, which used to make the whole search look dead), so what has
 * landed is published through `onPartial` as soon as it lands; the promise
 * resolves once EVERY source has concluded, which is what keeps a view's
 * spinner honest — results are already on screen while it still turns.
 *
 * `lists` are merged in the order given, so pass them in display order. The
 * call throws only when every source failed.
 */
export async function mergeAsTheyLand(
  tasks: readonly Promise<GeocodeResult[]>[],
  onPartial?: (results: GeocodeResult[]) => void,
): Promise<GeocodeResult[]> {
  const lists: GeocodeResult[][] = tasks.map(() => []);
  let landed = 0;
  let failed = 0;
  let firstReason: unknown;
  const merged = () => mergeByKind(lists).slice(0, MAX_RESULTS);

  await Promise.all(
    tasks.map((task, i) =>
      task.then(
        (value) => {
          lists[i] = value;
          landed++;
          // The last source to land is the promise's own result; publishing it
          // here too would only make every view render the same list twice.
          if (landed + failed < tasks.length) onPartial?.(merged());
        },
        (reason: unknown) => {
          failed++;
          if (firstReason === undefined) firstReason = reason;
        },
      ),
    ),
  );

  if (tasks.length > 0 && failed === tasks.length) throw firstReason;
  return merged();
}

export class AutoGeocodeProvider implements GeocodeProvider {
  private readonly ban = new BanGeocodeProvider();
  private readonly cartociudad = new CartoCiudadGeocodeProvider();
  private readonly ad = new AdGeocodeProvider();
  private readonly photon = new PhotonGeocodeProvider();

  search(query: string, opts?: GeocodeSearchOptions): Promise<GeocodeResult[]> {
    // Localities of all four countries first, then their streets, then their
    // house numbers; inside one kind the sources interleave in the order given
    // here — France, Andorra, Portugal, Spain — so no country fills the visible
    // rows on its own.
    const sources = [this.ban, this.ad, this.photon, this.cartociudad];
    return mergeAsTheyLand(
      sources.map((source) => source.search(query)),
      opts?.onPartial,
    );
  }
}
