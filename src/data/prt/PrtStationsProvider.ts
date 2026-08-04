// Real Portuguese government open data — official fuel prices from the DGEG
// (Direção-Geral de Energia e Geologia), the REST API behind
// precoscombustiveis.dgeg.gov.pt. The API has no geographic filter, only a
// per-district one (18 districts on the mainland; the whole country weighs
// ~5 MB), so queries resolve the districts whose covering circle intersects
// the searched zone, fetch each one (memoized for the flux's refresh cycle)
// and filter client-side. Rows arrive as station × product — one declared
// price each — and are grouped by station id (`Id`) here.
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, nearestOnPolyline } from '../../lib/geo';
import { initialsOf, titleCase } from '../../lib/text';
import { zonedTimeToMs } from '../../lib/time';
import type {
  ExtraProductId,
  FuelId,
  FuelPrice,
  ServiceTag,
  SourceCapabilities,
  Station,
  StationsFetchOptions,
  StationsProvider,
} from '../types';

const ENDPOINT =
  (IS_DEV ? '/proxy/prt' : 'https://precoscombustiveis.dgeg.gov.pt') +
  '/api/PrecoComb/PesquisarPostos';

const TIMEOUT_MS = 15000;
/** Stations declare their prices over the day; refetch at most twice an hour */
const CACHE_MS = 30 * 60_000;
const NEAR_CAP = 300;
/**
 * Rows per request. The API paginates, and the busiest district (Porto) holds
 * ~2 000 station × product rows — an order of magnitude below this, so one
 * page always carries a whole district.
 */
const PAGE_SIZE = 10000;

const MIN_PRICE = 0.5;
const MAX_PRICE = 3.5;

// ── Districts ────────────────────────────────────────────────────────────────
// [idDistrito, centroid lat, centroid lng, covering radius km] — computed from
// the station coordinates of the full flux (radius = max distance to the
// centroid, outliers dropped, +5 km margin). A zone intersects a district's
// circle ⇒ the district may hold stations in the zone; over-inclusion only
// costs a fetch. The flux covers the mainland only — the Azores and Madeira
// run their own price regimes and are absent from it.
const DISTRICTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 40.753, -8.523, 53], // Aveiro
  [2, 37.898, -7.989, 98], // Beja
  [3, 41.5, -8.424, 44], // Braga
  [4, 41.49, -6.895, 57], // Bragança
  [5, 39.996, -7.591, 64], // Castelo Branco
  [6, 40.228, -8.46, 62], // Coimbra
  [7, 38.645, -7.892, 65], // Évora
  [8, 37.139, -8.2, 75], // Faro
  [9, 40.632, -7.289, 61], // Guarda
  [10, 39.692, -8.828, 69], // Leiria
  [11, 38.863, -9.213, 52], // Lisboa
  [12, 39.151, -7.59, 61], // Portalegre
  [13, 41.219, -8.502, 44], // Porto
  [14, 39.341, -8.605, 69], // Santarém
  [15, 38.519, -8.921, 85], // Setúbal
  [16, 41.815, -8.648, 51], // Viana do Castelo
  [17, 41.459, -7.644, 54], // Vila Real
  [18, 40.732, -7.918, 68], // Viseu
];

// ── Products ─────────────────────────────────────────────────────────────────
// `Combustivel` names the product in the flux's own words. Left: our fuel id.
// Middle: the plain grade. Right: the « especial » (additivated) grade, which
// stands in when a station sells only that one — same octane at the pump, and
// it is then the only price it declares.
const FUEL_PRODUCTS: ReadonlyArray<readonly [FuelId, string, string?]> = [
  ['diesel', 'Gasóleo simples', 'Gasóleo especial'],
  ['unleaded95', 'Gasolina simples 95', 'Gasolina especial 95'],
  ['unleaded98', 'Gasolina 98', 'Gasolina especial 98'],
  ['lpg', 'GPL Auto'],
];

// Everything else on sale becomes a « Service » on the detail screen (like the
// Spanish and Andorran sources' extra products). Portugal sells no E10, no E85
// and no AdBlue through this flux.
const EXTRA_PRODUCTS: ReadonlyArray<readonly [string, ExtraProductId]> = [
  ['Gasóleo especial', 'dieselPremium'],
  ['Gasolina especial 95', 'petrolPremium'],
  ['Gasolina especial 98', 'petrolPremium'],
  ['Gasóleo colorido', 'agriculturalDiesel'],
  ['Gasóleo de aquecimento', 'heatingOilOnSite'],
  ['Biodiesel B15', 'biodiesel'],
  ['GNC (gás natural comprimido) - €/kg', 'cng'],
  ['GNC (gás natural comprimido) - €/m3', 'cng'],
  ['GNL (gás natural liquefeito) - €/kg', 'lng'],
];

