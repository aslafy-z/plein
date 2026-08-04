// Drawing only the part of a map circle that can be seen.
//
// The search zone is a circle in METRES, so its radius in pixels doubles with
// every zoom level: 25 km spans ~14 000 px at zoom 16 and ~115 000 px at zoom
// 19. An SVG arc that big is a repaint the browser pays in full on every frame
// — the map's own pan handler moves the circle at 60 Hz — and past ~40 000 px
// a drag collapses from 16 ms frames to 100 ms ones, taking the whole app down
// with it. The geometry is the cost, not the paint style: stroke-only and
// fill-only are equally slow.
//
// Nothing of that arc is visible anyway: what falls outside the viewport is
// clipped away by the renderer. So this module rebuilds the circle as the
// polygon of its intersection with a box around the view — a few hundred
// pixels of path instead of a hundred thousand — leaving the drawn result
// pixel-identical. Pure geometry, no Leaflet: `zoneCircle.ts` is the layer
// that feeds it a map.
//
// The polygon closes along the box edges, and its stroke would trace them —
// so the box the caller passes must sit well outside the visible map (see
// CLIP_MARGIN there): those edges land where the renderer clips them away.

/** Axis-aligned box, in the same pixel space as the circle */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Pt {
  x: number;
  y: number;
}

/** Max gap (px) between the drawn polyline and the true arc */
const DEFAULT_TOLERANCE = 0.25;
/**
 * Below this radius the native arc is cheap — a circle barely wider than the
 * screen costs nothing to rasterize, and Leaflet's own path is exact. Clipping
 * only starts to earn its keep well before the ~40 000 px cliff.
 */
export const CLIP_ABOVE_PX = 8000;
/** Coarsest arc segment, so a small circle still reads as round */
const MAX_STEP = Math.PI / 8;
/** Hard cap on sampled points — a runaway tolerance can't build a huge path */
const MAX_POINTS = 4096;

/**
 * Is this circle worth clipping? Only when it actually overflows the box AND
 * is large enough for the arc to cost something — everything else keeps
 * Leaflet's own exact arc.
 */
export function discNeedsClip(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rect: Rect,
): boolean {
  if (Math.max(rx, ry) <= CLIP_ABOVE_PX) return false;
  return (
    cx - rx < rect.minX || cx + rx > rect.maxX || cy - ry < rect.minY || cy + ry > rect.maxY
  );
}

/**
 * SVG path of the disc (`rx`/`ry` — Leaflet projects a geodesic circle as a
 * slightly flattened ellipse) intersected with `rect`. Empty string when the
 * two don't meet.
 */
