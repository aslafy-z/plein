// The search-zone circle as a Leaflet layer — an `L.Circle` that draws only
// the part of itself the map can show (see circleClip.ts for why: a 25 km
// radius is a ~115 000 px arc at zoom 19, and rasterizing it every frame drops
// a drag from 60 fps to 8).
//
// A plain `L.Circle` in every other respect: same options, same `.zone-circle`
// class, same `setLatLng`/`setRadius`/`setStyle`. Only the path written into
// the SVG changes, and only once the circle grows past what Leaflet can draw
// cheaply — below that the native arc is kept, exact and free.
import L from 'leaflet';
import { clippedDiscPath, discNeedsClip, type Rect } from './circleClip';

/**
 * How far past the map, in map-sizes, the clip box reaches on each side.
 *
 * The clipped polygon closes along that box and its stroke traces those edges,
 * so they must fall outside what the renderer paints — its own bounds are the
 * map size + 10%, and everything past them is cut away by the SVG viewBox.
 * One full map size of slack also covers the frames where the box and the path
 * are not recomputed together (a zoom animation scales the whole SVG without
 * touching either).
 */
const CLIP_MARGIN = 1;

/**
 * Leaflet internals this layer stands on. All private, all stable in the
 * pinned 1.9.x — `_point`/`_radius`/`_radiusY` are what `_project()` leaves
 * for the renderer (a geodesic circle projects to a slightly flattened
 * ellipse), and `_animatingZoom` is the guard Leaflet's own SVG renderer uses
 * to leave paths alone while the container is being scaled.
 */
interface CircleInternals {
  _map: (L.Map & { _animatingZoom?: boolean }) | null;
  _renderer: L.Renderer & { _setPath?: (layer: unknown, path: string) => void };
  _point: L.Point;
  _radius: number;
  _radiusY?: number;
  /** Inputs the current clipped path was computed from — recompute when they move */
  _clipKey?: string;
  _update(): void;
  _updatePath(): void;
  _reclip(): void;
}

type ZoneCircleLayer = L.Circle & CircleInternals;

/** `L.Circle`'s own implementations, for the ones overridden below to defer to */
const base = L.Circle.prototype as unknown as {
  onAdd(this: ZoneCircleLayer, map: L.Map): void;
  onRemove(this: ZoneCircleLayer, map: L.Map): void;
  _updatePath(this: ZoneCircleLayer): void;
};

/** The view, grown by CLIP_MARGIN on each side, in layer pixels */
function clipBox(map: L.Map): Rect {
  const size = map.getSize();
  const nw = map.containerPointToLayerPoint([0, 0]);
  const mx = size.x * CLIP_MARGIN;
  const my = size.y * CLIP_MARGIN;
  return {
    minX: nw.x - mx,
    minY: nw.y - my,
    maxX: nw.x + size.x + mx,
    maxY: nw.y + size.y + my,
  };
}

const ZoneCircle = L.Circle.extend({
  onAdd(this: ZoneCircleLayer, map: L.Map) {
    base.onAdd.call(this, map);
    // The clip follows the VIEW, so a pan invalidates the path even though the
    // circle hasn't moved: layer coordinates don't change under a pan, and
    // Leaflet only redraws paths on moveend. Without this the box the polygon
    // closes along would drift into sight mid-pan.
    map.on('move', this._reclip, this);
  },

  onRemove(this: ZoneCircleLayer, map: L.Map) {
    map.off('move', this._reclip, this);
    base.onRemove.call(this, map);
  },

  _reclip(this: ZoneCircleLayer) {
    this._update();
  },

  _updatePath(this: ZoneCircleLayer) {
    const map = this._map;
    const renderer = this._renderer;
    // Canvas renderer (no path to write), or a zoom animation in flight: leave
    // the drawing to Leaflet, which keeps the last path and scales it
    if (!map || typeof renderer._setPath !== 'function') {
      base._updatePath.call(this);
      return;
    }
    if (map._animatingZoom) return;

    const rx = this._radius;
    const ry = this._radiusY || rx;
    const box = clipBox(map);
    if (!discNeedsClip(this._point.x, this._point.y, rx, ry, box)) {
      this._clipKey = undefined;
      base._updatePath.call(this);
      return;
    }

    // Both the map's move handler (through the renderer's re-clip) and this
    // layer's own listener land here on the same frame — recompute once
    const key = `${this._point.x},${this._point.y},${rx},${ry},${box.minX},${box.minY},${box.maxX},${box.maxY}`;
    if (key === this._clipKey) return;
    this._clipKey = key;
    const d = clippedDiscPath(this._point.x, this._point.y, rx, ry, box);
    // Leaflet's own « nothing to draw » path
    renderer._setPath(this, d || 'M0 0');
  },
}) as unknown as new (latlng: L.LatLngExpression, options: L.CircleOptions) => L.Circle;

/** An `L.Circle` that stays cheap to draw however far the map is zoomed in */
export function zoneCircle(
  latlng: L.LatLngExpression,
  options: L.CircleOptions,
): L.Circle {
  return new ZoneCircle(latlng, options);
}
