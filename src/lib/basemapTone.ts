// The dark basemap, restyled after CARTO's Dark Matter.
//
// OpenFreeMap's `dark` style is the open GL port of Dark Matter, but a darker,
// heavier cut than the CARTO dark_all rasters the app used to show: near-black
// ground, streets at #181818 drawn wide, black-filled motorways, black water,
// and big-city names that vanish at street zooms. At arm's length the street
// grid disappeared. CARTO publishes the GL style its rasters are rendered from
// (basemaps.cartocdn.com/gl/dark-matter-gl-style, CC BY 4.0), so the values
// below are its own: thin blue-grey streets (rgb 65,71,88) drawn as hairlines
// at city zooms, lighter primaries, dark casings on the trunk roads, slate
// water, buildings fading in from z13, and large light city names. Its tiles
// use another schema (Protomaps), so the style itself cannot run on
// OpenFreeMap's OpenMapTiles; the values are mapped onto the dark style's own
// layers, by id. A layer the style renames or drops is simply not
// restyled (it keeps the plain OpenFreeMap look), never an error.
//
// CARTO's stops are written against the zoom its raster tiles were drawn at,
// which is Leaflet's. The MapLibre map behind Leaflet runs one level below it
// (lib/tilePyramid.ts, vectorTileZoom), so `atLeafletZoom` moves every stop
// down one level: at Leaflet's z13 the map draws what CARTO drew at z13.
//
// The `.basemap-vector` filter (styles.css) applies on top, the same one the
// CARTO rasters went through, so the raw colors are CARTO's raw colors.

type Expression = unknown;

/** A property set to `undefined` is removed from the layer */
export interface LayerOverride {
  paint?: Record<string, Expression>;
  layout?: Record<string, Expression>;
  minzoom?: number;
  maxzoom?: number;
}

/** `[zoom, value]` stops on Leaflet's zoom, as a MapLibre expression on its
    own zoom (one level below) */
function atLeafletZoom(stops: [number, Expression][]): Expression {
  return ['interpolate', ['linear'], ['zoom'], ...stops.flatMap(([z, v]) => [z - 1, v])];
}

/** A Leaflet zoom as the MapLibre zoom a layer range is written in */
const leafletZoom = (z: number): number => z - 1;

/** `then` from Leaflet's zoom `z` on, `before` under it */
function fromLeafletZoom(z: number, before: Expression, then: Expression): Expression {
  return ['step', ['zoom'], before, leafletZoom(z), then];
}

const roadClass = ['get', 'class'];

const GROUND = '#0e0e0e';
/** The street color: CARTO's minor and secondary roads, case and fill alike */
const STREET = 'rgb(65,71,88)';
/** Primary roads' fill, a step lighter than the streets */
const PRIMARY = 'rgb(83,86,102)';
/** Trunk and motorway casings: a dark rim that sets the fill apart */
const TRUNK_CASE = '#232323';
const MOTORWAY = 'rgb(73,73,73)';

// The major layers carry primary, secondary, tertiary and trunk together;
// CARTO draws secondary/tertiary as one wide blue-grey line, primary and trunk
// as a fill inside a dark casing. One width table per class, on shared stops.
const isSecondary = ['match', roadClass, ['secondary', 'tertiary'], true, false];
const byMajorClass = (secondary: Expression, other: Expression): Expression => [
  'case',
  isSecondary,
  secondary,
  other,
];

