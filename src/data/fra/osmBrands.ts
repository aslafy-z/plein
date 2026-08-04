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
import { initialsOf } from '../../lib/text';
import type { Station } from '../types';

/** A gouv station adopts a POI's brand (and position) only within this distance */
const MATCH_KM = 0.15;

/** Degrees of latitude per km, on the sphere `haversineKm` assumes */
const DEG_PER_KM = 180 / (Math.PI * 6371);

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
  // The index is France-wide (~12 600 POIs); rejecting on latitude alone —
  // a subtraction — skips the haversine for the vast majority of them.
  const dLat = r * DEG_PER_KM;
  return pois.filter((p) => Math.abs(p.lat - center.lat) <= dLat && haversineKm(center, p) <= r);
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

// ── Spatial index over the candidate POIs ────────────────────────────────────
// The prefilters above stay deliberately loose — `fuelPoisAlong` keeps the
// route's whole bounding box — so a long diagonal route hands `enrichWithBrands`
// a couple of thousand POIs to weigh against a few hundred corridor stations.
// Scanning the list per station meant hundreds of thousands of haversine calls,
// synchronously, while the route screen waited to paint. Since a match is only
// ever ≤ MATCH_KM away, bucketing the POIs into a coarse lat/lng grid once lets
// each station look at the handful of cells that could possibly hold one.

/** Grid cell side in degrees — must stay comfortably wider than the match window */
const CELL_DEG = 0.02;
/** Match window, with a hair of slack so a POI sitting exactly at MATCH_KM can't fall out */
const WINDOW_KM = MATCH_KM * 1.01;

/** Number of longitude cells around the globe — the seam at ±180° folds onto itself */
const LNG_CELLS = Math.round(360 / CELL_DEG);

/** Cell key → indices into the POI array, ascending */
type PoiGrid = Map<string, number[]>;

function cellKey(latCell: number, lngCell: number): string {
  return `${latCell}:${((lngCell % LNG_CELLS) + LNG_CELLS) % LNG_CELLS}`;
}

function buildPoiGrid(pois: FuelPoi[]): PoiGrid {
  const grid: PoiGrid = new Map();
  for (let i = 0; i < pois.length; i++) {
    const key = cellKey(Math.floor(pois[i].lat / CELL_DEG), Math.floor(pois[i].lng / CELL_DEG));
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }
  return grid;
}

/**
 * Indices of every POI that could sit within MATCH_KM of `p`, ascending — the
 * order a full scan would visit them in, so ties still go to the first POI.
 */
function candidatesNear(grid: PoiGrid, count: number, p: GeoPoint): number[] {
  // A non-finite coordinate would make every cell bound infinite, and `la++`
  // never leaves Infinity — the walk below would spin forever. The full scan
  // this replaces just measured NaN and matched nothing; do the same, cheaply.
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return [];
  const dLat = WINDOW_KM * DEG_PER_KM;
  // Meridians converge, so the same window spans more longitude the further
  // north we are; measure the cosine at the edge of the window, not its center.
  const cos = Math.cos((Math.abs(p.lat) + dLat) * (Math.PI / 180));
  const dLng = Math.min(180, dLat / Math.max(cos, 1e-6));
  const latFrom = Math.floor((p.lat - dLat) / CELL_DEG);
  const latTo = Math.floor((p.lat + dLat) / CELL_DEG);
  const lngFrom = Math.floor((p.lng - dLng) / CELL_DEG);
  const lngTo = Math.floor((p.lng + dLng) / CELL_DEG);
  // Only degenerates near the poles, where the window wraps most of the globe
  // and walking the cells costs more than walking the POIs.
  if ((latTo - latFrom + 1) * (lngTo - lngFrom + 1) > count)
    return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  for (let la = latFrom; la <= latTo; la++)
    for (let ln = lngFrom; ln <= lngTo; ln++) {
      const bucket = grid.get(cellKey(la, ln));
      if (bucket) out.push(...bucket);
    }
  return out.length > 1 ? out.sort((a, b) => a - b) : out;
}

/**
 * Match stations to the nearest POI and adopt its brand/name — and its
 * coordinates. The gouv flux position is often geocoded from a partial
 * address (mid-street, missing house number), while OSM contributors place
 * the node on the forecourt itself: snapping fixes both the map pin and the
 * « Go there » navigation target.
 */
export function enrichWithBrands(stations: Station[], pois: FuelPoi[]): Station[] {
  if (!pois.length) return stations;
  const grid = buildPoiGrid(pois);
  const matches = stations.map((s) => {
    // Nearest POI donates its position; nearest *labeled* POI donates the
    // brand (the index also carries unlabeled stations, kept for their coords).
    let best: FuelPoi | null = null;
    let bestKm = Infinity;
    let labeled: FuelPoi | null = null;
    let labeledKm = Infinity;
    for (const i of candidatesNear(grid, pois.length, s)) {
      const p = pois[i];
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
      name: city ? `${m.label} · ${city}` : m.label,
      init: initialsOf(m.label),
      ...snap,
    };
  });
}
