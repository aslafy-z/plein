// Build-time links between gouv stations and OpenStreetMap fuel POIs that
// the runtime proximity match (src/data/fr/osmBrands.ts) cannot make on its
// own.
//
// The gouv flux often places a station hundreds of metres off its forecourt:
// it is geocoded from a partial address, and more than half of the positions
// are rounded to 0.001° (`43.628, 1.48`). The runtime match only trusts a POI
// within 150 m. Widening that radius at runtime is unsafe: deciding that a
// POI further away is free takes every gouv station around it, and the app
// only ever holds the ones in the fetched zone or corridor. So the decision is
// made here, once, against the WHOLE flux, and shipped as explicit id → POI
// links.
//
// A gouv station is linked when:
//   1. no POI at all lies within MATCH_KM. Otherwise the runtime match
//      already handles it;
//   2. exactly one POI within LINK_KM is not already the runtime match of
//      another gouv station. Two free candidates is a coin toss, and a
//      claimed POI belongs to the station sitting on it;
//   3. no other station passing 1 and 2 points at that same POI.

/** Must equal MATCH_KM in src/data/fr/osmBrands.ts */
export const MATCH_KM = 0.15;
/** How far a link may reach, measured from the gouv position */
export const LINK_KM = 0.5;

const R_EARTH_KM = 6371;
const CELL_DEG = 0.02;

export function haversineKm(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cellOf(p) {
  return [Math.floor(p.lat / CELL_DEG), Math.floor(p.lng / CELL_DEG)];
}

/**
 * POIs within `km` of `p`, nearest first, as `[km, index]`. A cell is
 * 0.02° (≥ 1.4 km of longitude anywhere in France), wider than LINK_KM, so
 * the 3×3 block around the point's cell covers the whole window.
 */
function poisWithin(grid, pois, p, km) {
  const [la, ln] = cellOf(p);
  const out = [];
  for (let a = la - 1; a <= la + 1; a++)
    for (let b = ln - 1; b <= ln + 1; b++)
      for (const i of grid.get(`${a}:${b}`) ?? []) {
        const d = haversineKm(p, pois[i]);
        if (d <= km) out.push([d, i]);
      }
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/**
 * @param {{ id: number | string, lat: number, lng: number }[]} stations the whole gouv flux
 * @param {{ lat: number, lng: number }[]} pois the brand index's POIs, in index order
 * @returns {[number | string, number][]} `[gouvId, poiIndex]` pairs, sorted by id
 */
export function linkStations(stations, pois) {
  const grid = new Map();
  pois.forEach((p, i) => {
    const key = cellOf(p).join(':');
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  });

  const claimed = new Set();
  const unmatched = [];
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const near = poisWithin(grid, pois, s, MATCH_KM);
    if (near.length) claimed.add(near[0][1]);
    else unmatched.push(s);
  }

  const candidate = new Map();
  const takers = new Map();
  for (const s of unmatched) {
    const free = poisWithin(grid, pois, s, LINK_KM).filter(([, i]) => !claimed.has(i));
    if (free.length !== 1) continue;
    const i = free[0][1];
    candidate.set(s.id, i);
    takers.set(i, (takers.get(i) ?? 0) + 1);
  }

  return [...candidate]
    .filter(([, i]) => takers.get(i) === 1)
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
}

/**
 * Position of a raw flux record, read the way FrStationsProvider's
 * `parseCoords` reads it: `geom` first, then `latitude`/`longitude`, which
 * the flux writes in 1e-5 degrees.
 */
export function gouvPosition(rec) {
  const num = (v) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const g = rec.geom;
  if (g && typeof g === 'object') {
    const lat = num(g.lat);
    const lng = num(g.lon);
    if (lat != null && lng != null) return { lat, lng };
  }
  let lat = num(rec.latitude);
  let lng = num(rec.longitude);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90) {
    lat /= 100000;
    lng /= 100000;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
