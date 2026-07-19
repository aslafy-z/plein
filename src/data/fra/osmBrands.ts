// Brand/name/position enrichment for the gouv flux (which ships no names and
// often imprecise coordinates geocoded from partial addresses).
// Brands come from a static France-wide OpenStreetMap index generated at build
// time (scripts/build-brand-index.mjs) and served with the app. Querying
// Overpass at runtime proved hopeless — public instances rate-limit, block IPs
// and time out, and every failure painted a whole zone « Station · Ville »
// while making stations wait on a dead mirror. Brands change rarely; a bundled
// snapshot is fresher in practice than an API that answers one time in three.
import type { GeoPoint } from '../../lib/geo';
import { haversineKm } from '../../lib/geo';
import type { BrandCat, Station } from '../types';

/** A gouv station adopts a POI's brand (and position) only within this distance */
const MATCH_KM = 0.15;

export interface FuelPoi {
  lat: number;
  lng: number;
  label: string;
}

// ── Static index (fetched once, memoized) ────────────────────────────────────
/** Compact on-disk shape: label dictionary + [lat, lng, labelIndex] rows */
interface BrandIndexFile {
  labels: string[];
  pois: [number, number, number][];
}

let indexPromise: Promise<FuelPoi[]> | null = null;

function loadIndex(): Promise<FuelPoi[]> {
  if (!indexPromise) {
    indexPromise = fetch('/brands-fra.json', { signal: AbortSignal.timeout(15000) }).then(
      async (res) => {
        if (!res.ok) throw new Error(`brand index HTTP ${res.status}`);
        const json = (await res.json()) as BrandIndexFile;
        return json.pois.map(([lat, lng, i]) => ({ lat, lng, label: json.labels[i] ?? '' }));
      },
    );
    // A failed load must retry on the next enrichment, not stick forever.
    indexPromise.catch(() => {
      indexPromise = null;
    });
  }
  return indexPromise;
}

/** POIs around a point. Over-inclusion is harmless: matching is ≤ MATCH_KM. */
export async function fuelPoisNear(center: GeoPoint, radiusKm: number): Promise<FuelPoi[]> {
  const pois = await loadIndex();
  const r = radiusKm + 1;
  return pois.filter((p) => haversineKm(center, p) <= r);
}

/** POIs in the route's bounding box (+ corridor margin) — cheap prefilter. */
export async function fuelPoisAlong(polyline: GeoPoint[], corridorKm: number): Promise<FuelPoi[]> {
  if (polyline.length === 0) return [];
  const pois = await loadIndex();
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of polyline) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const marginKm = corridorKm + 1;
  const dLat = marginKm / 111;
  const dLng = marginKm / (111 * Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180)));
  return pois.filter(
    (p) =>
      p.lat >= minLat - dLat &&
      p.lat <= maxLat + dLat &&
      p.lng >= minLng - dLng &&
      p.lng <= maxLng + dLng,
  );
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

/**
 * Match stations to the nearest POI and adopt its brand/name — and its
 * coordinates. The gouv flux position is often geocoded from a partial
 * address (mid-street, missing house number), while OSM contributors place
 * the node on the forecourt itself: snapping fixes both the map pin and the
 * « Y aller » navigation target.
 */
export function enrichWithBrands(stations: Station[], pois: FuelPoi[]): Station[] {
  if (!pois.length) return stations;
  const matches = stations.map((s) => {
    // Nearest POI donates its position; nearest *labeled* POI donates the
    // brand (the index also carries unlabeled stations, kept for their coords).
    let best: FuelPoi | null = null;
    let bestKm = Infinity;
    let labeled: FuelPoi | null = null;
    let labeledKm = Infinity;
    for (const p of pois) {
      const d = haversineKm({ lat: s.lat, lng: s.lng }, p);
      if (d < bestKm) {
        bestKm = d;
        best = p;
      }
      if (p.label && d < labeledKm) {
        labeledKm = d;
        labeled = p;
      }
    }
    if (!best || bestKm > MATCH_KM) return null;
    return {
      poi: best,
      km: bestKm,
      label: labeled && labeledKm <= MATCH_KM ? labeled.label : '',
    };
  });
  // If several gouv records match the same POI (duplicates, dense areas),
  // only the closest one snaps to it — otherwise their pins would stack.
  const closestKm = new Map<FuelPoi, number>();
  for (const m of matches) {
    if (m && m.km < (closestKm.get(m.poi) ?? Infinity)) closestKm.set(m.poi, m.km);
  }
  return stations.map((s, i) => {
    const m = matches[i];
    if (!m) return s;
    const snap = closestKm.get(m.poi) === m.km ? { lat: m.poi.lat, lng: m.poi.lng } : {};
    if (!m.label) return { ...s, ...snap };
    const city = s.city ? s.name.split('·').pop()?.trim() : '';
    return {
      ...s,
      brand: m.label,
      cat: catFor(m.label),
      name: city ? `${m.label} · ${city}` : m.label,
      init: initialsOf(m.label),
      ...snap,
    };
  });
}