export const DARK_OVERRIDES: Record<string, LayerOverride> = {
  background: { paint: { 'background-color': GROUND } },
  water: { paint: { 'fill-color': '#2c353c' } },
  waterway: {
    paint: {
      'line-color': 'rgb(63,90,109)',
      'line-width': atLeafletZoom([
        [8, 0.5],
        [9, 1],
        [15, 2],
        [16, 3],
      ]),
    },
  },
  landuse_residential: { paint: { 'fill-color': 'rgba(0,0,0,0.3)', 'fill-opacity': 1 } },
  landuse_park: { paint: { 'fill-color': GROUND } },
  // Plain ground, as CARTO has it. The pattern goes too: the dark style asks
  // for a `wood-pattern` its sprite does not carry, a warning on every map.
  landcover_wood: { paint: { 'fill-color': GROUND, 'fill-pattern': undefined } },
  // Darker than the GL style's rgb(57,57,57): CARTO's rasters draw their
  // buildings just above the ground (≈ 34 on screen over a 30 ground, z15),
  // and the GL value reads as a lit block pattern over the whole city
  building: {
    paint: {
      'fill-color': 'rgb(17,17,17)',
      'fill-outline-color': 'rgb(21,21,21)',
      'fill-opacity': atLeafletZoom([
        [13, 0],
        [15, 1],
      ]),
    },
  },
  road_area_pier: { paint: { 'fill-color': GROUND } },
  road_pier: { paint: { 'line-color': GROUND } },
  highway_path: {
    paint: {
      'line-color': '#262626',
      'line-opacity': fromLeafletZoom(15, 0, 1),
      'line-width': atLeafletZoom([
        [15, 0.5],
        [16, 1],
        [18, 3],
      ]),
    },
  },
  // minor, service and track: CARTO shows the minor streets as hairlines from
  // z13 and the service roads, darker, only from z15
  highway_minor: {
    paint: {
      'line-color': ['match', roadClass, 'minor', STREET, '#1c1c1c'],
      'line-opacity': fromLeafletZoom(15, ['match', roadClass, 'minor', 1, 0], 1),
      'line-width': atLeafletZoom([
        [12, 0.5],
        [14, 2],
        [15, 3],
        [16, 4.3],
        [17, 10],
        [18, 14],
      ]),
    },
  },
  highway_major_subtle: { paint: { 'line-color': TRUNK_CASE } },
  highway_major_casing: {
    paint: {
      'line-color': byMajorClass(STREET, TRUNK_CASE),
      'line-width': atLeafletZoom([
        [11, byMajorClass(0.9, 3)],
        [12, byMajorClass(1.5, 3.5)],
        [13, byMajorClass(3, 4)],
        [14, byMajorClass(5, 6)],
        [15, byMajorClass(6, 8)],
        [16, byMajorClass(8, 10)],
        [17, byMajorClass(12, 14)],
        [18, byMajorClass(16, 18)],
      ]),
    },
  },
  highway_major_inner: {
    paint: {
      'line-color': ['match', roadClass, 'primary', PRIMARY, STREET],
      'line-width': atLeafletZoom([
        [11, byMajorClass(0.5, 0.9)],
        [13, 2],
        [14, byMajorClass(3, 4)],
        [15, byMajorClass(4, 6)],
        [16, byMajorClass(6, 8)],
        [17, byMajorClass(10, 12)],
        [18, byMajorClass(14, 16)],
      ]),
    },
  },
  highway_motorway_casing: {
    paint: {
      'line-color': TRUNK_CASE,
      'line-width': atLeafletZoom([
        [6, 0.5],
        [8, 0.8],
        [11, 3],
        [12, 4],
        [13, 5],
        [14, 7],
        [15, 9],
        [16, 11],
        [17, 13],
        [18, 22],
      ]),
    },
  },
  highway_motorway_inner: {
    paint: {
      'line-color': MOTORWAY,
      'line-width': atLeafletZoom([
        [6, 0.3],
        [10, 1],
        [12, 2],
        [13, 3],
        [14, 5],
        [15, 7],
        [16, 9],
        [17, 11],
        [18, 20],
      ]),
    },
  },
  highway_motorway_subtle: { paint: { 'line-color': TRUNK_CASE } },
  railway: {
    paint: {
      'line-color': '#1a1a1a',
      'line-width': atLeafletZoom([
        [13, 0.5],
        [14, 1],
        [15, 1],
        [16, 3],
        [21, 7],
      ]),
    },
  },
  railway_dashline: { paint: { 'line-color': '#111' } },
  railway_transit: { paint: { 'line-color': '#1a1a1a' } },
  railway_transit_dashline: { paint: { 'line-color': '#111' } },
  railway_minor: { paint: { 'line-color': '#1a1a1a' } },
  railway_minor_dashline: { paint: { 'line-color': '#111' } },
  // Labels: towns in title case and light, cities large and uppercase — and
  // kept on screen at city zooms, where the dark style drops the big ones
  place_village: {
    paint: { 'text-color': 'rgb(154,153,153)', 'text-halo-color': '#222' },
    layout: {
      'text-transform': 'none',
      'text-size': atLeafletZoom([
        [10, 9],
        [12, 10],
        [13, 11],
        [14, 12],
        [16, 13],
      ]),
    },
  },
  place_town: {
    paint: { 'text-color': 'rgb(204,208,228)', 'text-halo-color': '#222' },
    layout: {
      'text-transform': 'none',
      'text-size': atLeafletZoom([
        [8, 10],
        [10, 11],
        [13, 14],
        [14, 15],
      ]),
    },
  },
  place_city: {
    paint: { 'text-color': 'rgb(168,176,180)', 'text-halo-color': '#222' },
    layout: {
      'text-size': atLeafletZoom([
        [8, 12],
        [10, 14],
        [13, 17],
        [14, 20],
      ]),
    },
    maxzoom: leafletZoom(15),
  },
  place_city_large: {
    paint: { 'text-color': 'rgb(211,228,236)', 'text-halo-color': '#222' },
    layout: {
      'text-size': atLeafletZoom([
        [8, 14],
        [10, 16],
        [13, 19],
        [14, 22],
      ]),
    },
    maxzoom: leafletZoom(15),
  },
};

/** `props` over `base`, a property set to `undefined` removed */
function merge(base: object | undefined, props: Record<string, Expression>): Record<string, Expression> {
  const out: Record<string, Expression> = { ...base, ...props };
  for (const [k, v] of Object.entries(props)) if (v === undefined) delete out[k];
  return out;
}

/** A copy of `style` with each override merged over the layer it names */
export function restyle<L extends { id: string; paint?: object; layout?: object }, S extends { layers: L[] }>(
  style: S,
  overrides: Record<string, LayerOverride>,
): S {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const o = overrides[layer.id];
      if (!o) return layer;
      return {
        ...layer,
        ...(o.minzoom !== undefined ? { minzoom: o.minzoom } : null),
        ...(o.maxzoom !== undefined ? { maxzoom: o.maxzoom } : null),
        ...(o.paint ? { paint: merge(layer.paint, o.paint) } : null),
        ...(o.layout ? { layout: merge(layer.layout, o.layout) } : null),
      };
    }),
  };
}
