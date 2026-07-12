// Geo helpers — haversine distances, polyline utilities

export interface GeoPoint {
  lat: number;
  lng: number;
}

const R_EARTH_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a polyline in km */
export function polylineLengthKm(line: GeoPoint[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += haversineKm(line[i - 1], line[i]);
  return d;
}

/** Cumulative km at each polyline vertex */
export function cumulativeKm(line: GeoPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++)
    out.push(out[i - 1] + haversineKm(line[i - 1], line[i]));
  return out;
}

/**
 * For a point near a polyline: distance to the closest vertex (km) and the
 * km-along-route of that vertex. Vertex-level precision is plenty for
 * "station along a motorway corridor" purposes.
 */
export function nearestOnPolyline(
  p: GeoPoint,
  line: GeoPoint[],
  cumKm?: number[],
): { distKm: number; alongKm: number; index: number } {
  const cum = cumKm ?? cumulativeKm(line);
  let best = { distKm: Infinity, alongKm: 0, index: 0 };
  for (let i = 0; i < line.length; i++) {
    const d = haversineKm(p, line[i]);
    if (d < best.distKm) best = { distKm: d, alongKm: cum[i], index: i };
  }
  return best;
}

/**
 * Pick sample points spaced ~everyKm along the polyline (always includes the
 * first and last vertex). Used to fan out radius queries along a route.
 */
export function samplePolyline(line: GeoPoint[], everyKm: number): GeoPoint[] {
  if (line.length <= 2) return [...line];
  const cum = cumulativeKm(line);
  const total = cum[cum.length - 1];
  const samples: GeoPoint[] = [line[0]];
  let next = everyKm;
  for (let i = 1; i < line.length && next < total; i++) {
    if (cum[i] >= next) {
      samples.push(line[i]);
      next += everyKm;
    }
  }
  samples.push(line[line.length - 1]);
  return samples;
}

/** Interpolated point at a fraction t (0..1) along a straight line between two points */
export function lerpPoint(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}
