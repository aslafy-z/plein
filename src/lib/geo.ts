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

/**
 * Smallest lat/lng box enclosing the circle of `radiusKm` around `center`.
 * Framing the map on it turns the zoom into a direct reading of the radius.
 */
export function radiusBounds(
  center: GeoPoint,
  radiusKm: number,
): { south: number; west: number; north: number; east: number } {
  const dLat = ((radiusKm / R_EARTH_KM) * 180) / Math.PI;
  // Meridians converge with latitude, so the same km spans more degrees of
  // longitude the further north we are — and everything at the poles, hence
  // the half-turn cap.
  const cos = Math.cos((center.lat * Math.PI) / 180);
  const dLng = Math.min(180, dLat / Math.max(cos, 1e-6));
  return {
    south: Math.max(-90, center.lat - dLat),
    north: Math.min(90, center.lat + dLat),
    west: center.lng - dLng,
    east: center.lng + dLng,
  };
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

// ── Polyline index ───────────────────────────────────────────────────────────
// `nearestOnPolyline` is asked the same question once PER STATION against the
// same route: a corridor of a thousand gouv records against an `overview=full`
// OSRM geometry (tens of thousands of vertices) is tens of millions of
// haversines — seconds of frozen main thread while the route screen waits, and
// the naive form also rebuilt the whole cumulative array on every one of those
// calls. So the line is indexed ONCE (memoized on the array itself, which is
// stable for a computed route) into consecutive blocks of vertices, each with
// its first vertex as anchor and the radius that encloses the block. A query
// then measures the anchors, and only opens the few blocks that can still hold
// something closer than the best anchor — the answer is the same vertex the
// full scan returns, for a fraction of the work.

interface PolylineIndex {
  cum: number[];
  blockSize: number;
  /** First vertex of each block */
  anchors: GeoPoint[];
  /** km from a block's anchor to its furthest vertex */
  radii: number[];
}

const polylineIndexes = new WeakMap<GeoPoint[], PolylineIndex>();

function polylineIndex(line: GeoPoint[], cumKm?: number[]): PolylineIndex {
  const memo = polylineIndexes.get(line);
  if (memo) return memo;
  const cum = cumKm ?? cumulativeKm(line);
  // √n blocks of √n vertices: the anchor pass and an opened block cost the
  // same, which is where the two halves of the query balance out.
  const blockSize = Math.max(16, Math.ceil(Math.sqrt(line.length)));
  const anchors: GeoPoint[] = [];
  const radii: number[] = [];
  for (let start = 0; start < line.length; start += blockSize) {
    const anchor = line[start];
    let radius = 0;
    for (let i = start + 1; i < Math.min(start + blockSize, line.length); i++) {
      const d = haversineKm(anchor, line[i]);
      if (d > radius) radius = d;
    }
    anchors.push(anchor);
    radii.push(radius);
  }
  const index = { cum, blockSize, anchors, radii };
  polylineIndexes.set(line, index);
  return index;
}

/**
 * For a point near a polyline: distance to the closest vertex (km) and the
 * km-along-route of that vertex. Vertex-level precision is plenty for
 * "station along a motorway corridor" purposes.
 *
 * `cumKm` only seeds the index the first time a line is measured against — it
 * is memoized from there on, so callers in a loop need not thread it through.
 */
export function nearestOnPolyline(
  p: GeoPoint,
  line: GeoPoint[],
  cumKm?: number[],
): { distKm: number; alongKm: number; index: number } {
  const best = { distKm: Infinity, alongKm: 0, index: 0 };
  if (!line.length) return best;
  const { cum, blockSize, anchors, radii } = polylineIndex(line, cumKm);

  // The nearest anchor is itself a vertex, so its distance bounds the answer
  // from above — every block whose closest possible vertex sits beyond it is
  // out, and cannot be opened.
  const anchorKm: number[] = [];
  let limit = Infinity;
  for (let b = 0; b < anchors.length; b++) {
    const d = haversineKm(p, anchors[b]);
    anchorKm.push(d);
    if (d < limit) limit = d;
  }

  // Blocks in vertex order, so equal distances still resolve to the first
  // vertex the full scan would have kept. A NaN bound never prunes.
  for (let b = 0; b < anchors.length; b++) {
    if (anchorKm[b] - radii[b] > limit) continue;
    const start = b * blockSize;
    for (let i = start; i < Math.min(start + blockSize, line.length); i++) {
      const d = i === start ? anchorKm[b] : haversineKm(p, line[i]);
      if (d < best.distKm) {
        best.distKm = d;
        best.alongKm = cum[i];
        best.index = i;
        if (d < limit) limit = d;
      }
    }
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
  const last = line[line.length - 1];
  const tail = samples[samples.length - 1];
  // The loop above may already have emitted the final vertex — appending it a
  // second time would cost a redundant query and understate the sample spacing.
  if (tail.lat !== last.lat || tail.lng !== last.lng) samples.push(last);
  return samples;
}

/** Interpolated point at a fraction t (0..1) along a straight line between two points */
export function lerpPoint(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}
