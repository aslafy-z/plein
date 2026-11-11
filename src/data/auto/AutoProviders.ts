// « Automatic » — every real source rendered on the same map.
// Each source is queried only when its coverage area can intersect the
// searched zone / route corridor, so a Toulouse map costs zero Spanish
// requests and a Madrid one zero French requests, while the border shows
// several countries at once. A failed source is never papered over by the
// others when its stations were REQUIRED: the store would cache the partial
// merge as a fresh, complete area — no banner, no retry until it goes stale.
// Near a point, the sources whose coverage contains the query centre own the
// zone and are required, a neighbour merely grazing the disc is not; along a
// route every relevant source is. A required failure rejects the call, which
// hands over to the store's failure path (painted data kept, error shown).
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
import { GeopfPoiGeocodeProvider } from '../fr/GeopfPoiGeocodeProvider';
import { EsStationsProvider, esCoversAlong, esCoversNear } from '../es/EsStationsProvider';
import { CartoCiudadGeocodeProvider } from '../es/CartoCiudadGeocodeProvider';
import { AdStationsProvider, adCoversAlong, adCoversNear } from '../ad/AdStationsProvider';
import { AdGeocodeProvider } from '../ad/AdGeocodeProvider';
import { PtStationsProvider, ptCoversAlong, ptCoversNear } from '../pt/PtStationsProvider';
import { PhotonGeocodeProvider } from '../pt/PhotonGeocodeProvider';
import { mergeByKind } from '../geocodeRank';

// ── French flux coverage ─────────────────────────────────────────────────────
// The gouv flux serves métropole + DOM; the ODS API filters geographically
// server-side, so gating here only avoids pointless requests — but a zone the
// circles miss gets NO French request at all, and its empty answer is cached as
// a success. Every territory the flux serves needs its own circle: the
// mainland one stops ~50 km short of Calvi and ~170 km short of Bonifacio, and
// Saint-Martin / Saint-Barthélemy sit ~340 km north-west of the Guadeloupe ·
// Martinique one. [lat, lng, r km]
const FRA_COVERAGE: ReadonlyArray<readonly [number, number, number]> = [
  [46.6, 2.4, 620], // mainland
  [42.15, 9.1, 110], // Corsica
  [15.5, -61.3, 220], // Guadeloupe · Martinique
  [18.0, -62.95, 40], // Saint-Martin · Saint-Barthélemy
  [4.5, -53.0, 320], // Guyane
  [-21.1, 55.5, 80], // La Réunion
  [-12.8, 45.15, 60], // Mayotte
];

export function frCoversNear(center: GeoPoint, radiusKm: number): boolean {
  return FRA_COVERAGE.some(([lat, lng, r]) => haversineKm(center, { lat, lng }) <= r + radiusKm);
}