// ── Parsing ──────────────────────────────────────────────────────────────────
interface PrtRow {
  Id?: unknown;
  Nome?: unknown;
  Marca?: unknown;
  TipoPosto?: unknown;
  Combustivel?: unknown;
  Preco?: unknown;
  DataAtualizacao?: unknown;
  Municipio?: unknown;
  Localidade?: unknown;
  Morada?: unknown;
  CodPostal?: unknown;
  Latitude?: unknown;
  Longitude?: unknown;
}

interface PrtResponse {
  status?: unknown;
  resultado?: unknown[];
}

function toNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function toStr(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s || undefined;
}

/** "1,729 €" → 1.729 (the flux writes prices as Portuguese decimal strings) */
export function toPrice(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const n = parseFloat(v.replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * "2026-07-22 08:40" (`DataAtualizacao`) → "2026-07-22T07:40:00.000Z".
 *
 * The flux stamps declarations with a bare Lisbon wall clock and no offset,
 * so resolve it in Europe/Lisbon — the freshness labels then hold on a device
 * in any zone.
 */
export function fluxDateToIso(stamp: unknown): string | undefined {
  const m = typeof stamp === 'string' ? stamp.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/) : null;
  if (!m) return undefined;
  const ms = zonedTimeToMs(
    'Europe/Lisbon',
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
  );
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** "SITIO DA REPRESA" → "Sitio Da Represa"; a mixed-case label is left alone */
function tidy(s: string): string {
  return s === s.toUpperCase() && /[A-ZÀ-Ü]{3}/.test(s) ? titleCase(s) : s;
}

/**
 * Banner of a station. « Genérico » is how the flux says « no banner », and
 * short all-caps tokens are acronyms nobody title-cases (BP, DPP, OZ, Q8).
 */
export function tidyBrand(marca: string | undefined): string | undefined {
  if (!marca || /^gen[ée]rico$/i.test(marca)) return undefined;
  return marca
    .split(' ')
    .map((w) => (w === w.toUpperCase() && w.length <= 3 ? w : tidy(w)))
    .join(' ');
}

// ── Rows → Stations ──────────────────────────────────────────────────────────
/** @internal exported for unit tests */
export function groupStations(rows: unknown[]): Station[] {
  // Every row of a station repeats its identity columns, so the first one to
  // arrive describes it; only the products accumulate.
  interface Acc {
    name: string;
    row: PrtRow;
    point: GeoPoint;
    /** product name → declared price, kept raw until every row is in */
    products: Map<string, FuelPrice>;
  }
  const byId = new Map<number, Acc>();

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const row = r as PrtRow;
    const id = toNum(row.Id);
    const lat = toNum(row.Latitude);
    const lng = toNum(row.Longitude);
    const name = toStr(row.Nome);
    if (id == null || name == null) continue;
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

    let acc = byId.get(id);
    if (!acc) {
      acc = { name: tidy(name), row, point: { lat, lng }, products: new Map() };
      byId.set(id, acc);
    }
    const product = toStr(row.Combustivel);
    const price = toPrice(row.Preco);
    if (product && price != null && price >= MIN_PRICE && price <= MAX_PRICE) {
      acc.products.set(product, { value: price, updatedAt: fluxDateToIso(row.DataAtualizacao) });
    }
  }

  const stations: Station[] = [];
  for (const [id, acc] of byId) {
    const prices: Partial<Record<FuelId, FuelPrice>> = {};
    for (const [fuel, plain, additivated] of FUEL_PRODUCTS) {
      const p = acc.products.get(plain) ?? (additivated ? acc.products.get(additivated) : undefined);
      if (p) prices[fuel] = p;
    }
    // Heating-oil and agricultural-diesel-only sellers ride the same flux —
    // no road fuel, no station
    if (!Object.keys(prices).length) continue;

    const services: ExtraProductId[] = [];
    for (const [product, extra] of EXTRA_PRODUCTS) {
      if (acc.products.has(product) && !services.includes(extra)) services.push(extra);
    }
    // The additivated grades are what the « additives » filter looks for here
    // (the flux carries no AdBlue, and no opening hours either)
    const tags: ServiceTag[] = services.some((s) => s === 'dieselPremium' || s === 'petrolPremium')
      ? ['additives']
      : [];

    stations.push({
      id: `prt-${id}`,
      name: acc.name,
      init: initialsOf(acc.name),
      brand: tidyBrand(toStr(acc.row.Marca)),
      lat: acc.point.lat,
      lng: acc.point.lng,
      address: tidy(toStr(acc.row.Morada) ?? ''),
      city: toStr(acc.row.Municipio) ?? toStr(acc.row.Localidade) ?? '',
      postalCode: toStr(acc.row.CodPostal),
      prices,
      tags,
      services,
      highway: toStr(acc.row.TipoPosto) === 'Auto-estrada',
      hours: undefined, // the flux carries no opening hours
    });
  }
  return stations;
}

// ── Coverage ─────────────────────────────────────────────────────────────────
function districtsNear(center: GeoPoint, radiusKm: number): number[] {
  return DISTRICTS.filter(([, lat, lng, r]) => haversineKm(center, { lat, lng }) <= r + radiusKm).map(
    ([id]) => id,
  );
}

function districtsAlong(polyline: GeoPoint[], corridorKm: number): number[] {
  return DISTRICTS.filter(
    ([, lat, lng, r]) => nearestOnPolyline({ lat, lng }, polyline).distKm <= r + corridorKm,
  ).map(([id]) => id);
}

/** Can the zone hold Portuguese stations at all? (drives the « auto » source) */
export function prtCoversNear(center: GeoPoint, radiusKm: number): boolean {
  return districtsNear(center, radiusKm).length > 0;
}

export function prtCoversAlong(polyline: GeoPoint[], corridorKm: number): boolean {
  return districtsAlong(polyline, corridorKm).length > 0;
}

// ── Per-district fetch (memoized) ────────────────────────────────────────────
// The memo holds the *promise*, not the resolved list: a district weighs a few
// hundred KB and callers overlap easily (map + route computed together, a pan
// landing while the previous query runs, the « auto » source resolving several
// districts near the border). Caching the value only would let every caller
// that arrives before the response lands start its own download.
const districtCache = new Map<number, { fetchedAt: number; stations: Promise<Station[]> }>();

function fetchDistrict(id: number, lowPriority = false): Promise<Station[]> {
  const hit = districtCache.get(id);
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit.stations;

  const stations = loadDistrict(id, lowPriority);
  districtCache.set(id, { fetchedAt: Date.now(), stations });
  // A failed fetch must retry on the next query, not stick for CACHE_MS.
  stations.catch(() => {
    if (districtCache.get(id)?.stations === stations) districtCache.delete(id);
  });
  return stations;
}

async function loadDistrict(id: number, lowPriority: boolean): Promise<Station[]> {
  const params = new URLSearchParams({
    idDistrito: String(id),
    qtdPorPagina: String(PAGE_SIZE),
    pagina: '1',
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    priority: lowPriority ? 'low' : 'auto',
  });
  if (!res.ok) throw new Error(`prt flux HTTP ${res.status}`);
  const json = (await res.json()) as PrtResponse;
  // The API reports failures inside a 200 response
  if (json.status !== true || !Array.isArray(json.resultado)) {
    throw new Error('prt flux rejected the query');
  }
  return groupStations(json.resultado);
}

// ── Provider ─────────────────────────────────────────────────────────────────
export class PrtStationsProvider implements StationsProvider {
  readonly id = 'prt' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true, // the flux carries the marca (banner) directly
  };

  async getStationsNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    const ids = districtsNear(center, radiusKm);
    const batches = await Promise.all(ids.map((id) => fetchDistrict(id, opts?.lowPriority)));
    return batches
      .flat()
      .filter((st) => haversineKm(center, { lat: st.lat, lng: st.lng }) <= radiusKm)
      .sort(
        (a, b) =>
          haversineKm(center, { lat: a.lat, lng: a.lng }) -
          haversineKm(center, { lat: b.lat, lng: b.lng }),
      )
      .slice(0, NEAR_CAP);
  }

  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    const ids = districtsAlong(polyline, corridorKm);
    const batches = await Promise.all(ids.map((id) => fetchDistrict(id)));
    return batches
      .flat()
      .filter(
        (st) => nearestOnPolyline({ lat: st.lat, lng: st.lng }, polyline).distKm <= corridorKm,
      );
  }
}
