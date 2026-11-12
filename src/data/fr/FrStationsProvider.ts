// Real French government open data — instantaneous fuel-price flux.
// https://data.economie.gouv.fr (Opendatasoft Explore API v2.1)
// The flux is messy: fields arrive as numbers, strings, JSON strings, or absent,
// and raw coordinates are sometimes scaled by 1e5. We parse very defensively and
// throw on transport failure so the store can fall back to demo data.
import { IS_DEV } from '../../lib/env';
import { enrichWithBrands, fuelPoisAlong, fuelPoisNear } from './osmBrands';
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, nearestOnPolyline, samplePolyline } from '../../lib/geo';
import type { DayHours, StationHours } from '../../lib/hours';
import { titleCase } from '../../lib/text';
import type {
  FuelId,
  FuelPrice,
  ServiceTag,
  SourceCapabilities,
  Station,
  StationsFetchOptions,
  StationsProvider,
} from '../types';

// In dev the call goes through the Vite proxy (see vite.config.ts) so the app
// gets live data even when the browser has no direct internet access.
const DATASET =
  (IS_DEV ? '/proxy/fr' : 'https://data.economie.gouv.fr') +
  '/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2';
const ENDPOINT = DATASET + '/records';
const EXPORT_ENDPOINT = DATASET + '/exports/json';

const PAGE = 100;
const NEAR_CAP = 300;
const TIMEOUT_MS = 9000;

// ── Corridor fetch ───────────────────────────────────────────────────────────
// A route's stations come from the dataset's EXPORT endpoint, which answers a
// query whole instead of 100 rows at a time. The corridor used to be ten wide
// discs paged through `/records`: 14 pages for Toulouse → Nice, 23 for Turin →
// Lille, some 300 kB of JSON each, most of it stations tens of km off the road
// — and one page lost in that many was enough to fail the whole stage. It is
// now a string of small discs hugging the road, OR-ed into a handful of
// requests (five for those 1000 km).
/** Spacing of the discs along the route */
const ALONG_STEP_KM = 15;
/** Discs OR-ed into one request: ~240 km of road, a URL well under 2 kB */
const ALONG_DISCS_PER_REQUEST = 16;
const CONCURRENCY = 4;
/** One retry: a public endpoint drops the odd connection, and the stage is
    all-or-nothing — a stretch without its stations would be planned as empty */
const ALONG_ATTEMPTS = 2;
const ALONG_RETRY_DELAY_MS = 400;

const MIN_PRICE = 0.5;
const MAX_PRICE = 3.5;

type Raw = Record<string, unknown>;

