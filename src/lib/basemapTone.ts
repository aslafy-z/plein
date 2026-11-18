// The dark basemap's ground and roads, repainted.
//
// OpenFreeMap's Dark Matter is a darker cut than the CARTO dark_all rasters
// the app used to show: near-black ground (rgb 12), minor streets at #181818,
// motorways filled black — at arm's length the street grid disappears. A CSS
// filter cannot bring it back on its own: brightening the roads that much
// also blows out the labels, which are already where they should be. So the
// ground and road layers get the values CARTO's render had, measured off it
// through the same `.basemap-vector` filter (styles.css, ≈ 1.35 × value + 13
// on screen): ground ≈ 42, streets ≈ 75–110 on screen. Labels, boundaries
// and everything else keep the style's own paint.
//
// Keyed by layer id: a layer the style renames or drops is simply not
// repainted (the map stays the plain Dark Matter for it), never an error.

type Paint = Record<string, unknown>;

const GROUND = 'rgb(22,22,22)';

export const DARK_PAINT: Record<string, Paint> = {
  background: { 'background-color': GROUND },
  water: { 'fill-color': 'rgb(12,12,13)' },
  waterway: { 'line-color': 'rgb(12,12,13)' },
  landuse_residential: { 'fill-color': 'rgb(26,26,26)', 'fill-opacity': 0.5 },
  landuse_park: { 'fill-color': 'rgb(28,28,28)' },
  landcover_wood: { 'fill-color': 'rgb(28,28,28)' },
  building: { 'fill-color': 'rgb(18,18,18)', 'fill-outline-color': 'rgb(30,30,30)' },
  road_area_pier: { 'fill-color': GROUND },
  road_pier: { 'line-color': GROUND },
  highway_path: { 'line-color': 'rgb(38,38,38)' },
  highway_minor: { 'line-color': 'rgb(46,46,46)' },
  highway_major_casing: { 'line-color': 'rgba(70,70,70,0.8)' },
  highway_major_inner: { 'line-color': 'rgb(54,54,54)' },
  highway_major_subtle: { 'line-color': 'rgb(50,50,50)' },
  highway_motorway_casing: { 'line-color': 'rgba(78,78,78,0.8)' },
  highway_motorway_inner: { 'line-color': 'rgb(60,60,60)' },
  highway_motorway_subtle: { 'line-color': 'rgb(50,50,50)' },
  railway: { 'line-color': 'rgb(42,42,42)' },
  railway_dashline: { 'line-color': GROUND },
  railway_transit: { 'line-color': 'rgb(42,42,42)' },
  railway_transit_dashline: { 'line-color': GROUND },
  railway_minor: { 'line-color': 'rgb(42,42,42)' },
  railway_minor_dashline: { 'line-color': GROUND },
};

/** A copy of `style` with `paint` merged over the layers it names */
export function repaint<S extends { layers: { id: string; paint?: Paint }[] }>(
  style: S,
  paint: Record<string, Paint>,
): S {
  return {
    ...style,
    layers: style.layers.map((layer) =>
      paint[layer.id] ? { ...layer, paint: { ...layer.paint, ...paint[layer.id] } } : layer,
    ),
  };
}
