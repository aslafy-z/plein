// Real French government open data — instantaneous fuel-price flux.
// https://data.economie.gouv.fr (Opendatasoft Explore API v2.1)
// The flux is messy: fields arrive as numbers, strings, JSON strings, or absent,
// and raw coordinates are sometimes scaled by 1e5. We parse very defensively and
// throw on transport failure so the store can fall back to demo data.
import type { GeoPoint } from '../../lib/geo';
import { samplePolyline } from '../../lib/geo';
import type {
  FuelId,
  FuelPrice,
  ServiceTag,
  SourceCapabilities,
  Station,
  StationsProvider,
} from '../types';

const ENDPOINT =
  'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/' +
  'prix-des-carburants-en-france-flux-instantane-v2/records';

const PAGE = 100;
const NEAR_CAP = 300;
const ALONG_LIMIT = 40;
const MAX_SAMPLES = 10;
const CONCURRENCY = 4;
const TIMEOUT_MS = 9000;

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

function inPriceRange(v: number): boolean {
  return v >= MIN_PRICE && v <= MAX_PRICE;
}

// ── Coordinates ──────────────────────────────────────────────────────────────
function parseCoords(rec: Raw): GeoPoint | null {
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
const FUEL_COLS: ReadonlyArray<readonly [FuelId, string, string]> = [
  ['gazole', 'gazole_prix', 'gazole_maj'],
  ['e10', 'e10_prix', 'e10_maj'],
  ['sp98', 'sp98_prix', 'sp98_maj'],
  ['sp95', 'sp95_prix', 'sp95_maj'],
  ['e85', 'e85_prix', 'e85_maj'],
  ['gplc', 'gplc_prix', 'gplc_maj'],
];

/** Map a free-text fuel name to a FuelId (order matters: E10 before SP95). */
function fuelFromName(name: string): FuelId | null {
  const n = name.toLowerCase();
  if (n.includes('gazole') || n.includes('diesel')) return 'gazole';
  if (n.includes('e85')) return 'e85';
  if (n.includes('gpl')) return 'gplc';
  if (n.includes('e10') || n.includes('sp95-e10')) return 'e10';
  if (n.includes('98')) return 'sp98';
  if (n.includes('95')) return 'sp95';
  return null;
}

interface RawPrix {
  name: string;
  value: number;
  maj?: string;
}

/** `prix` may be a JSON string, a single object, or an already-parsed array. */
function parsePrixField(v: unknown): RawPrix[] {
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
  const out: RawPrix[] = [];
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

function parsePrices(rec: Raw): Partial<Record<FuelId, FuelPrice>> {
  const out: Partial<Record<FuelId, FuelPrice>> = {};
  for (const [fuel, col, majCol] of FUEL_COLS) {
    const v = toNum(rec[col]);
    if (v != null && inPriceRange(v)) out[fuel] = { value: v, updatedAt: toStr(rec[majCol]) };
  }
  if (Object.keys(out).length > 0) return out;
  // Fallback: parse the aggregated `prix` field.
  for (const p of parsePrixField(rec.prix)) {
    const fuel = fuelFromName(p.name);
    if (fuel && inPriceRange(p.value) && !out[fuel]) {
      out[fuel] = { value: p.value, updatedAt: p.maj };
    }
  }
  return out;
}

// ── Services + tags ──────────────────────────────────────────────────────────
/** `services` may be a JSON string ({"service":[...]}), an array, or `//`-joined. */
function parseServices(rec: Raw): string[] {
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

function deriveTags(services: string[], rec: Raw): ServiceTag[] {
  const joined = services.join(' ');
  const tags: ServiceTag[] = [];
  const auto = rec.horaires_automate_24_24;
  const is24 =
    auto === true ||
    (typeof auto === 'string' && /oui/i.test(auto)) ||
    /automate.*24|24.*24/i.test(joined);
  if (is24) tags.push('24/24');
  if (/avage/i.test(joined)) tags.push('Lavage');
  if (/outique/i.test(joined)) tags.push('Boutique');
  if (/onflage/i.test(joined)) tags.push('Gonflage');
  return tags;
}

// ── Misc ─────────────────────────────────────────────────────────────────────
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/([ \-']+)/)
    .map((part) => (/^[ \-']+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

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
    id,
    name: pretty ? `Station · ${pretty}` : 'Station',
    init: (ville.slice(0, 2) || 'ST').toUpperCase(),
    brand: undefined,
    cat: 'unknown',
    lat: coords.lat,
    lng: coords.lng,
    address: toStr(rec.adresse) ?? '',
    city: ville,
    cp: toStr(rec.cp),
    prices,
    tags: deriveTags(services, rec),
    services,
    highway: isHighway(rec),
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function buildUrl(center: GeoPoint, radiusKm: number, limit: number, offset: number): string {
  // ODSQL POINT is lon lat order.
  const where = `within_distance(geom, geom'POINT(${center.lng} ${center.lat})', ${radiusKm}km)`;
  const params = new URLSearchParams({
    where,
    limit: String(limit),
    offset: String(offset),
  });
  return `${ENDPOINT}?${params.toString()}`;
}

async function fetchPage(url: string): Promise<unknown[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`gouv flux HTTP ${res.status}`);
  const json = (await res.json()) as { total_count?: number; results?: unknown[] };
  return Array.isArray(json.results) ? json.results : [];
}

export class GouvStationsProvider implements StationsProvider {
  readonly id = 'gouv' as const;
  readonly capabilities: SourceCapabilities = {
    brands: false,
    label: 'prix-carburants.gouv.fr',
    sublabel: 'temps réel · mis à jour toutes les 10 min',
  };

  async getStationsNear(center: GeoPoint, radiusKm: number): Promise<Station[]> {
    const stations: Station[] = [];
    for (let offset = 0; offset < NEAR_CAP; offset += PAGE) {
      const results = await fetchPage(buildUrl(center, radiusKm, PAGE, offset));
      for (const r of results) {
        if (r && typeof r === 'object') {
          const st = parseRecord(r as Raw);
          if (st) stations.push(st);
        }
      }
      if (results.length < PAGE) break;
    }
    return stations.slice(0, NEAR_CAP);
  }

  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    let samples = samplePolyline(polyline, 40);
    if (samples.length > MAX_SAMPLES) {
      const step = samples.length / MAX_SAMPLES;
      const picked: GeoPoint[] = [];
      for (let i = 0; i < MAX_SAMPLES; i++) picked.push(samples[Math.floor(i * step)]);
      samples = picked;
    }

    const byId = new Map<string, Station>();
    // Split the sample points across a few concurrent lanes (concurrency ≤ 4).
    const lanes: GeoPoint[][] = Array.from({ length: CONCURRENCY }, () => []);
    samples.forEach((pt, i) => lanes[i % CONCURRENCY].push(pt));

    const runLane = async (pts: GeoPoint[]) => {
      for (const pt of pts) {
        const results = await fetchPage(buildUrl(pt, corridorKm, ALONG_LIMIT, 0));
        for (const r of results) {
          if (r && typeof r === 'object') {
            const st = parseRecord(r as Raw);
            if (st && !byId.has(st.id)) byId.set(st.id, st);
          }
        }
      }
    };

    await Promise.all(lanes.map(runLane));
    return [...byId.values()];
  }
}