export function frCoversAlong(polyline: GeoPoint[], corridorKm: number): boolean {
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

/** One source's share of a merged query. */
interface SourceTask {
  task: Promise<Station[]>;
  /** A failure of this source fails the whole query rather than thinning it. */
  required: boolean;
}

async function mergeSettled(tasks: SourceTask[]): Promise<Station[]> {
  if (tasks.length === 0) return [];
  const settled = await Promise.allSettled(tasks.map((t) => t.task));
  const failed = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
  const requiredFailure = settled.find(
    (s, i): s is PromiseRejectedResult => s.status === 'rejected' && tasks[i].required,
  );
  if (requiredFailure) throw requiredFailure.reason;
  if (failed.length === tasks.length) throw failed[0].reason;
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
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
    const tasks: SourceTask[] = [];
    // Radius 0 asks whether the coverage contains the centre itself: that
    // source owns the zone, and the merge is not a result without it.
    if (frCoversNear(center, radiusKm)) {
      tasks.push({ task: this.fr.getStationsNear(center, radiusKm, opts), required: frCoversNear(center, 0) });
    }
    if (esCoversNear(center, radiusKm)) {
      tasks.push({ task: this.es.getStationsNear(center, radiusKm, opts), required: esCoversNear(center, 0) });
    }
    if (adCoversNear(center, radiusKm)) {
      tasks.push({ task: this.ad.getStationsNear(center, radiusKm, opts), required: adCoversNear(center, 0) });
    }
    if (ptCoversNear(center, radiusKm)) {
      tasks.push({ task: this.pt.getStationsNear(center, radiusKm, opts), required: ptCoversNear(center, 0) });
    }
    const merged = await mergeSettled(tasks);
    const nearest = capNearest(merged, center);
    // The merge's own cut is a cap like a source's: the disc is complete only
    // up to the farthest station kept (a source's own report passes through
    // `opts` untouched, and the caller keeps the smallest).
    if (nearest.length < merged.length) {
      opts?.onCapped?.(
        Math.max(0, ...nearest.map((st) => haversineKm(center, { lat: st.lat, lng: st.lng }))),
      );
    }
    return nearest;
  }

  // No cap on the corridor, deliberately: unlike a disc, a route has no centre
  // to rank against — the natural key (distance to the polyline) would thin the
  // widest part of the corridor rather than its far end, and a positional cut
  // would simply truncate the route. No single source caps its corridor either
  // (fr bounds it per sample point, es and ad by the corridor itself), so
  // « auto » would be the only source silently dropping stations off a long
  // route. The corridor is already narrow enough to keep the payload sane.
  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    // Every relevant source is required: a route has no centre to name an
    // owner, and a corridor missing one country's stations would plan fuel
    // stops as if that stretch had none.
    const tasks: SourceTask[] = [];
    const add = (task: Promise<Station[]>) => tasks.push({ task, required: true });
    if (frCoversAlong(polyline, corridorKm)) add(this.fr.getStationsAlong(polyline, corridorKm));
    if (esCoversAlong(polyline, corridorKm)) add(this.es.getStationsAlong(polyline, corridorKm));
    if (adCoversAlong(polyline, corridorKm)) add(this.ad.getStationsAlong(polyline, corridorKm));
    if (ptCoversAlong(polyline, corridorKm)) add(this.pt.getStationsAlong(polyline, corridorKm));
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
 * call throws only when every source failed; when only some did, the survivors
 * are returned and `onIncomplete` says so first — that merge is the best list
 * available, not the answer to the query, and must not be memoized as one.
 *
 * `query` is what the sources were asked: with it the merge puts the results
 * answering more of it first (`queryCoverage`), across sources whose own
 * relevance scores cannot be compared.
 */
export async function mergeAsTheyLand(
  tasks: readonly Promise<GeocodeResult[]>[],
  onPartial?: (results: GeocodeResult[]) => void,
  onIncomplete?: () => void,
  query?: string,
): Promise<GeocodeResult[]> {
  const lists: GeocodeResult[][] = tasks.map(() => []);
  let landed = 0;
  let failed = 0;
  let firstReason: unknown;
  const merged = () => mergeByKind(lists, query).slice(0, MAX_RESULTS);

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
  if (failed > 0) onIncomplete?.();
  return merged();
}

/**
 * Several geocoders behind one search box: every source is asked at once and
 * the list is `mergeAsTheyLand`'s — by kind first, and inside one kind the
 * sources interleave in the order given, so pass them in display order.
 */
export class MergedGeocodeProvider implements GeocodeProvider {
  constructor(private readonly sources: readonly GeocodeProvider[]) {}

  search(query: string, opts?: GeocodeSearchOptions): Promise<GeocodeResult[]> {
    const sources = this.sources;
    // A source that answered with part of its own list (some detail calls
    // failed) makes the merge incomplete just like a source that failed whole;
    // the caller hears about it once, whichever way it happened.
    let incomplete = false;
    const onIncomplete = () => {
      incomplete = true;
    };
    return mergeAsTheyLand(
      sources.map((source) => source.search(query, { onIncomplete })),
      opts?.onPartial,
      onIncomplete,
      query,
    ).then((results) => {
      if (incomplete) opts?.onIncomplete?.();
      return results;
    });
  }
}

/**
 * France: the BAN knows addresses and nothing else, so the IGN's points of
 * interest (airports, railway stations, monuments…) are merged next to it.
 */
export class FrGeocodeProvider extends MergedGeocodeProvider {
  constructor() {
    super([new BanGeocodeProvider(), new GeopfPoiGeocodeProvider()]);
  }
}

export class AutoGeocodeProvider extends MergedGeocodeProvider {
  constructor() {
    // Localities of all four countries first, then their points of interest,
    // streets and house numbers; inside one kind the sources interleave in the
    // order given here — France, Andorra, Portugal, Spain — so no country
    // fills the visible rows on its own.
    super([
      new BanGeocodeProvider(),
      new GeopfPoiGeocodeProvider(),
      new AdGeocodeProvider(),
      new PhotonGeocodeProvider(),
      new CartoCiudadGeocodeProvider(),
    ]);
  }
}
