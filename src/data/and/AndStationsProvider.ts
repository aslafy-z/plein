// Real Andorran government open data — official fuel prices from the Govern
// d'Andorra (Oficina de l'energia i del canvi climàtic, sig.govern.ad/IPE),
// served by the SIG's public ArcGIS layer « Preu dels carburants actuals ».
// The whole country is ~60 stations, so one request fetches everything
// (memoized) and queries filter client-side. Rows arrive as station × product;
// they are grouped by station id (idIPE) here.
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, nearestOnPolyline } from '../../lib/geo';
import { initialsOf } from '../../lib/text';
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
  (IS_DEV ? '/proxy/and' : 'https://sig.govern.ad') +
  '/server/rest/services/CARBURANTS/CARBURANTS/FeatureServer/1/query';

const TIMEOUT_MS = 15000;
/** Stations update their prices over the day; refetch at most twice an hour */
const CACHE_MS = 30 * 60_000;

const MIN_PRICE = 0.5;
const MAX_PRICE = 3.5;

// ── Coverage ─────────────────────────────────────────────────────────────────
// The whole principality fits in one circle (its stations span ~25 km).
const AND_CENTER: GeoPoint = { lat: 42.52, lng: 1.61 };
const AND_RADIUS_KM = 22;

/** Can the zone hold Andorran stations at all? (drives the « auto » source) */
export function andCoversNear(center: GeoPoint, radiusKm: number): boolean {
  return haversineKm(center, AND_CENTER) <= AND_RADIUS_KM + radiusKm;
}

export function andCoversAlong(polyline: GeoPoint[], corridorKm: number): boolean {
  return nearestOnPolyline(AND_CENTER, polyline).distKm <= AND_RADIUS_KM + corridorKm;
}

// ── Products ─────────────────────────────────────────────────────────────────
// idProducte of the IPE flux → app fuel. Andorra sells neither E10 nor E85.
const FUEL_PRODUCTS: ReadonlyArray<readonly [number, FuelId]> = [
  [4, 'unleaded95'], // Gasolina sense plom 95 octans
  [5, 'unleaded98'], // Gasolina sense plom 98 octans
  [6, 'diesel'], // Gasoil de locomoció
  [11, 'lpg'], // GLP
];

// Other products become « Services » on the detail screen (like the Spanish
// source's extra products). Heating oil alone doesn't make a fuel station:
// stations with no road fuel at all are dropped.
const EXTRA_PRODUCTS: ReadonlyArray<readonly [number, ExtraProductId]> = [
  [8, 'dieselPremium'], // Gasoil millorat
  [9, 'adBlue'],
  [7, 'heatingOilDelivered'],
  [10, 'heatingOilOnSite'],
];

// ── Brands ───────────────────────────────────────────────────────────────────
// The banner lives in the station name (NOM); Marca_importador is the
// importer, which differs on franchised stations (Dyneff imports via Elf…).
const BANNERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/dyneff/i, 'Dyneff'],
  [/meroil/i, 'Meroil'],
  [/total/i, 'TotalEnergies'],
  [/\belf\b/i, 'Elf'],
  [/cepsa/i, 'Cepsa'],
  [/repsol/i, 'Repsol'],
  [/shell/i, 'Shell'],
  [/\bbp\b/i, 'BP'],
  [/gasopas/i, 'Gasopas'],
];