export function clippedDiscPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rect: Rect,
  tolerance: number = DEFAULT_TOLERANCE,
): string {
  if (!(rx > 0) || !(ry > 0)) return '';

  // Normalized space: the ellipse becomes the unit circle at the origin, and
  // the box stays a box (an axis-aligned scaling maps rectangles to
  // rectangles), so the whole thing is plain circle-vs-rect geometry.
  const box: Rect = {
    minX: (rect.minX - cx) / rx,
    maxX: (rect.maxX - cx) / rx,
    minY: (rect.minY - cy) / ry,
    maxY: (rect.maxY - cy) / ry,
  };
  if (box.maxX < box.minX || box.maxY < box.minY) return '';

  const corners: Pt[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  // Box entirely inside the disc — the visible zone IS the box. This is the
  // case the whole module exists for: zoomed in, the circle's edge is
  // kilometres off screen and only its fill tint shows.
  if (corners.every((p) => p.x * p.x + p.y * p.y <= 1)) return path(rectPoints(rect));

  // Nearest point of the box to the center: outside the disc means the two
  // don't intersect at all
  const near = {
    x: Math.min(Math.max(0, box.minX), box.maxX),
    y: Math.min(Math.max(0, box.minY), box.maxY),
  };
  if (near.x * near.x + near.y * near.y > 1) return '';

  const step = arcStep(Math.max(rx, ry), tolerance);
  const centerInside =
    box.minX <= 0 && box.maxX >= 0 && box.minY <= 0 && box.maxY >= 0;
  // Center inside the box: every direction can show, so sample the whole
  // circle. Only ever a SMALL circle — a big one containing the center of the
  // box has the box inside it, handled above.
  // Center outside: the box is convex, so it spans less than half a turn as
  // seen from there. Sample that window only, and close the sector through
  // the center — sector ∩ box is the disc ∩ box, and the clip below cuts the
  // long radii away.
  let poly: Pt[];
  if (centerInside) {
    poly = sampleArc(0, 2 * Math.PI, step, false);
  } else {
    const [a0, a1] = coveringArc(corners.map((p) => Math.atan2(p.y, p.x)));
    // A sector wider than half a turn would be concave, and the clip below
    // only answers for convex ones — the slack that covers the tessellation's
    // sag at the window ends gives way to that.
    const slack = Math.max(0, Math.min(step, (Math.PI - (a1 - a0)) / 2));
    poly = [{ x: 0, y: 0 }, ...sampleArc(a0 - slack, a1 + slack, step, true)];
  }

  const clipped = clipToBox(poly, box);
  if (clipped.length < 3) return '';
  return path(clipped.map((p) => ({ x: cx + p.x * rx, y: cy + p.y * ry })));
}

/** Angle between two samples so the chord never sags more than `tolerance` px */
function arcStep(radiusPx: number, tolerance: number): number {
  const ratio = Math.min(1, Math.max(-1, 1 - tolerance / radiusPx));
  return Math.min(MAX_STEP, Math.max(1e-4, 2 * Math.acos(ratio)));
}

/** Smallest angular window covering every angle — the largest gap's complement */
function coveringArc(angles: number[]): [number, number] {
  const sorted = [...angles].sort((a, b) => a - b);
  let gap = -1;
  let at = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i === sorted.length - 1 ? sorted[0] + 2 * Math.PI : sorted[i + 1];
    if (next - sorted[i] > gap) {
      gap = next - sorted[i];
      at = i;
    }
  }
  const start = sorted[(at + 1) % sorted.length];
  const end = at === sorted.length - 1 ? sorted[at] : sorted[at] + 2 * Math.PI;
  return [start, end];
}

function sampleArc(a0: number, a1: number, step: number, includeEnd: boolean): Pt[] {
  const n = Math.min(MAX_POINTS, Math.max(1, Math.ceil((a1 - a0) / step)));
  const inc = (a1 - a0) / n;
  const last = includeEnd ? n : n - 1;
  const pts: Pt[] = [];
  for (let i = 0; i <= last; i++) {
    const a = a0 + i * inc;
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return pts;
}

/** Sutherland–Hodgman against the four edges — exact, both polygons convex */
function clipToBox(poly: Pt[], box: Rect): Pt[] {
  const inside = [
    (p: Pt) => p.x >= box.minX,
    (p: Pt) => p.x <= box.maxX,
    (p: Pt) => p.y >= box.minY,
    (p: Pt) => p.y <= box.maxY,
  ];
  const cut = [
    (a: Pt, b: Pt) => atX(a, b, box.minX),
    (a: Pt, b: Pt) => atX(a, b, box.maxX),
    (a: Pt, b: Pt) => atY(a, b, box.minY),
    (a: Pt, b: Pt) => atY(a, b, box.maxY),
  ];
  let out = poly;
  for (let e = 0; e < 4 && out.length; e++) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i];
      const prev = src[(i + src.length - 1) % src.length];
      const curIn = inside[e](cur);
      const prevIn = inside[e](prev);
      if (curIn !== prevIn) out.push(cut[e](prev, cur));
      if (curIn) out.push(cur);
    }
  }
  return out;
}

function atX(a: Pt, b: Pt, x: number): Pt {
  const t = (x - a.x) / (b.x - a.x);
  return { x, y: a.y + t * (b.y - a.y) };
}

function atY(a: Pt, b: Pt, y: number): Pt {
  const t = (y - a.y) / (b.y - a.y);
  return { x: a.x + t * (b.x - a.x), y };
}

function rectPoints(rect: Rect): Pt[] {
  return [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
}

/** Closed SVG polygon, coordinates rounded to a tenth of a pixel */
function path(points: Pt[]): string {
  let d = '';
  for (let i = 0; i < points.length; i++) {
    d += `${i === 0 ? 'M' : 'L'}${round(points[i].x)} ${round(points[i].y)}`;
  }
  return `${d}z`;
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
