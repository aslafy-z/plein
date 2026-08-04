// Real Spanish government open data — official fuel prices from MITECO
// (geoportalgasolineras.es), REST API on sedeaplicaciones.minetur.gob.es.
// The API has no geographic filter, only per-province endpoints (the whole
// country weighs ~12 MB uncompressed), so queries resolve the provinces whose
// covering circle intersects the searched zone, fetch each one (memoized for
// the API's ~30 min refresh cycle) and filter client-side.
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, nearestOnPolyline } from '../../lib/geo';
import type { DayHours, StationHours } from '../../lib/hours';
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
  (IS_DEV ? '/proxy/esp' : 'https://sedeaplicaciones.minetur.gob.es') +
  '/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroProvincia/';

const TIMEOUT_MS = 15000;
/** The ministry refreshes the flux every ~30 min */
const CACHE_MS = 30 * 60_000;
const NEAR_CAP = 300;

const MIN_PRICE = 0.5;
const MAX_PRICE = 3.5;

// ── Provinces ────────────────────────────────────────────────────────────────
// [id, centroid lat, centroid lng, covering radius km] — computed from the
// station coordinates of the full flux (radius = max distance to the centroid,
// outliers dropped, +5 km margin). A zone intersects a province's circle ⇒ the
// province may hold stations in the zone; over-inclusion only costs a fetch.
const PROVINCES: ReadonlyArray<readonly [string, number, number, number]> = [
  ['01', 42.852, -2.695, 52], // Araba/Álava
  ['02', 38.947, -1.869, 101], // Albacete
  ['03', 38.382, -0.528, 82], // Alicante
  ['04', 36.994, -2.407, 103], // Almería
  ['05', 40.63, -4.791, 76], // Ávila
  ['06', 38.743, -6.341, 134], // Badajoz
  ['07', 39.561, 2.838, 159], // Illes Balears
  ['08', 41.479, 2.088, 93], // Barcelona
  ['09', 42.307, -3.604, 106], // Burgos
  ['10', 39.745, -6.09, 118], // Cáceres
  ['11', 36.497, -5.954, 89], // Cádiz
  ['12', 40.05, -0.058, 76], // Castellón
  ['13', 38.978, -3.555, 131], // Ciudad Real
  ['14', 37.772, -4.727, 102], // Córdoba
  ['15', 43.159, -8.47, 85], // A Coruña
  ['16', 39.733, -2.333, 97], // Cuenca
  ['17', 42.069, 2.841, 91], // Girona
  ['18', 37.189, -3.508, 142], // Granada
  ['19', 40.701, -3.003, 118], // Guadalajara
  ['20', 43.225, -2.092, 48], // Gipuzkoa
  ['21', 37.399, -6.879, 88], // Huelva
  ['22', 42.033, -0.042, 103], // Huesca
  ['23', 37.97, -3.603, 106], // Jaén
  ['24', 42.555, -5.883, 94], // León
  ['25', 41.805, 0.9, 121], // Lleida
  ['26', 42.379, -2.366, 66], // La Rioja
  ['27', 43.091, -7.491, 77], // Lugo
  ['28', 40.371, -3.694, 91], // Madrid
  ['29', 36.706, -4.617, 80], // Málaga
  ['30', 37.893, -1.233, 88], // Murcia
  ['31', 42.627, -1.715, 87], // Navarra
  ['32', 42.241, -7.733, 71], // Ourense
  ['33', 43.429, -5.877, 112], // Asturias
  ['34', 42.227, -4.48, 82], // Palencia
  ['35', 28.223, -14.978, 184], // Las Palmas
  ['36', 42.136, -8.393, 83], // Pontevedra
  ['37', 40.86, -5.858, 92], // Salamanca
  ['38', 28.34, -16.651, 154], // Santa Cruz de Tenerife
  ['39', 43.365, -3.87, 69], // Cantabria
  ['40', 41.087, -4.122, 77], // Segovia
  ['41', 37.362, -5.795, 105], // Sevilla
  ['42', 41.63, -2.526, 61], // Soria
  ['43', 41.055, 1.015, 83], // Tarragona
  ['44', 40.677, -0.765, 95], // Teruel
  ['45', 39.896, -4.035, 116], // Toledo
  ['46', 39.36, -0.47, 114], // Valencia
  ['47', 41.587, -4.787, 81], // Valladolid
  ['48', 43.266, -2.877, 44], // Bizkaia
  ['49', 41.718, -5.779, 100], // Zamora
  ['50', 41.637, -1.036, 128], // Zaragoza
  ['51', 35.891, -5.322, 7], // Ceuta
  ['52', 35.285, -2.943, 7], // Melilla
];

// ── Parsing ──────────────────────────────────────────────────────────────────
type Raw = Record<string, unknown>;

