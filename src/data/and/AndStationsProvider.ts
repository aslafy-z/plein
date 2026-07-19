// Real Andorran government open data — official fuel prices from the Govern
// d'Andorra (Oficina de l'energia i del canvi climàtic, sig.govern.ad/IPE),
// served by the SIG's public ArcGIS layer « Preu dels carburants actuals ».
// The whole country is ~60 stations, so one request fetches everything
// (memoized) and queries filter client-side. Rows arrive as station × product;
// they are grouped by station id (idIPE) here.
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, nearestOnPolyline } from '../../lib/geo';
import type {
  BrandCat,
  FuelId,
  FuelPrice,
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
  [4, 'sp95'], // Gasolina sense plom 95 octans
  [5, 'sp98'], // Gasolina sense plom 98 octans
  [6, 'gazole'], // Gasoil de locomoció
  [11, 'gplc'], // GLP
];

// Other products become « Services » on the detail screen (like the Spanish
// source's extra products). Heating oil alone doesn't make a fuel station:
// stations with no road fuel at all are dropped.
const EXTRA_PRODUCTS: ReadonlyArray<readonly [number, string]> = [
  [8, 'Gazole Premium (millorat)'],
  [9, 'AdBlue'],
  [7, 'Fioul domestique — livraison'],
  [10, 'Fioul domestique — en station'],
];

// ── Brands ───────────────────────────────────────────────────────────────────
// The banner lives in the station name (NOM); Marca_importador is the
// importer, which differs on franchised stations (Dyneff imports via Elf…).
const BANNERS: ReadonlyArray<readonly [RegExp, string, BrandCat]> = [
  [/dyneff/i, 'Dyneff', 'pet'],
  [/meroil/i, 'Meroil', 'pet'],
  [/total/i, 'TotalEnergies', 'pet'],
  [/\belf\b/i, 'Elf', 'pet'],
  [/cepsa/i, 'Cepsa', 'pet'],
  [/repsol/i, 'Repsol', 'pet'],
  [/shell/i, 'Shell', 'pet'],
  [/\bbp\b/i, 'BP', 'pet'],
  [/gasopas/i, 'Gasopas', 'ind'],
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

function initialsOf(label: string): string {
  const words = label.split(/[\s·-]+/).filter((w) => w.length > 1 || /\d/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
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

function groupStations(features: unknown[]): Station[] {
  interface Acc {
    nom: string;
    parroquia: string;
    cp?: string;
    point: GeoPoint;
    prices: Partial<Record<FuelId, FuelPrice>>;
    services: Map<number, string>;
  }
  const byId = new Map<number, Acc>();

  for (const f of features) {
    if (!f || typeof f !== 'object') continue;
    const { attributes: a, geometry } = f as AndFeature;
    if (!a) continue;
    const id = toNum(a.idIPE);
    const nom = toStr(a.NOM);
    if (id == null || !nom) continue;

    let acc = byId.get(id);
    if (!acc) {
      const point = centroidOf(geometry?.rings);
      if (!point) continue;
      acc = {
        nom,
        parroquia: toStr(a.Parroquia) ?? '',
        cp: toStr(a.Codi_parroquia),
        point,
        prices: {},
        services: new Map(),
      };
      byId.set(id, acc);
    }

    const product = toNum(a.idProducte);
    const price = toNum(a.PREU);
    const startMs = toNum(a.DataInici);
    const updatedAt = startMs != null ? new Date(startMs).toISOString() : undefined;
    const fuel = FUEL_PRODUCTS.find(([p]) => p === product)?.[1];
    if (fuel && price != null && price >= MIN_PRICE && price <= MAX_PRICE) {
      acc.prices[fuel] = { value: price, updatedAt };
    } else {
      const extra = EXTRA_PRODUCTS.find(([p]) => p === product)?.[1];
      if (extra && price != null && price > 0) acc.services.set(product as number, extra);
    }
  }

  const stations: Station[] = [];
  for (const [id, acc] of byId) {
    // Heating-oil distributors ride the same flux — no road fuel, no station
    if (!Object.keys(acc.prices).length) continue;
    const banner = BANNERS.find(([re]) => re.test(acc.nom));
    const name = tidyName(acc.nom);
    stations.push({
      id: `and-${id}`,
      name,
      init: initialsOf(name),
      brand: banner?.[1],
      cat: banner?.[2] ?? 'unknown',
      lat: acc.point.lat,
      lng: acc.point.lng,
      address: '', // the flux carries no street addresses
      city: acc.parroquia,
      cp: acc.cp,
      prices: acc.prices,
      tags: [],
      services: EXTRA_PRODUCTS.filter(([p]) => acc.services.has(p)).map(([, label]) => label),
      highway: false, // Andorra has no motorways
      hours: undefined, // the flux carries no opening hours
    });
  }
  return stations;
}

// ── Country fetch (memoized) ─────────────────────────────────────────────────
let cache: { fetchedAt: number; stations: Station[] } | null = null;

async function fetchCountry(lowPriority = false): Promise<Station[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.stations;

  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'idIPE,idProducte,PREU,DataInici,NOM,Parroquia,Codi_parroquia',
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

  const stations = groupStations(json.features);
  cache = { fetchedAt: Date.now(), stations };
  return stations;
}

// ── Provider ─────────────────────────────────────────────────────────────────
export class AndStationsProvider implements StationsProvider {
  readonly id = 'and' as const;
  readonly capabilities: SourceCapabilities = {
    brands: true, // the station name carries the banner
    label: 'sig.govern.ad',
    sublabel: "Andorre · officiel Govern d'Andorra",
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
