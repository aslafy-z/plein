// Real French open data — national IRVE register (charge stations), through
// the Opendatasoft mirror of the Etalab consolidation (schema-irve-statique
// 2.2.0), same Explore API v2.1 as the fuel flux. The base is per CHARGE
// POINT (one row per pdc) and famously messy: watt/kW confusion, duplicate
// declarations, free-text pricing. Rows are grouped into stations and parsed
// defensively; transport failures throw so the store falls back to demo data.
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import { nearestOnPolyline, polylineLengthKm, samplePolyline } from '../../lib/geo';
import { parseOpeningHours } from './irveHours';
import { loadPriceGrid, resolveKwhPrice } from './prices';
import {
  powerTier,
  type ChargeProvider,
  type ChargeStation,
  type ConnectorId,
  type StationsFetchOptions,
} from '../types';

const ENDPOINT =
  (IS_DEV ? '/proxy/irve' : 'https://public.opendatasoft.com') +
  '/api/explore/v2.1/catalog/datasets/mobilityref-france-irve-220/records';

const PAGE = 100;
/** Charge-POINT rows, not stations — grouping divides by ~2-4 */
const NEAR_CAP = 500;
const ALONG_LIMIT = 100;
const SAMPLE_KM = 40;
const MAX_SAMPLES = 10;
const CONCURRENCY = 4;
const TIMEOUT_MS = 9000;

/** Above this a declared "puissance_nominale" is watts, not kW (22000 → 22) */
const WATTS_THRESHOLD = 1000;
const MAX_KW = 400;

const SELECT = [
  'id_station_itinerance',
  'nom_station',
  'nom_enseigne',
  'nom_operateur',
  'adresse_station',
  'consolidated_commune',
  'consolidated_code_postal',
  'point_geo',
  'nbre_pdc',
  'puissance_nominale',
  'prise_type_2',
  'prise_type_combo_ccs',
  'prise_type_chademo',
  'prise_type_ef',
  'gratuit',
  'tarification',
  'condition_acces',
  'horaires',
  'accessibilite_pmr',
  'date_maj',
].join(',');

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
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  return undefined;
}

/** Schema booleans arrive as "1"/"0", "true"/"false", true, or 1 */
function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'TRUE';
}

