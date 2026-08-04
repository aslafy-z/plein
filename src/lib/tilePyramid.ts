// Slippy-map tile math for the offline zoom-out pyramid (see lib/tiles).
// Pure and Leaflet-free on purpose: the enumeration and the URL fidelity
// (subdomain pick, retina suffix) are what make a prefetched tile land in the
// service-worker cache under the EXACT URL Leaflet will later request, and
// that is testable in node.

export interface TileCoords {
  z: number;
  x: number;
  y: number;
}

/** Web Mercator's latitude limit — the poles don't exist on the tile grid */
const MAX_LAT = 85.0511287798;

/** Fractional tile coordinates of a point at a zoom (standard slippy math) */
export function tileFraction(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/**
 * The tiles that keep zooming at (lat, lng) off a blank background: for each
 * requested zoom, the 2×2 block around the grid corner nearest the point.
 * That block always contains the tile the point is in, plus the neighbours a
 * view centred nearby shows — ~4 tiles per level, so a whole pyramid costs
 * less than one screenful. Zooming OUT that block covers ever more of the
 * screen (a z−1 tile is 4 z-tiles); zooming IN it covers the 512px square
 * around the point — the part of the view a zoom-in gesture homes in on —
 * and the periphery lazy-fills when online. `zooms` sets the fetch order:
 * put the levels a small gesture reaches first.
 */
export function pyramidTiles(lat: number, lng: number, zooms: number[]): TileCoords[] {
  const tiles: TileCoords[] = [];
  const seen = new Set<string>();
  for (const z of zooms) {
    if (z < 0 || !Number.isInteger(z)) continue;
    const n = 2 ** z;
    const { x, y } = tileFraction(lat, lng, z);
    const x0 = Math.round(x) - 1;
    const y0 = Math.round(y) - 1;
    for (let dy = 0; dy <= 1; dy += 1) {
      const ty = y0 + dy;
      if (ty < 0 || ty >= n) continue; // past a pole: no tile there
      for (let dx = 0; dx <= 1; dx += 1) {
        const tx = (((x0 + dx) % n) + n) % n; // the antimeridian wraps around
        const key = `${z}/${tx}/${ty}`;
        if (seen.has(key)) continue; // tiny grids collide after the wrap
        seen.add(key);
        tiles.push({ z, x: tx, y: ty });
      }
    }
  }
  return tiles;
}

/**
 * Geographic footprint of a tile — the inverse of tileFraction. North/west
 * edges come from the tile's own corner, south/east from the next tile's.
 */
export function tileToBounds(t: TileCoords): {
  north: number;
  south: number;
  west: number;
  east: number;
} {
  const n = 2 ** t.z;
  const lng = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { north: lat(t.y), south: lat(t.y + 1), west: lng(t.x), east: lng(t.x + 1) };
}

/**
 * Expand a Leaflet URL template exactly as Leaflet would: {s} picks the
 * subdomain by `Math.abs(x + y) % subdomains.length` (Leaflet's own rule) and
 * {r} is the retina suffix. A URL that differs by one character caches a tile
 * the map never asks for.
 */
export function tileUrl(
  template: string,
  tile: TileCoords,
  opts: { subdomains?: string; retina?: boolean } = {},
): string {
  const subs = opts.subdomains ?? '';
  const s = subs === '' ? '' : subs.charAt(Math.abs(tile.x + tile.y) % subs.length);
  return template
    .replace('{s}', s)
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
    .replace('{r}', opts.retina ? '@2x' : '');
}
