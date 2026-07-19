// Real German fuel prices — Tankerkönig (creativecommons.tankerkoenig.de),
// the open CC BY 4.0 relay of the official MTS-K flux (Markttransparenzstelle
// für Kraftstoffe, Bundeskartellamt). Stations report price changes within
// 5 minutes, so the flux is near real-time.
// The API needs a PERSONAL key (free registration on tankerkoenig.de) and
// Tankerkönig BLOCKS keys that get published — so the key never appears in
// this repository nor in the client bundle. The browser calls a same-origin
// proxy that holds it: the Vite middleware in dev (TANKERKOENIG_API_KEY env
// var, see vite.config.ts) and the Cloudflare Worker in production (Wrangler
// secret, see worker/index.ts, with a ~5 min edge cache to respect the API's
// ~1 request/min budget). Without a key the proxy answers 503, this provider
// throws, and the store falls back as usual — never fake data shown as real.
// `list.php` caps the search radius at 25 km, which matches the app's
// MAX_RADIUS_KM exactly; route corridors are covered by sampling circles whose
// spacing keeps every query under that cap.
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, nearestOnPolyline, polylineLengthKm, samplePolyline } from '../../lib/geo';
import { initialsOf, titleCase } from '../../lib/text';
import type {
  FuelId,
  FuelPrice,
  SourceCapabilities,
  Station,
  StationsFetchOptions,
  StationsProvider,
} from '../types';

const LIST_PATH = '/json/list.php';

/** Node (scripts/live-providers.mjs) hits the API directly — the key comes
 * from the TANKERKOENIG_API_KEY environment variable, never from code. */
function nodeApiKey(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.TANKERKOENIG_API_KEY;
}

function listUrl(params: URLSearchParams): string {
  const nodeKey = nodeApiKey();
  if (nodeKey) {
    params.set('apikey', nodeKey);
    return `https://creativecommons.tankerkoenig.de${LIST_PATH}?${params.toString()}`;
  }
  // Browser: same-origin key-holding proxy (Vite middleware / CF Worker)
  return `${IS_DEV ? '/proxy/de' : '/api/de'}${LIST_PATH}?${params.toString()}`;
}

const TIMEOUT_MS = 12000;
/** Tankerkönig asks consumers not to re-poll the same zone under ~5 min */
const CACHE_MS = 5 * 60_000;
/** Hard API limit of list.php */
const RAD_MAX_KM = 25;
const NEAR_CAP = 300;
/** Protects the API on very long routes; beyond it the corridor has gaps */
const MAX_SAMPLES = 40;
const CONCURRENCY = 4;

const MIN_PRICE = 0.5;
const MAX_PRICE = 3.5;

// ── Germany coverage ─────────────────────────────────────────────────────────
// One covering circle (centroid + radius reaching Sylt and Berchtesgaden).
const DE_CENTER: GeoPoint = { lat: 51.16, lng: 10.45 };
const DE_RADIUS_KM = 470;

/** Can the zone hold German stations at all? (drives the « Automatic » source) */
export function deCoversNear(center: GeoPoint, radiusKm: number): boolean {
  return haversineKm(center, DE_CENTER) <= DE_RADIUS_KM + radiusKm;
}

export function deCoversAlong(polyline: GeoPoint[], corridorKm: number): boolean {
  return nearestOnPolyline(DE_CENTER, polyline).distKm <= DE_RADIUS_KM + corridorKm;
}

