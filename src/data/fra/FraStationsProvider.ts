// Real French government open data — instantaneous fuel-price flux.
// https://data.economie.gouv.fr (Opendatasoft Explore API v2.1)
// The flux is messy: fields arrive as numbers, strings, JSON strings, or absent,
// and raw coordinates are sometimes scaled by 1e5. We parse very defensively and
// throw on transport failure so the store can fall back to demo data.
import { IS_DEV } from '../../lib/env';
import { enrichWithBrands, fuelPoisAlong, fuelPoisNear } from './osmBrands';
import type { GeoPoint } from '../../lib/geo';
import { nearestOnPolyline, polylineLengthKm, samplePolyline } from '../../lib/geo';
import type { DayHours, StationHours } from '../../lib/hours';
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
const ENDPOINT =
  (IS_DEV ? '/proxy/fra' : 'https://data.economie.gouv.fr') +
  '/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

const PAGE = 100;
const NEAR_CAP = 300;
const ALONG_LIMIT = 100;
const SAMPLE_KM = 40;
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

// ── Opening hours ────────────────────────────────────────────────────────────
/** "08.00" / "8:30" → minutes from midnight */
function parseClock(v: unknown): number | null {
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
 */
function parseHoraires(rec: Raw): StationHours | undefined {
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
    hours: parseHoraires(rec),
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

async function fetchPage(url: string, lowPriority = false): Promise<unknown[]> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Background refreshes yield to user-visible requests (tiles, geocoding)
    priority: lowPriority ? 'low' : 'auto',
  });
  if (!res.ok) throw new Error(`gouv flux HTTP ${res.status}`);
  const json = (await res.json()) as { total_count?: number; results?: unknown[] };
  return Array.isArray(json.results) ? json.results : [];
}

export class FraStationsProvider implements StationsProvider {
  readonly id = 'fra' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true, // enriched from OpenStreetMap by proximity
    label: 'prix-carburants.gouv.fr',
    sublabel: 'temps réel · enseignes via OpenStreetMap',
  };

  async getStationsNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    // The static OSM brand index loads concurrently with the price pages
    const poisPromise = fuelPoisNear(center, radiusKm).catch(() => []);
    const stations: Station[] = [];
    for (let offset = 0; offset < NEAR_CAP; offset += PAGE) {
      const results = await fetchPage(buildUrl(center, radiusKm, PAGE, offset), opts?.lowPriority);
      for (const r of results) {
        if (r && typeof r === 'object') {
          const st = parseRecord(r as Raw);
          if (st) stations.push(st);
        }
      }
      if (results.length < PAGE) break;
    }
    return enrichWithBrands(stations.slice(0, NEAR_CAP), await poisPromise);
  }

  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    let samples = samplePolyline(polyline, SAMPLE_KM);
    if (samples.length > MAX_SAMPLES) {
      const step = samples.length / MAX_SAMPLES;
      const picked: GeoPoint[] = [];
      for (let i = 0; i < MAX_SAMPLES; i++) picked.push(samples[Math.floor(i * step)]);
      samples = picked;
    }

    // Sample circles must overlap enough to cover the whole corridor: query
    // half the effective spacing plus the corridor width, then keep only the
    // stations truly within corridorKm of the route.
    const totalKm = polylineLengthKm(polyline);
    const spacingKm = samples.length > 1 ? totalKm / (samples.length - 1) : SAMPLE_KM;
    const queryKm = Math.ceil(spacingKm / 2 + corridorKm + 1);

    const byId = new Map<string, Station>();
    // Split the sample points across a few concurrent lanes (concurrency ≤ 4).
    const lanes: GeoPoint[][] = Array.from({ length: CONCURRENCY }, () => []);
    samples.forEach((pt, i) => lanes[i % CONCURRENCY].push(pt));

    const runLane = async (pts: GeoPoint[]) => {
      for (const pt of pts) {
        const results = await fetchPage(buildUrl(pt, queryKm, ALONG_LIMIT, 0));
        for (const r of results) {
          if (r && typeof r === 'object') {
            const st = parseRecord(r as Raw);
            if (st && !byId.has(st.id)) byId.set(st.id, st);
          }
        }
      }
    };

    const poisPromise = fuelPoisAlong(polyline, corridorKm).catch(() => []);
    await Promise.all(lanes.map(runLane));
    const inCorridor = [...byId.values()].filter(
      (st) => nearestOnPolyline({ lat: st.lat, lng: st.lng }, polyline).distKm <= corridorKm,
    );
    return enrichWithBrands(inCorridor, await poisPromise);
  }
}
