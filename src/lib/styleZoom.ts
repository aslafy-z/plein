// Shift every zoom a MapLibre style keys on by a fixed number of levels.
//
// The vector basemap runs one zoom below Leaflet (512 px tiles, lib/tiles.ts):
// at Leaflet's z13 MapLibre is at z12, so a style written for 512 px maps
// draws Leaflet's z13 with its z12 rules — thinner streets, fainter roads,
// fewer labels — where the raster basemap it stands in for (CARTO's renders
// of the same styles, 256 px tiles) drew z13 with z13 rules. Shifting the
// style by -1 makes MapLibre's z12 evaluate as z13: the same map at the same
// Leaflet zoom.
//
// What moves: a layer's minzoom/maxzoom, the stops of `interpolate` / `step`
// expressions on ["zoom"], a comparison of ["zoom"] with a number (in filters
// and `case`), and the legacy function syntax (`{ stops: [[z, v]] }`, and
// `{ zoom, value }` keys of zoom-and-property functions). Everything else is
// passed through untouched. Pure and Leaflet/MapLibre-free, so it is
// unit-tested in node.

type Json = unknown;

const ZOOM_COMPARISONS = new Set(['<', '<=', '>', '>=', '==', '!=']);

const isZoom = (v: Json): boolean => Array.isArray(v) && v.length === 1 && v[0] === 'zoom';

function shiftValue(v: Json, dz: number): Json {
  if (Array.isArray(v)) return shiftExpression(v, dz);
  if (v && typeof v === 'object') return shiftFunction(v as Record<string, Json>, dz);
  return v;
}

function shiftExpression(expr: Json[], dz: number): Json[] {
  const out = expr.map((x) => shiftValue(x, dz));
  const op = expr[0];
  // ["interpolate", interpolation, ["zoom"], z1, v1, z2, v2, …]
  if (
    (op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab') &&
    isZoom(expr[2])
  ) {
    for (let i = 3; i < out.length; i += 2) {
      if (typeof out[i] === 'number') out[i] = (out[i] as number) + dz;
    }
  }
  // ["step", ["zoom"], v0, z1, v1, z2, v2, …]
  if (op === 'step' && isZoom(expr[1])) {
    for (let i = 3; i < out.length; i += 2) {
      if (typeof out[i] === 'number') out[i] = (out[i] as number) + dz;
    }
  }
  // [">=", ["zoom"], 13] and its mirror [">=", 13, ["zoom"]]
  if (typeof op === 'string' && ZOOM_COMPARISONS.has(op) && expr.length === 3) {
    if (isZoom(expr[1]) && typeof expr[2] === 'number') out[2] = expr[2] + dz;
    if (isZoom(expr[2]) && typeof expr[1] === 'number') out[1] = expr[1] + dz;
  }
  return out;
}

/** The legacy function syntax: `{ stops: [[z, v], …] }` keys on zoom unless it
    names a `property`; a zoom-and-property function keys on `{ zoom, value }` */
function shiftFunction(fn: Record<string, Json>, dz: number): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(fn)) out[k] = shiftValue(v, dz);
  if (!Array.isArray(fn.stops)) return out;
  const byZoom = !('property' in fn);
  out.stops = (fn.stops as Json[]).map((stop) => {
    if (!Array.isArray(stop) || stop.length !== 2) return stop;
    const [input, value] = stop as [Json, Json];
    if (byZoom && typeof input === 'number') return [input + dz, value];
    if (input && typeof input === 'object' && typeof (input as { zoom?: Json }).zoom === 'number') {
      const zv = input as { zoom: number };
      return [{ ...zv, zoom: zv.zoom + dz }, value];
    }
    return [input, value];
  });
  return out;
}

interface StyleLayerLike {
  minzoom?: number;
  maxzoom?: number;
  filter?: Json;
  layout?: Record<string, Json>;
  paint?: Record<string, Json>;
}

/** A copy of `style` with every zoom it keys on moved by `dz` levels */
export function shiftStyleZoom<S extends { layers: StyleLayerLike[] }>(style: S, dz: number): S {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const out: StyleLayerLike = { ...layer };
      if (typeof layer.minzoom === 'number') out.minzoom = Math.max(0, layer.minzoom + dz);
      if (typeof layer.maxzoom === 'number') out.maxzoom = Math.max(0, layer.maxzoom + dz);
      if (layer.filter !== undefined) out.filter = shiftValue(layer.filter, dz);
      for (const key of ['layout', 'paint'] as const) {
        const props = layer[key];
        if (!props) continue;
        const shifted: Record<string, Json> = {};
        for (const [name, value] of Object.entries(props)) shifted[name] = shiftValue(value, dz);
        out[key] = shifted;
      }
      return out;
    }),
  };
}