/** "TotalEnergies - LA MASSANA I" → "TotalEnergies · La Massana I" */
function tidyName(nom: string): string {
  return nom
    .split(/\s+-\s+/)
    .map((part) =>
      part === part.toUpperCase() && /[A-ZÀ-Ü]{3}/.test(part)
        ? part
            .toLowerCase()
            .split(/([ \-']+)/)
            .map((w) => (/^[ \-']+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
            .join('')
        : part,
    )
    .join(' · ');
}

// ── Rows → Stations ──────────────────────────────────────────────────────────
interface AndAttributes {
  idIPE?: unknown;
  idProducte?: unknown;
  PREU?: unknown;
  DataInici?: unknown;
  NOM?: unknown;
  Parroquia?: unknown;
  Codi_parroquia?: unknown;
}

interface AndFeature {
  attributes?: AndAttributes;
  /** Station footprint polygon (esriGeometryPolygon in WGS84) */
  geometry?: { rings?: unknown };
}

interface AndResponse {
  features?: unknown[];
  error?: unknown;
}

function toNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function toStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Centroid of the first polygon ring — footprints are tiny, this is plenty */
function centroidOf(rings: unknown): GeoPoint | null {
  if (!Array.isArray(rings) || !Array.isArray(rings[0])) return null;
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (const pt of rings[0] as unknown[]) {
    if (!Array.isArray(pt)) continue;
    const [x, y] = pt as unknown[];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    lng += x;
    lat += y;
    n++;
  }
  if (!n) return null;
  lat /= n;
  lng /= n;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export function groupStations(features: unknown[]): Station[] {
  interface Acc {
    nom: string;
    parroquia: string;
    postalCode?: string;
    /** Filled by the first row carrying a usable ring; no point, no station */
    point: GeoPoint | null;
    prices: Partial<Record<FuelId, FuelPrice>>;
    /** idProducte → what it is and what it costs (the flux prices every row) */
    services: Map<number, { id: ExtraProductId; price: FuelPrice }>;
  }
  const byId = new Map<number, Acc>();

  for (const f of features) {
    if (!f || typeof f !== 'object') continue;
    const { attributes: a, geometry } = f as AndFeature;
    if (!a) continue;
    const id = toNum(a.idIPE);
    const nom = toStr(a.NOM);
    if (id == null || !nom) continue;

    // Buffer prices whatever the row's geometry: one row per station × product,
    // and the rings may only show up on a later row (or never).
    let acc = byId.get(id);
    if (!acc) {
      acc = { nom, parroquia: '', point: null, prices: {}, services: new Map() };
      byId.set(id, acc);
    }
    // Location and parish come from whichever row carries them
    if (!acc.point) acc.point = centroidOf(geometry?.rings);
    if (!acc.parroquia) acc.parroquia = toStr(a.Parroquia) ?? '';
    if (!acc.postalCode) acc.postalCode = toStr(a.Codi_parroquia);

    const product = toNum(a.idProducte);
    const price = toNum(a.PREU);
    const startMs = toNum(a.DataInici);
    const updatedAt = startMs != null ? new Date(startMs).toISOString() : undefined;
    const fuel = FUEL_PRODUCTS.find(([p]) => p === product)?.[1];
    if (fuel && price != null && price >= MIN_PRICE && price <= MAX_PRICE) {
      acc.prices[fuel] = { value: price, updatedAt };
    } else {
      const extra = EXTRA_PRODUCTS.find(([p]) => p === product)?.[1];
      if (extra && price != null && price > 0) {
        acc.services.set(product as number, { id: extra, price: { value: price, updatedAt } });
      }
    }
  }

  const stations: Station[] = [];
  for (const [id, acc] of byId) {
    // Heating-oil distributors ride the same flux — no road fuel, no station
    if (!Object.keys(acc.prices).length) continue;
    // No row ever carried a usable ring: nothing to place on the map
    if (!acc.point) continue;
    const banner = BANNERS.find(([re]) => re.test(acc.nom));
    const name = tidyName(acc.nom);
    // AdBlue / Gasoil millorat are what the « additives » filter looks for
    // (same rule as the Spanish source)
    const hasAdditives = acc.services.has(8) || acc.services.has(9);
    const tags: ServiceTag[] = hasAdditives ? ['additives'] : [];
    // …and AdBlue filters on its own: the flux declares the products on sale,
    // so a station without product 9 really doesn't dispense it
    if (acc.services.has(9)) tags.push('adBlue');
    const extraPrices: Partial<Record<ExtraProductId, FuelPrice>> = {};
    for (const [, { id: product, price }] of acc.services) extraPrices[product] = price;
    stations.push({
      id: `and-${id}`,
      name,
      init: initialsOf(name),
      brand: banner?.[1],
      lat: acc.point.lat,
      lng: acc.point.lng,
      address: '', // the flux carries no street addresses
      city: acc.parroquia,
      postalCode: acc.postalCode,
      prices: acc.prices,
      tags,
      services: EXTRA_PRODUCTS.filter(([p]) => acc.services.has(p)).map(([, id]) => id),
      extraPrices,
      highway: false, // Andorra has no motorways
      hours: undefined, // the flux carries no opening hours
    });
  }
  return stations;
}

// ── Country fetch (memoized) ─────────────────────────────────────────────────
// The memo holds the *promise*, not the resolved list, so callers that arrive
// while the request is still in flight (map + route computed together, a pan
// landing mid-fetch, the « auto » source near the border) share it instead of
// each starting their own download.
let cache: { fetchedAt: number; stations: Promise<Station[]> } | null = null;

function fetchCountry(lowPriority = false): Promise<Station[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.stations;

  const stations = loadCountry(lowPriority);
  cache = { fetchedAt: Date.now(), stations };
  // A failed fetch must retry on the next query, not stick for CACHE_MS.
  stations.catch(() => {
    if (cache?.stations === stations) cache = null;
  });
  return stations;
}

async function loadCountry(lowPriority: boolean): Promise<Station[]> {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'idIPE,idProducte,PREU,DataInici,NOM,Parroquia,Codi_parroquia',
    // ArcGIS defaults it to true, but the centroid depends on it — be explicit
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    priority: lowPriority ? 'low' : 'auto',
  });
  if (!res.ok) throw new Error(`and flux HTTP ${res.status}`);
  const json = (await res.json()) as AndResponse;
  // ArcGIS reports failures inside a 200 response
  if (json.error || !Array.isArray(json.features)) throw new Error('and flux rejected the query');

  return groupStations(json.features);
}

// ── Provider ─────────────────────────────────────────────────────────────────
export class AndStationsProvider implements StationsProvider {
  readonly id = 'and' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true, // the station name carries the banner
  };

  async getStationsNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<Station[]> {
    if (!andCoversNear(center, radiusKm)) return [];
    const stations = await fetchCountry(opts?.lowPriority);
    return stations
      .filter((st) => haversineKm(center, { lat: st.lat, lng: st.lng }) <= radiusKm)
      .sort(
        (a, b) =>
          haversineKm(center, { lat: a.lat, lng: a.lng }) -
          haversineKm(center, { lat: b.lat, lng: b.lng }),
      );
  }

  async getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]> {
    if (!andCoversAlong(polyline, corridorKm)) return [];
    const stations = await fetchCountry();
    return stations.filter(
      (st) => nearestOnPolyline({ lat: st.lat, lng: st.lng }, polyline).distKm <= corridorKm,
    );
  }
}
