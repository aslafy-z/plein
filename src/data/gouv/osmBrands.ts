// Brand/name enrichment for the gouv flux (which ships neither).
// OpenStreetMap knows fuel stations' brands: we fetch amenity=fuel POIs from
// Overpass and match each gouv station to the nearest POI within ~150 m.
// POIs are cached in localStorage for a week (brands rarely change).
import { IS_DEV } from '../../lib/env';
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, samplePolyline } from '../../lib/geo';
import type { BrandCat, Station } from '../types';

const BASE = (IS_DEV ? '/proxy/overpass' : 'https://overpass-api.de') + '/api/interpreter';
const TIMEOUT_MS = 20000;
/** A gouv station adopts a POI's brand only within this distance */
const MATCH_KM = 0.15;

const LS_KEY = 'plein.fuelpois.v1';
const TTL_MS = 7 * 24 * 3600_000;
const MAX_ENTRIES = 6;

export interface FuelPoi {
  lat: number;
  lng: number;
  brand?: string;
  name?: string;
}

// ── POI cache (7 days — Overpass etiquette + instant reloads) ────────────────
interface CacheEntry {
  key: string;
  fetchedAt: number;
  pois: FuelPoi[];
}

function cacheGet(key: string): FuelPoi[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const list = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as CacheEntry[];
    const hit = list.find((e) => e.key === key && Date.now() - e.fetchedAt < TTL_MS);
    return hit ? hit.pois : null;
  } catch {
    return null;
  }
}

function cachePut(key: string, pois: FuelPoi[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const list = (JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as CacheEntry[]).filter(
      (e) => e.key !== key,
    );
    list.unshift({ key, fetchedAt: Date.now(), pois });
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota — best effort */
  }
}

// ── Overpass ─────────────────────────────────────────────────────────────────
interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: { brand?: string; name?: string; operator?: string };
}

async function overpass(query: string): Promise<FuelPoi[]> {
  const res = await fetch(`${BASE}?data=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const json = (await res.json()) as { elements?: OverpassElement[] };
  const out: FuelPoi[] = [];
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const brand = el.tags?.brand?.trim();
    const name = (el.tags?.name ?? el.tags?.operator)?.trim();
    if (!brand && !name) continue;
    out.push({ lat, lng, brand: brand || undefined, name: name || undefined });
  }
  return out;
}

export async function fuelPoisNear(center: GeoPoint, radiusKm: number): Promise<FuelPoi[]> {
  const key = `n:${center.lat.toFixed(2)},${center.lng.toFixed(2)},${radiusKm}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const q =
    `[out:json][timeout:20];nwr["amenity"="fuel"]` +
    `(around:${Math.round(radiusKm * 1000)},${center.lat.toFixed(5)},${center.lng.toFixed(5)});` +
    `out center tags;`;
  const pois = await overpass(q);
  cachePut(key, pois);
  return pois;
}

export async function fuelPoisAlong(polyline: GeoPoint[], corridorKm: number): Promise<FuelPoi[]> {
  if (polyline.length < 2) return [];
  const from = polyline[0];
  const to = polyline[polyline.length - 1];
  const key = `a:${from.lat.toFixed(2)},${from.lng.toFixed(2)}>${to.lat.toFixed(2)},${to.lng.toFixed(2)},${corridorKm}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  let samples = samplePolyline(polyline, 15);
  if (samples.length > 60) {
    const step = samples.length / 60;
    samples = Array.from({ length: 60 }, (_, i) => samples[Math.floor(i * step)]);
  }
  const coords = samples.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(',');
  const q =
    `[out:json][timeout:20];nwr["amenity"="fuel"]` +
    `(around:${Math.round(corridorKm * 1000) + 500},${coords});out center tags;`;
  const pois = await overpass(q);
  cachePut(key, pois);
  return pois;
}

// ── Brand → category (drives the « Marques » filter) ─────────────────────────
const BRAND_CATS: ReadonlyArray<readonly [RegExp, BrandCat]> = [
  [/leclerc/i, 'gs'],
  [/carrefour/i, 'gs'],
  [/intermarch/i, 'gs'],
  [/super\s?u|hyper\s?u|système u|u express|station u/i, 'gs'],
  [/auchan/i, 'gs'],
  [/casino|géant/i, 'gs'],
  [/cora\b/i, 'gs'],
  [/lidl|aldi|netto|leader price|colruyt|monoprix/i, 'gs'],
  [/total/i, 'pet'],
  [/\bbp\b/i, 'pet'],
  [/esso/i, 'pet'],
  [/shell/i, 'pet'],
  [/avia/i, 'pet'],
  [/agip|\beni\b/i, 'pet'],
  [/texaco|elf\b/i, 'pet'],
  [/dyneff/i, 'pet'],
];

function catFor(label: string): BrandCat {
  for (const [re, cat] of BRAND_CATS) if (re.test(label)) return cat;
  return 'ind';
}

function initialsOf(label: string): string {
  const words = label.split(/[\s·-]+/).filter((w) => w.length > 1 || /\d/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

/** Match stations to the nearest POI and adopt its brand/name. */
export function enrichWithBrands(stations: Station[], pois: FuelPoi[]): Station[] {
  if (!pois.length) return stations;
  return stations.map((s) => {
    let best: FuelPoi | null = null;
    let bestKm = Infinity;
    for (const p of pois) {
      const d = haversineKm({ lat: s.lat, lng: s.lng }, p);
      if (d < bestKm) {
        bestKm = d;
        best = p;
      }
    }
    if (!best || bestKm > MATCH_KM) return s;
    // Brand is the honest primary (OSM names are often stale, e.g. old Elf
    // stations renamed Total Access); the city keeps locating the station.
    const label = best.brand ?? best.name;
    if (!label) return s;
    const city = s.city ? s.name.split('·').pop()?.trim() : '';
    return {
      ...s,
      brand: label,
      cat: catFor(label),
      name: city ? `${label} · ${city}` : label,
      init: initialsOf(label),
    };
  });
}