/** "1,479" → 1.479 (the flux uses Spanish decimal commas everywhere) */
function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// Left column: our fuel id. The right one is the flux's own header.
const FUEL_COLS: ReadonlyArray<readonly [FuelId, string]> = [
  ['diesel', 'Precio Gasoleo A'],
  ['e10', 'Precio Gasolina 95 E10'],
  ['unleaded98', 'Precio Gasolina 98 E5'],
  ['unleaded95', 'Precio Gasolina 95 E5'],
  ['e85', 'Precio Gasolina 95 E85'],
  ['lpg', 'Precio Gases licuados del petróleo'],
];

// The flux has no car-wash/shop-style service field, but it does list every
// extra product on sale — shown as the « Services » of the detail screen.
// Left column: the flux's Spanish header. Right: our product id — the catalog
// names it, so the parse layer translates nothing.
const EXTRA_PRODUCTS: ReadonlyArray<readonly [string, ExtraProductId]> = [
  ['Precio Gasoleo Premium', 'dieselPremium'],
  ['Precio Gasoleo B', 'agriculturalDiesel'],
  ['Precio Adblue', 'adBlue'],
  ['Precio Gas Natural Comprimido', 'cng'],
  ['Precio Gas Natural Licuado', 'lng'],
  ['Precio Biogas Natural Comprimido', 'bioCng'],
  ['Precio Biogas Natural Licuado', 'bioLng'],
  ['Precio Hidrogeno', 'hydrogen'],
  ['Precio Diésel Renovable', 'renewableDiesel'],
  ['Precio Gasolina Renovable', 'renewablePetrol'],
  ['Precio Biodiesel', 'biodiesel'],
  ['Precio Bioetanol', 'bioethanol'],
];

/**
 * "19/07/2026 5:40:23" (header `Fecha`) → "2026-07-19T03:40:23.000Z".
 *
 * The ministry stamps the flux with a peninsular wall clock and no offset —
 * whichever province was queried, Canaries included. Resolve it in
 * Europe/Madrid so the freshness labels hold on a device in any zone.
 */