function parseCoords(rec: Raw): GeoPoint | null {
  const geo = rec.point_geo;
  if (geo && typeof geo === 'object') {
    const lat = toNum((geo as Raw).lat);
    const lng = toNum((geo as Raw).lon);
    if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function parseKw(rec: Raw): number {
  let kw = toNum(rec.puissance_nominale) ?? 0;
  if (kw >= WATTS_THRESHOLD) kw /= 1000;
  if (kw < 0 || kw > MAX_KW) return 0;
  return Math.round(kw * 10) / 10;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/([ \-']+)/)
    .map((part) => (/^[ \-']+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** date_maj is self-declared and sometimes in the future — clamp to today */
function parseDateMaj(v: unknown): string | undefined {
  const s = toStr(v);
  if (!s) return undefined;
  const t = new Date(s).getTime();
  if (!isFinite(t)) return undefined;
  return t > Date.now() ? new Date().toISOString() : s;
}

const CONNECTOR_COLS: ReadonlyArray<readonly [ConnectorId, string]> = [
  ['t2', 'prise_type_2'],
  ['ccs', 'prise_type_combo_ccs'],
  ['chademo', 'prise_type_chademo'],
  ['ef', 'prise_type_ef'],
];

// ── Grouping charge-point rows into stations ─────────────────────────────────
interface StationAcc {
  first: Raw;
  coords: GeoPoint;
  rows: number;
  declaredPdc: number;
  maxKw: number;
  connectors: Partial<Record<ConnectorId, number>>;
  free: boolean;
  tarification?: string;
}

function accKey(rec: Raw, coords: GeoPoint): string {
  const id = toStr(rec.id_station_itinerance);
  // Malformed/absent ids fall back to the location itself (~1 m precision)
  return id && id.length >= 5 ? id : `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
}

function accumulate(byStation: Map<string, StationAcc>, rec: Raw): void {
  const coords = parseCoords(rec);
  if (!coords) return;
  const key = accKey(rec, coords);
  let acc = byStation.get(key);
  if (!acc) {
    acc = {
      first: rec,
      coords,
      rows: 0,
      declaredPdc: 0,
      maxKw: 0,
      connectors: {},
      free: false,
    };
    byStation.set(key, acc);
  }
  acc.rows += 1;
  acc.declaredPdc = Math.max(acc.declaredPdc, toNum(rec.nbre_pdc) ?? 0);
  acc.maxKw = Math.max(acc.maxKw, parseKw(rec));
  for (const [conn, col] of CONNECTOR_COLS) {
    if (toBool(rec[col])) acc.connectors[conn] = (acc.connectors[conn] ?? 0) + 1;
  }
  if (toBool(rec.gratuit)) acc.free = true;
  acc.tarification = acc.tarification ?? toStr(rec.tarification);
}

function buildStation(key: string, acc: StationAcc): ChargeStation {
  const rec = acc.first;
  const enseigne = toStr(rec.nom_enseigne);
  const operator = toStr(rec.nom_operateur);
  const rawName = toStr(rec.nom_station) ?? enseigne ?? 'Borne de recharge';
  // Names are frequently ALL CAPS in the register
  const name = /[a-z]/.test(rawName) ? rawName : titleCase(rawName);
  const initSrc = enseigne ?? operator ?? rawName;
  const maxPowerKw = acc.maxKw;
  return {
    id: key,
    name,
    init: initSrc.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'BR',
    operator,
    lat: acc.coords.lat,
    lng: acc.coords.lng,
    address: toStr(rec.adresse_station) ?? '',
    city: toStr(rec.consolidated_commune) ?? '',
    cp: toStr(rec.consolidated_code_postal),
    maxPowerKw,
    tier: powerTier(maxPowerKw),
    pdcCount: Math.max(acc.declaredPdc, acc.rows),
    connectors: acc.connectors,
    pricingText: acc.tarification,
    free: acc.free,
    access: toStr(rec.condition_acces),
    hours: parseOpeningHours(rec.horaires),
    pmr: /oui|accessible/i.test(toStr(rec.accessibilite_pmr) ?? '') || undefined,
    updatedAt: parseDateMaj(rec.date_maj),
  };
}

/** Same operator re-declared by several producers a few meters apart: keep the
 * best-equipped declaration per ~30 m cell. */
function dedupe(stations: ChargeStation[]): ChargeStation[] {
  const byCell = new Map<string, ChargeStation>();
  for (const s of stations) {
    const cell = `${(s.operator ?? '').toLowerCase()}|${(s.lat * 3000).toFixed(0)},${(s.lng * 3000).toFixed(0)}`;
    const prev = byCell.get(cell);
    if (!prev || s.pdcCount > prev.pdcCount || (s.pdcCount === prev.pdcCount && s.maxPowerKw > prev.maxPowerKw)) {
      byCell.set(cell, s);
    }
  }
  return [...byCell.values()];
}

async function attachPrices(stations: ChargeStation[]): Promise<ChargeStation[]> {
  // Grid unavailable → stations still show, with unknown prices
  const grid = await loadPriceGrid().catch(() => []);
  for (const s of stations) {
    s.price = resolveKwhPrice(grid, {
      stationId: s.id,
      operator: s.operator,
      enseigne: s.name,
      tarification: s.pricingText,
      free: s.free,
      maxPowerKw: s.maxPowerKw,
      updatedAt: s.updatedAt,
    });
  }
  return stations;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function buildUrl(center: GeoPoint, radiusKm: number, limit: number, offset: number): string {
  // ODSQL POINT is lon lat order.
  const where = `within_distance(point_geo, geom'POINT(${center.lng} ${center.lat})', ${radiusKm}km)`;
  const params = new URLSearchParams({
    select: SELECT,
    where,
    // Dense areas overflow the cap: serve the most powerful points first,
    // which is also what an EV driver scans a map for.
    order_by: '-puissance_nominale',
    limit: String(limit),
    offset: String(offset),
  });
  return `${ENDPOINT}?${params.toString()}`;
}

async function fetchPage(url: string, lowPriority = false): Promise<unknown[]> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    priority: lowPriority ? 'low' : 'auto',
  });
  if (!res.ok) throw new Error(`irve HTTP ${res.status}`);
  const json = (await res.json()) as { results?: unknown[] };
  return Array.isArray(json.results) ? json.results : [];
}

export class IrveChargeProvider implements ChargeProvider {
  async getChargeNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<ChargeStation[]> {
    const gridPrefetch = loadPriceGrid().catch(() => []);
    const byStation = new Map<string, StationAcc>();
    for (let offset = 0; offset < NEAR_CAP; offset += PAGE) {
      const results = await fetchPage(buildUrl(center, radiusKm, PAGE, offset), opts?.lowPriority);
      for (const r of results) {
        if (r && typeof r === 'object') accumulate(byStation, r as Raw);
      }
      if (results.length < PAGE) break;
    }
    await gridPrefetch;
    const stations = dedupe(
      [...byStation.entries()].map(([key, acc]) => buildStation(key, acc)),
    );
    return attachPrices(stations);
  }

  async getChargeAlong(polyline: GeoPoint[], corridorKm: number): Promise<ChargeStation[]> {
    let samples = samplePolyline(polyline, SAMPLE_KM);
    if (samples.length > MAX_SAMPLES) {
      const step = samples.length / MAX_SAMPLES;
      const picked: GeoPoint[] = [];
      for (let i = 0; i < MAX_SAMPLES; i++) picked.push(samples[Math.floor(i * step)]);
      samples = picked;
    }

    // Overlapping circles cover the whole corridor (same math as the fuel flux)
    const totalKm = polylineLengthKm(polyline);
    const spacingKm = samples.length > 1 ? totalKm / (samples.length - 1) : SAMPLE_KM;
    const queryKm = Math.ceil(spacingKm / 2 + corridorKm + 1);

    const byStation = new Map<string, StationAcc>();
    const lanes: GeoPoint[][] = Array.from({ length: CONCURRENCY }, () => []);
    samples.forEach((pt, i) => lanes[i % CONCURRENCY].push(pt));

    const runLane = async (pts: GeoPoint[]) => {
      for (const pt of pts) {
        const results = await fetchPage(buildUrl(pt, queryKm, ALONG_LIMIT, 0));
        for (const r of results) {
          if (r && typeof r === 'object') accumulate(byStation, r as Raw);
        }
      }
    };
    await Promise.all(lanes.map(runLane));

    const stations = dedupe(
      [...byStation.entries()].map(([key, acc]) => buildStation(key, acc)),
    ).filter(
      (s) => nearestOnPolyline({ lat: s.lat, lng: s.lng }, polyline).distKm <= corridorKm,
    );
    return attachPrices(stations);
  }
}