// ── Parsing ──────────────────────────────────────────────────────────────────
interface RawStation {
  id?: unknown;
  name?: unknown;
  brand?: unknown;
  street?: unknown;
  houseNumber?: unknown;
  postCode?: unknown;
  place?: unknown;
  lat?: unknown;
  lng?: unknown;
  diesel?: unknown;
  e5?: unknown;
  e10?: unknown;
}

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toStr(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

// German pump grades: Diesel, Super E5 (95 octane, our unleaded95) and
// Super E10. The flux carries exactly these three columns.
const FUEL_COLS: ReadonlyArray<readonly [FuelId, keyof RawStation]> = [
  ['diesel', 'diesel'],
  ['unleaded95', 'e5'],
  ['e10', 'e10'],
];

/** "ARAL" → "Aral", but acronyms ("JET", "OMV", "HEM") and mixed-case
 * brands ("TotalEnergies", "bft") pass through untouched. */
function prettyBrand(raw: string): string {
  return raw === raw.toUpperCase() && raw.length > 3 ? titleCase(raw) : raw;
}

function parseRecord(rec: RawStation, updatedAt: string): Station | null {
  const lat = toNum(rec.lat);
  const lng = toNum(rec.lng);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const prices: Partial<Record<FuelId, FuelPrice>> = {};
  for (const [fuel, col] of FUEL_COLS) {
    const v = toNum(rec[col]);
    if (v != null && v >= MIN_PRICE && v <= MAX_PRICE) prices[fuel] = { value: v, updatedAt };
  }

  const rawBrand = toStr(rec.brand);
  const brand = rawBrand ? prettyBrand(rawBrand) : undefined;
  const name = toStr(rec.name);
  const rawPlace = toStr(rec.place);
  const city = rawPlace ? titleCase(rawPlace) : '';
  const rawStreet = toStr(rec.street);
  const street = rawStreet ? titleCase(rawStreet) : '';
  const address = [street, toStr(rec.houseNumber)].filter(Boolean).join(' ');
  const id = toStr(rec.id);
  const label = brand ?? name;

  return {
    id: id ? `de-${id}` : `de-${lat.toFixed(5)},${lng.toFixed(5)}`,
    name: label ? (city ? `${label} · ${city}` : label) : city ? `Station · ${city}` : 'Station',
    init: label ? initialsOf(label) : (city.slice(0, 2) || 'ST').toUpperCase(),
    brand,
    lat,
    lng,
    address,
    city,
    postalCode: toStr(rec.postCode),
    prices,
    // The flux exposes no service data and no weekly schedule (only in
    // detail.php, one call per station) — unknown stays unknown.
    tags: [],
    services: [],
    // Autobahn service areas: Autohof / BAB / "A 7"-style street names
    highway: /autohof|autobahn|\bbab\b/i.test(`${name ?? ''} ${street}`) || /^A ?\d+$/i.test(street),
  };
}

// ── HTTP (memoized per circle) ───────────────────────────────────────────────
interface DeResponse {
  ok?: boolean;
  status?: string;
  message?: string;
  stations?: unknown[];
}

const circleCache = new Map<string, { fetchedAt: number; stations: Station[] }>();

async function fetchCircle(
  center: GeoPoint,
  radiusKm: number,
  lowPriority = false,
): Promise<Station[]> {
  const rad = Math.min(radiusKm, RAD_MAX_KM);
  // ~110 m rounding: aligns the memo key, the edge-cache key and the upstream
  // query so nearby pans reuse the same cached circle.
  const lat = center.lat.toFixed(3);
  const lng = center.lng.toFixed(3);
  const key = `${lat}|${lng}|${rad}`;
  const hit = circleCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit.stations;

  const params = new URLSearchParams({
    lat,
    lng,
    rad: String(rad),
    sort: 'dist',
    type: 'all',
  });
  const res = await fetch(listUrl(params), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    priority: lowPriority ? 'low' : 'auto',
  });
  if (!res.ok) throw new Error(`tankerkoenig HTTP ${res.status}`);
  const json = (await res.json()) as DeResponse;
  if (json.ok !== true) throw new Error(`tankerkoenig rejected the query: ${json.message ?? ''}`);

  // The flux is the CURRENT price at fetch time (stations must report changes
  // within 5 min) — stamp it so freshness reads « just now ».
  const updatedAt = new Date().toISOString();
  const stations: Station[] = [];
  for (const r of Array.isArray(json.stations) ? json.stations : []) {
    if (r && typeof r === 'object') {
      const st = parseRecord(r as RawStation, updatedAt);
      if (st) stations.push(st);
    }
  }
  circleCache.set(key, { fetchedAt: Date.now(), stations });
  return stations;
}

// ── Provider ─────────────────────────────────────────────────────────────────
export class DeStationsProvider implements StationsProvider {
  readonly id = 'de' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true, // the flux carries the brand directly
  };

  async getStationsNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    if (!deCoversNear(center, radiusKm)) return [];
    const stations = await fetchCircle(center, radiusKm, opts?.lowPriority);
    return stations
      .filter((st) => haversineKm(center, { lat: st.lat, lng: st.lng }) <= radiusKm)
      .sort(
        (a, b) =>
          haversineKm(center, { lat: a.lat, lng: a.lng }) -
          haversineKm(center, { lat: b.lat, lng: b.lng }),
      )
      .slice(0, NEAR_CAP);
  }

  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    if (!deCoversAlong(polyline, corridorKm)) return [];
    // Sample spacing chosen so each 25 km-max circle overlaps its neighbours
    // enough to cover the whole corridor: spacing/2 + corridor + 1 ≤ RAD_MAX.
    const sampleKm = Math.max(10, 2 * (RAD_MAX_KM - corridorKm - 1));
    let samples = samplePolyline(polyline, sampleKm);
    if (samples.length > MAX_SAMPLES) {
      const step = samples.length / MAX_SAMPLES;
      const picked: GeoPoint[] = [];
      for (let i = 0; i < MAX_SAMPLES; i++) picked.push(samples[Math.floor(i * step)]);
      samples = picked;
    }
    const totalKm = polylineLengthKm(polyline);
    const spacingKm = samples.length > 1 ? totalKm / (samples.length - 1) : sampleKm;
    const queryKm = Math.min(RAD_MAX_KM, Math.ceil(spacingKm / 2 + corridorKm + 1));

    const byId = new Map<string, Station>();
    const lanes: GeoPoint[][] = Array.from({ length: CONCURRENCY }, () => []);
    samples.forEach((pt, i) => lanes[i % CONCURRENCY].push(pt));

    const runLane = async (pts: GeoPoint[]) => {
      for (const pt of pts) {
        if (!deCoversNear(pt, queryKm)) continue;
        const stations = await fetchCircle(pt, queryKm);
        for (const st of stations) if (!byId.has(st.id)) byId.set(st.id, st);
      }
    };

    await Promise.all(lanes.map(runLane));
    return [...byId.values()].filter(
      (st) => nearestOnPolyline({ lat: st.lat, lng: st.lng }, polyline).distKm <= corridorKm,
    );
  }
}