export function fluxDateToIso(stamp: string | undefined): string | undefined {
  const m = stamp?.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  const ms = zonedTimeToMs(
    'Europe/Madrid',
    Number(m[3]),
    Number(m[2]),
    Number(m[1]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

// ── Opening hours ────────────────────────────────────────────────────────────
/** Day letters of `Horario`, in flux order (L=Monday … D=Sunday) */
const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * `Horario` is compact Spanish notation: "L-D: 24H",
 * "L-V: 06:00-22:00; S-D: 07:00-22:00", "L: 24H"…
 * Unparseable segments are skipped — unknown stays unknown.
 * @internal exported for unit tests
 */
export function parseOpeningHours(v: unknown): StationHours | undefined {
  const s = toStr(v);
  if (!s) return undefined;
  if (/^L-D:\s*24\s*H/i.test(s)) return { auto24: true, days: {} };

  const days: Partial<Record<number, DayHours>> = {};
  for (const seg of s.split(';')) {
    const m = seg.trim().match(/^([LMXJVSD])(?:-([LMXJVSD]))?:\s*(.+)$/i);
    if (!m) continue;
    const from = DAY_LETTERS.indexOf(m[1].toUpperCase()) + 1;
    const to = m[2] ? DAY_LETTERS.indexOf(m[2].toUpperCase()) + 1 : from;
    if (from < 1 || to < from) continue;

    const ranges: DayHours['ranges'] = [];
    if (/24\s*H/i.test(m[3])) {
      ranges.push({ open: 0, close: 24 * 60 });
    } else {
      for (const r of m[3].matchAll(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/g)) {
        const open = parseInt(r[1], 10) * 60 + parseInt(r[2], 10);
        const close = parseInt(r[3], 10) * 60 + parseInt(r[4], 10);
        if (open !== close) ranges.push({ open, close });
      }
    }
    if (!ranges.length) continue;
    for (let d = from; d <= to; d++) days[d] = { closed: false, ranges };
  }
  return Object.keys(days).length ? { auto24: false, days } : undefined;
}

// ── Record → Station ─────────────────────────────────────────────────────────
/** @internal exported for unit tests */
export function parseRecord(rec: Raw, updatedAt: string | undefined): Station | null {
  const lat = toNum(rec['Latitud']);
  const lng = toNum(rec['Longitud (WGS84)']);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const prices: Partial<Record<FuelId, FuelPrice>> = {};
  for (const [fuel, col] of FUEL_COLS) {
    const v = toNum(rec[col]);
    if (v != null && v >= MIN_PRICE && v <= MAX_PRICE) prices[fuel] = { value: v, updatedAt };
  }

  // "ESTACIÓN DE SERVICIO..." rótulos stay readable once title-cased
  const rotulo = toStr(rec['Rótulo']);
  const brand = rotulo ? titleCase(rotulo) : undefined;
  const city = toStr(rec['Municipio']) ?? toStr(rec['Localidad']) ?? '';
  const address = toStr(rec['Dirección']) ?? '';
  const hours = parseOpeningHours(rec['Horario']);
  const tags: ServiceTag[] = hours?.auto24 ? ['open24h'] : [];
  // A price on an extra product means the station sells it — and the flux
  // prices every one of them, so keep the figure instead of dropping it
  const services: ExtraProductId[] = [];
  const extraPrices: Partial<Record<ExtraProductId, FuelPrice>> = {};
  for (const [col, product] of EXTRA_PRODUCTS) {
    const v = toNum(rec[col]);
    if (v == null) continue;
    services.push(product);
    extraPrices[product] = { value: v, updatedAt };
  }
  // AdBlue / Gasóleo Premium are what the « additives » filter looks for
  if (services.some((s) => s === 'adBlue' || s === 'dieselPremium')) tags.push('additives');
  // …and AdBlue is filterable on its own: this source declares the products on
  // sale, so its silence really does mean the pump isn't there
  if (services.includes('adBlue')) tags.push('adBlue');
  const id = toStr(rec['IDEESS']);

  return {
    id: id ? `esp-${id}` : `esp-${lat.toFixed(5)},${lng.toFixed(5)}`,
    name: brand ? (city ? `${brand} · ${city}` : brand) : city ? `Station · ${city}` : 'Station',
    init: brand ? initialsOf(brand) : (city.slice(0, 2) || 'ST').toUpperCase(),
    brand,
    lat,
    lng,
    address: titleCase(address),
    city,
    postalCode: toStr(rec['C.P.']),
    prices,
    tags,
    services,
    extraPrices,
    // Autovías/autopistas are the Spanish motorway network
    highway: /autov[ií]a|autopista|\bAP-?\d/i.test(address),
    hours,
  };
}

// ── Per-province fetch (memoized) ────────────────────────────────────────────
interface EspResponse {
  Fecha?: string;
  ListaEESSPrecio?: unknown[];
  ResultadoConsulta?: string;
}

function provincesNear(center: GeoPoint, radiusKm: number): string[] {
  return PROVINCES.filter(
    ([, lat, lng, r]) => haversineKm(center, { lat, lng }) <= r + radiusKm,
  ).map(([id]) => id);
}

function provincesAlong(polyline: GeoPoint[], corridorKm: number): string[] {
  return PROVINCES.filter(
    ([, lat, lng, r]) => nearestOnPolyline({ lat, lng }, polyline).distKm <= r + corridorKm,
  ).map(([id]) => id);
}

/** Can the zone hold Spanish stations at all? (drives the « auto » source) */
export function espCoversNear(center: GeoPoint, radiusKm: number): boolean {
  return provincesNear(center, radiusKm).length > 0;
}

export function espCoversAlong(polyline: GeoPoint[], corridorKm: number): boolean {
  return provincesAlong(polyline, corridorKm).length > 0;
}

// The memo holds the *promise*, not the resolved list: a province weighs
// hundreds of KB to a few MB, and callers overlap easily (map + route computed
// together, a pan landing while the previous query runs, the « auto » source
// resolving several provinces near the border). Caching the value only would
// let every caller that arrives before the response lands start its own
// download.
const provinceCache = new Map<string, { fetchedAt: number; stations: Promise<Station[]> }>();

function fetchProvince(id: string, lowPriority = false): Promise<Station[]> {
  const hit = provinceCache.get(id);
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit.stations;

  const stations = loadProvince(id, lowPriority);
  provinceCache.set(id, { fetchedAt: Date.now(), stations });
  // A failed fetch must retry on the next query, not stick for CACHE_MS.
  stations.catch(() => {
    if (provinceCache.get(id)?.stations === stations) provinceCache.delete(id);
  });
  return stations;
}

async function loadProvince(id: string, lowPriority: boolean): Promise<Station[]> {
  const res = await fetch(ENDPOINT + id, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    priority: lowPriority ? 'low' : 'auto',
  });
  if (!res.ok) throw new Error(`esp flux HTTP ${res.status}`);
  const json = (await res.json()) as EspResponse;
  const rows = Array.isArray(json.ListaEESSPrecio) ? json.ListaEESSPrecio : [];
  if (json.ResultadoConsulta !== 'OK') throw new Error('esp flux rejected the query');

  const updatedAt = fluxDateToIso(json.Fecha);
  const stations: Station[] = [];
  for (const r of rows) {
    if (r && typeof r === 'object') {
      const st = parseRecord(r as Raw, updatedAt);
      if (st) stations.push(st);
    }
  }
  return stations;
}

// ── Provider ─────────────────────────────────────────────────────────────────
export class EspStationsProvider implements StationsProvider {
  readonly id = 'esp' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true, // the flux carries the rótulo (banner) directly
  };

  async getStationsNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    const ids = provincesNear(center, radiusKm);
    const batches = await Promise.all(ids.map((id) => fetchProvince(id, opts?.lowPriority)));
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
    const ids = provincesAlong(polyline, corridorKm);
    const batches = await Promise.all(ids.map((id) => fetchProvince(id)));
    return batches
      .flat()
      .filter(
        (st) => nearestOnPolyline({ lat: st.lat, lng: st.lng }, polyline).distKm <= corridorKm,
      );
  }
}