// ── Small typed coercions from unknown JSON ──────────────────────────────────
function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toStr(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

// ── Timestamps ───────────────────────────────────────────────────────────────
// The flux writes Paris wall clocks with no zone (`maj="2026-11-08 00:01:00"`
// in the XML), and the ODS republication types those columns as datetimes
// WITHOUT converting them: it renders the same digits as UTC
// (`2026-11-08T00:01:00+00:00`), an instant one hour late in winter and two
// in summer — the dataset carries prices « updated » after its own
// `data_processed`. So the digits are the truth and the offset is noise:
// read whatever arrives as a UTC instant, take its wall clock, and place that
// wall clock in Europe/Paris. Rendered in another `timezone`, the ODS value is
// still the same mislabelled instant, so this holds whatever offset it wears.

const PARIS_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Paris UTC offset in ms at a given instant (+1 h in winter, +2 h in summer) */
function parisOffsetMs(t: number): number {
  const p: Record<string, number> = {};
  for (const part of PARIS_PARTS.formatToParts(new Date(t))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(t / 1000) * 1000;
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * A flux timestamp → ISO UTC instant, its digits read as Paris wall clock.
 * Absent or unparseable → undefined.
 * @internal exported for unit tests
 */
export function parseFluxTimestamp(v: unknown): string | undefined {
  const s = toStr(v)?.trim();
  if (!s) return undefined;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  let wall: number;
  if (hasZone) {
    // The UTC rendering of the instant ODS stored IS the Paris wall clock
    wall = Date.parse(s);
    if (!Number.isFinite(wall)) return undefined;
  } else {
    const m = STAMP.exec(s);
    if (!m) return undefined;
    wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  // Two passes: the offset at the wall clock's UTC reading can be the wrong
  // side of a DST switch; the offset at the first estimate is not
  let t = wall - parisOffsetMs(wall);
  t = wall - parisOffsetMs(t);
  return new Date(t).toISOString();
}

function inPriceRange(v: number): boolean {
  return v >= MIN_PRICE && v <= MAX_PRICE;
}

// ── Coordinates ──────────────────────────────────────────────────────────────
/** @internal exported for unit tests */
export function parseCoords(rec: Raw): GeoPoint | null {
  const geom = rec.geom;
  if (geom && typeof geom === 'object') {
    const g = geom as Raw;
    const lon = toNum(g.lon);
    const lat = toNum(g.lat);
    if (lon != null && lat != null) return { lat, lng: lon };
    const geometry = g.geometry;
    const coords =
      geometry && typeof geometry === 'object'
        ? (geometry as Raw).coordinates
        : g.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = toNum(coords[0]);
      const la = toNum(coords[1]);
      if (lng != null && la != null) return { lat: la, lng };
    }
  }
  let lat = toNum(rec.latitude);
  let lng = toNum(rec.longitude);
  if (lat == null || lng == null) return null;
  // Raw flux stores coordinates scaled ×1e5 (e.g. 4574060 for 45.7406).
  if (Math.abs(lat) > 90) {
    lat /= 100000;
    lng /= 100000;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// ── Prices ───────────────────────────────────────────────────────────────────
// Left column: our fuel id. The other two are the flux's own column names.
const FUEL_COLS: ReadonlyArray<readonly [FuelId, string, string]> = [
  ['diesel', 'gazole_prix', 'gazole_maj'],
  ['e10', 'e10_prix', 'e10_maj'],
  ['unleaded98', 'sp98_prix', 'sp98_maj'],
  ['unleaded95', 'sp95_prix', 'sp95_maj'],
  ['e85', 'e85_prix', 'e85_maj'],
  ['lpg', 'gplc_prix', 'gplc_maj'],
];

/** Map a free-text fuel name to a FuelId (order matters: E10 before SP95). */
function fuelFromName(name: string): FuelId | null {
  const n = name.toLowerCase();
  if (n.includes('gazole') || n.includes('diesel')) return 'diesel';
  if (n.includes('e85')) return 'e85';
  if (n.includes('gpl')) return 'lpg';
  if (n.includes('e10') || n.includes('sp95-e10')) return 'e10';
  if (n.includes('98')) return 'unleaded98';
  if (n.includes('95')) return 'unleaded95';
  return null;
}

export interface RawPrice {
  name: string;
  value: number;
  maj?: string;
}

/**
 * `prix` may be a JSON string, a single object, or an already-parsed array.
 * @internal exported for unit tests
 */
export function parsePriceField(v: unknown): RawPrice[] {
  let data: unknown = v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try {
      data = JSON.parse(s);
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  const out: RawPrice[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Raw;
    const name = toStr(o['@nom'] ?? o.nom);
    const value = toNum(o['@valeur'] ?? o.valeur);
    const maj = toStr(o['@maj'] ?? o.maj);
    if (name && value != null) out.push({ name, value, maj });
  }
  return out;
}

/** @internal exported for unit tests */
export function parsePrices(rec: Raw): Partial<Record<FuelId, FuelPrice>> {
  const out: Partial<Record<FuelId, FuelPrice>> = {};
  for (const [fuel, col, majCol] of FUEL_COLS) {
    const v = toNum(rec[col]);
    if (v != null && inPriceRange(v)) {
      out[fuel] = { value: v, updatedAt: parseFluxTimestamp(rec[majCol]) };
    }
  }
  if (Object.keys(out).length > 0) return out;
  // Fallback: parse the aggregated `prix` field.
  for (const p of parsePriceField(rec.prix)) {
    const fuel = fuelFromName(p.name);
    if (fuel && inPriceRange(p.value) && !out[fuel]) {
      out[fuel] = { value: p.value, updatedAt: parseFluxTimestamp(p.maj) };
    }
  }
  return out;
}

// ── Services + tags ──────────────────────────────────────────────────────────
/**
 * `services` may be a JSON string ({"service":[...]}), an array, or `//`-joined.
 * @internal exported for unit tests
 */
export function parseServices(rec: Raw): string[] {
  const v = rec.services;
  let data: unknown = v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        data = JSON.parse(s);
      } catch {
        data = s.split('//');
      }
    } else {
      data = s.split('//');
    }
  }
  let arr: unknown[] = [];
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object') {
    const svc = (data as Raw).service;
    if (Array.isArray(svc)) arr = svc;
  }
  return arr.map((x) => String(x).trim()).filter(Boolean);
}

// ── Opening hours ────────────────────────────────────────────────────────────
/**
 * "08.00" / "8:30" → minutes from midnight
 * @internal exported for unit tests
 */
export function parseClock(v: unknown): number | null {
  const s = toStr(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[.:h](\d{2})$/i);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * `horaires` is a JSON string (or object):
 * {"@automate-24-24":"1"|"","jour":[{"@id":"1","@nom":"Lundi","@ferme":"1"|"",
 *   "horaire":{"@ouverture":"08.00","@fermeture":"19.30"} | [...]}]}
 * Days flagged open but without time ranges stay absent (= unknown).
 * @internal exported for unit tests
 */
export function parseOpeningHours(rec: Raw): StationHours | undefined {
  const autoField = rec.horaires_automate_24_24;
  let auto24 = typeof autoField === 'string' && /oui/i.test(autoField);

  let data: unknown = rec.horaires;
  if (typeof data === 'string') {
    const s = data.trim();
    if (s) {
      try {
        data = JSON.parse(s);
      } catch {
        data = null;
      }
    } else data = null;
  }

  const days: Partial<Record<number, DayHours>> = {};
  if (data && typeof data === 'object') {
    const o = data as Raw;
    if (o['@automate-24-24'] === '1') auto24 = true;
    const jours = Array.isArray(o.jour) ? o.jour : o.jour ? [o.jour] : [];
    for (const j of jours) {
      if (!j || typeof j !== 'object') continue;
      const jr = j as Raw;
      const id = toNum(jr['@id'] ?? jr.id);
      if (id == null || id < 1 || id > 7) continue;
      const closed = jr['@ferme'] === '1' || jr.ferme === '1';
      const rawRanges = Array.isArray(jr.horaire) ? jr.horaire : jr.horaire ? [jr.horaire] : [];
      const ranges: DayHours['ranges'] = [];
      for (const r of rawRanges) {
        if (!r || typeof r !== 'object') continue;
        const rr = r as Raw;
        const open = parseClock(rr['@ouverture'] ?? rr.ouverture);
        const close = parseClock(rr['@fermeture'] ?? rr.fermeture);
        // "01.00 → 01.00" placeholders carry no information
        if (open == null || close == null || open === close) continue;
        ranges.push({ open, close });
      }
      if (closed) days[id] = { closed: true, ranges: [] };
      else if (ranges.length) days[id] = { closed: false, ranges };
    }
  }

  if (!auto24 && Object.keys(days).length === 0) return undefined;
  return { auto24, days };
}

/**
 * The gouv flux publishes a closed vocabulary of free-text service strings and
 * none of them mentions AdBlue, so `adBlue` is a tag this source can never
 * emit. « Vente d'additifs carburants » is bottled additives in the shop and
 * « Carburant additivé » is premium fuel at the pump: both feed `additives`,
 * neither asserts an AdBlue dispenser.
 * @internal exported for unit tests
 */
export function deriveTags(services: string[], rec: Raw): ServiceTag[] {
  const joined = services.join(' ');
  const tags: ServiceTag[] = [];
  const auto = rec.horaires_automate_24_24;
  const is24 =
    auto === true ||
    (typeof auto === 'string' && /oui/i.test(auto)) ||
    /automate.*24|24.*24/i.test(joined);
  if (is24) tags.push('open24h');
  if (/avage/i.test(joined)) tags.push('carWash');
  if (/outique/i.test(joined)) tags.push('shop');
  if (/onflage/i.test(joined)) tags.push('airPump');
  // « Carburant additivé » and « Vente d'additifs carburants » in the gouv flux
  if (/additiv/i.test(joined)) tags.push('additives');
  return tags;
}

// ── Misc ─────────────────────────────────────────────────────────────────────
function isHighway(rec: Raw): boolean {
  const pop = toStr(rec.pop) ?? '';
  return pop === 'A' || /^a(utoroute)?$/i.test(pop);
}

function parseRecord(rec: Raw): Station | null {
  const coords = parseCoords(rec);
  if (!coords) return null;
  const prices = parsePrices(rec);
  const ville = toStr(rec.ville) ?? '';
  const services = parseServices(rec);
  const id = toStr(rec.id) ?? `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
  const pretty = ville ? titleCase(ville) : '';
  return {
    // Prefixed like the Spanish and Andorran ones — the « Automatic »
    // source mixes the three and reads the country off the id
    id: `fr-${id}`,
    name: pretty ? `Station · ${pretty}` : 'Station',
    init: (ville.slice(0, 2) || 'ST').toUpperCase(),
    brand: undefined,
    lat: coords.lat,
    lng: coords.lng,
    address: toStr(rec.adresse) ?? '',
    city: ville,
    postalCode: toStr(rec.cp),
    prices,
    tags: deriveTags(services, rec),
    services,
    highway: isHighway(rec),
    hours: parseOpeningHours(rec),
  };
}

/**
 * Raw dataset id of a `fr-` station id, when it is the flux's own numeric
 * id. The flux types `id` as an int, so only these can go in an ODSQL
 * `id in (…)` list — the coordinate-fallback ids parseRecord mints for
 * records without one (`fr-43.60000,1.44000`) name no dataset row at all.
 * @internal exported for unit tests
 */
export function frDatasetId(id: string): number | null {
  const m = /^fr-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function buildUrl(
  center: GeoPoint,
  radiusKm: number,
  limit: number,
  offset: number,
  nearestFirst = false,
): string {
  // ODSQL POINT is lon lat order.
  const point = `geom'POINT(${center.lng} ${center.lat})'`;
  const params = new URLSearchParams({
    where: `within_distance(geom, ${point}, ${radiusKm}km)`,
    limit: String(limit),
    offset: String(offset),
  });
  // Nearest first, `id` breaking ties: offset paging is only sound over a
  // total order (without one a row can come back twice or never), and a
  // capped result must be the NEAREST stations, not whichever the index
  // happened to list first.
  if (nearestFirst) params.set('order_by', `distance(geom, ${point}), id`);
  return `${ENDPOINT}?${params.toString()}`;
}

interface Page {
  results: unknown[];
  /** Rows matching the query upstream, when the response says so */
  total?: number;
}

class FluxHttpError extends Error {
  constructor(readonly status: number) {
    super(`gouv flux HTTP ${status}`);
  }
}

async function fetchPageWithTotal(url: string, lowPriority = false): Promise<Page> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Background refreshes yield to user-visible requests (tiles, geocoding)
    priority: lowPriority ? 'low' : 'auto',
  });
  if (!res.ok) throw new FluxHttpError(res.status);
  const json = (await res.json()) as { total_count?: number; results?: unknown[] };
  return {
    results: Array.isArray(json.results) ? json.results : [],
    total: typeof json.total_count === 'number' ? json.total_count : undefined,
  };
}

async function fetchPage(url: string, lowPriority = false): Promise<unknown[]> {
  return (await fetchPageWithTotal(url, lowPriority)).results;
}

/**
 * The columns `parseRecord` reads — an export carries only these, which more
 * than halves the payload (the flux repeats every price and every shortage in
 * four or five derived columns).
 */
const EXPORT_COLUMNS = [
  'id',
  'latitude',
  'longitude',
  'geom',
  'cp',
  'pop',
  'adresse',
  'ville',
  'horaires',
  'horaires_automate_24_24',
  'services',
  'prix',
  ...FUEL_COLS.flatMap(([, priceCol, updatedCol]) => [priceCol, updatedCol]),
].join(',');

/** `where` clause matching every station inside any of `discs` */
function discsClause(discs: readonly GeoPoint[], radiusKm: number): string {
  return discs
    .map(
      (c) =>
        // 5 decimals ≈ 1 m: the radius is rounded up by a whole km anyway
        `within_distance(geom, geom'POINT(${c.lng.toFixed(5)} ${c.lat.toFixed(5)})', ${radiusKm}km)`,
    )
    .join(' or ');
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Every row matching `where`, in one answer. Transport failures, timeouts,
 * 429 and 5xx are retried once; any other refusal is final. A 400 on the
 * column list (the flux renaming one of them) falls back to whole records
 * rather than lose the corridor to a `select`.
 */
async function fetchExport(where: string): Promise<unknown[]> {
  let select: string | null = EXPORT_COLUMNS;
  let lastError: unknown;
  for (let attempt = 0; attempt < ALONG_ATTEMPTS; attempt++) {
    if (attempt > 0) await wait(ALONG_RETRY_DELAY_MS);
    const params = new URLSearchParams({ where });
    if (select) params.set('select', select);
    try {
      const res = await fetch(`${EXPORT_ENDPOINT}?${params.toString()}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 400 && select) {
        select = null;
        attempt--;
        continue;
      }
      if (!res.ok) {
        const err = new FluxHttpError(res.status);
        if (res.status !== 429 && res.status < 500) throw err;
        lastError = err;
        continue;
      }
      // The export is a bare array; a `{ results }` envelope is read too, so
      // anything answering in the `/records` shape still parses.
      const json = (await res.json()) as unknown;
      if (Array.isArray(json)) return json;
      const results = (json as { results?: unknown } | null)?.results;
      return Array.isArray(results) ? results : [];
    } catch (err) {
      if (err instanceof FluxHttpError && err.status !== 429 && err.status < 500) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

export class FrStationsProvider implements StationsProvider {
  readonly id = 'fr' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true, // enriched from OpenStreetMap by proximity
  };

  async getStationsNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    // The static OSM brand index loads concurrently with the price pages
    const poisPromise = fuelPoisNear(center, radiusKm).catch(() => []);
    // Keyed by id: a row the flux moves between two pages must not show twice
    const byId = new Map<string, Station>();
    let nearestFirst = true;
    // More rows upstream than the cap lets through
    let capped = false;
    for (let offset = 0; offset < NEAR_CAP; offset += PAGE) {
      let page: Page;
      try {
        page = await fetchPageWithTotal(
          buildUrl(center, radiusKm, PAGE, offset, nearestFirst),
          opts?.lowPriority,
        );
      } catch (err) {
        // A flux that refuses the ordering clause still answers the plain
        // query: restart on it rather than lose the whole zone. What comes
        // back is then in upstream order, and claims no coverage if capped.
        if (!(nearestFirst && offset === 0 && err instanceof FluxHttpError && err.status === 400)) {
          throw err;
        }
        nearestFirst = false;
        offset = -PAGE;
        continue;
      }
      for (const r of page.results) {
        if (r && typeof r === 'object') {
          const st = parseRecord(r as Raw);
          if (st && !byId.has(st.id)) byId.set(st.id, st);
        }
      }
      if (page.results.length < PAGE) break;
      if (offset + PAGE >= NEAR_CAP) capped = page.total == null || page.total > NEAR_CAP;
    }
    const stations = [...byId.values()];
    if (capped) {
      // The disc is only complete up to the farthest station kept — and not
      // at all when the rows could not be asked for nearest first.
      const reachKm = nearestFirst
        ? Math.max(0, ...stations.map((st) => haversineKm(center, { lat: st.lat, lng: st.lng })))
        : 0;
      opts?.onCapped?.(Math.min(radiusKm, reachKm));
    }
    return enrichWithBrands(stations, await poisPromise);
  }

  /**
   * Exact and single-request (per PAGE ids): the flux answers `id in (…)`
   * server-side, so favorites spread over the whole country cost one small
   * page — no geo circle at all. Brands are NOT enriched here: the OSM POI
   * index is loaded by proximity and these ids share none; the callers (the
   * favorite-price refresh) consume prices alone, and the Favorites row renders
   * its own pinned snapshot.
   */
  async getStationsByIds(
    ids: readonly string[],
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    const numeric = ids
      .map(frDatasetId)
      .filter((n): n is number => n != null);
    const stations: Station[] = [];
    for (let i = 0; i < numeric.length; i += PAGE) {
      const chunk = numeric.slice(i, i + PAGE);
      const params = new URLSearchParams({
        where: `id in (${chunk.join(',')})`,
        limit: String(chunk.length),
      });
      const results = await fetchPage(`${ENDPOINT}?${params.toString()}`, opts?.lowPriority);
      for (const r of results) {
        if (r && typeof r === 'object') {
          const st = parseRecord(r as Raw);
          if (st) stations.push(st);
        }
      }
    }
    return stations;
  }

  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    const discs = samplePolyline(polyline, ALONG_STEP_KM);
    if (!discs.length) return [];

    // The discs must cover the whole corridor, so their radius is measured
    // rather than assumed from the spacing (a polyline's vertices are not
    // evenly spaced, and a long straight segment has none for km): the
    // farthest any route vertex sits from its nearest disc centre, plus the
    // corridor width. The corridor filter below is vertex-based too, so this
    // is exactly its reach. Centres follow the route, so the nearest one is
    // found walking forward — never a scan of every disc per vertex.
    let reachKm = 0;
    let near = 0;
    for (const v of polyline) {
      let best = haversineKm(v, discs[near]);
      while (near + 1 < discs.length) {
        const next = haversineKm(v, discs[near + 1]);
        if (next > best) break;
        best = next;
        near++;
      }
      if (best > reachKm) reachKm = best;
    }
    const radiusKm = Math.ceil(reachKm + corridorKm + 1);

    const groups: GeoPoint[][] = [];
    for (let i = 0; i < discs.length; i += ALONG_DISCS_PER_REQUEST) {
      groups.push(discs.slice(i, i + ALONG_DISCS_PER_REQUEST));
    }

    const byId = new Map<string, Station>();
    // A few lanes share the requests, so a very long route never opens more
    // than CONCURRENCY connections on a public API at once.
    let nextGroup = 0;
    const runLane = async () => {
      while (nextGroup < groups.length) {
        const rows = await fetchExport(discsClause(groups[nextGroup++], radiusKm));
        for (const r of rows) {
          if (r && typeof r === 'object') {
            const st = parseRecord(r as Raw);
            // Neighbouring requests overlap by a disc's width
            if (st && !byId.has(st.id)) byId.set(st.id, st);
          }
        }
      }
    };

    const poisPromise = fuelPoisAlong(polyline, corridorKm).catch(() => []);
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, groups.length) }, runLane));
    const inCorridor = [...byId.values()].filter(
      (st) => nearestOnPolyline({ lat: st.lat, lng: st.lng }, polyline).distKm <= corridorKm,
    );
    return enrichWithBrands(inCorridor, await poisPromise);
  }
}
