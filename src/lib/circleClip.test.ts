import { describe, expect, it } from 'vitest';
import { CLIP_ABOVE_PX, clippedDiscPath, discNeedsClip, type Rect } from './circleClip';

const BOX: Rect = { minX: -2000, minY: -1200, maxX: 2000, maxY: 1200 };

interface Pt {
  x: number;
  y: number;
}

/** The `M…L…z` path back as points */
function points(d: string): Pt[] {
  if (!d) return [];
  return d
    .replace(/z$/, '')
    .split(/(?=[ML])/)
    .filter(Boolean)
    .map((seg) => {
      const [x, y] = seg.slice(1).split(' ').map(Number);
      return { x, y };
    });
}

function inPolygon(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      hit = !hit;
    }
  }
  return hit;
}

/** Does the polygon agree with « inside the disc AND inside the box » ? */
function agreesWithTruth(
  d: string,
  circle: { cx: number; cy: number; rx: number; ry: number },
  box: Rect,
  { skipNear = 2 }: { skipNear?: number } = {},
): number {
  const poly = points(d);
  let checked = 0;
  const { cx, cy, rx, ry } = circle;
  for (let i = 0; i <= 60; i++) {
    for (let j = 0; j <= 60; j++) {
      const p = {
        x: box.minX + ((box.maxX - box.minX) * i) / 60,
        y: box.minY + ((box.maxY - box.minY) * j) / 60,
      };
      // Points right on either boundary are the tessellation's own margin of
      // error — the test asks about everything else
      const u = (p.x - cx) / rx;
      const v = (p.y - cy) / ry;
      const dist = (Math.hypot(u, v) - 1) * Math.min(rx, ry);
      if (Math.abs(dist) < skipNear) continue;
      const onEdge =
        Math.min(p.x - box.minX, box.maxX - p.x, p.y - box.minY, box.maxY - p.y) < skipNear;
      if (onEdge) continue;
      checked++;
      expect(inPolygon(p, poly), `(${p.x},${p.y}) should be ${dist < 0 ? 'in' : 'out'}`).toBe(
        dist < 0,
      );
    }
  }
  return checked;
}

describe('discNeedsClip', () => {
  it('leaves a circle that fits the box to Leaflet', () => {
    expect(discNeedsClip(0, 0, 1500, 1500, BOX)).toBe(false);
  });

  it('leaves a small circle alone even when it overflows the box', () => {
    // A zone circle barely wider than the screen costs nothing to draw
    expect(discNeedsClip(0, 0, 3000, 3000, BOX)).toBe(false);
  });

  it('clips a circle past the size threshold that overflows the box', () => {
    expect(discNeedsClip(0, 0, CLIP_ABOVE_PX + 1, CLIP_ABOVE_PX + 1, BOX)).toBe(true);
  });

  it('leaves a huge circle alone while the box still contains it', () => {
    const wide: Rect = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };
    expect(discNeedsClip(0, 0, 120000, 120000, wide)).toBe(false);
  });
});

describe('clippedDiscPath', () => {
  it('draws the box itself when the view sits deep inside the circle', () => {
    // The zoomed-in case: a 25 km radius at zoom 19, edge kilometres away
    const d = clippedDiscPath(0, 0, 115000, 115000, BOX);
    expect(points(d)).toEqual([
      { x: -2000, y: -1200 },
      { x: 2000, y: -1200 },
      { x: 2000, y: 1200 },
      { x: -2000, y: 1200 },
    ]);
  });

  it('draws nothing when the circle misses the box', () => {
    expect(clippedDiscPath(400000, 0, 115000, 115000, BOX)).toBe('');
  });

  it('keeps every vertex inside the box', () => {
    const d = clippedDiscPath(-40000, 300, 41000, 41000, BOX);
    expect(points(d).length).toBeGreaterThan(3);
    for (const p of points(d)) {
      expect(p.x).toBeGreaterThanOrEqual(BOX.minX - 0.1);
      expect(p.x).toBeLessThanOrEqual(BOX.maxX + 0.1);
      expect(p.y).toBeGreaterThanOrEqual(BOX.minY - 0.1);
      expect(p.y).toBeLessThanOrEqual(BOX.maxY + 0.1);
    }
  });

  it('follows the true arc within a pixel where it crosses the view', () => {
    const cx = -113000;
    const cy = 900;
    const r = 115000;
    const d = clippedDiscPath(cx, cy, r, r, BOX);
    // Vertices that aren't sitting on a box edge are arc samples
    const arc = points(d).filter(
      (p) =>
        Math.min(p.x - BOX.minX, BOX.maxX - p.x, p.y - BOX.minY, BOX.maxY - p.y) > 1,
    );
    expect(arc.length).toBeGreaterThan(2);
    for (const p of arc) expect(Math.abs(Math.hypot(p.x - cx, p.y - cy) - r)).toBeLessThan(1);
  });

  it('covers exactly the disc ∩ box, wherever the edge falls', () => {
    for (const cx of [-116000, -114000, -100000, 0, 100000, 114000, 116000]) {
      const circle = { cx, cy: 400, rx: 115000, ry: 114800 };
      const d = clippedDiscPath(circle.cx, circle.cy, circle.rx, circle.ry, BOX);
      expect(agreesWithTruth(d, circle, BOX)).toBeGreaterThan(0);
    }
  });

  it('handles a circle whose center sits inside the box', () => {
    const circle = { cx: 100, cy: -50, rx: 9000, ry: 9000 };
    const d = clippedDiscPath(circle.cx, circle.cy, circle.rx, circle.ry, BOX);
    expect(agreesWithTruth(d, circle, BOX)).toBeGreaterThan(0);
  });

  it('stays a small path however big the circle gets', () => {
    const small = points(clippedDiscPath(-9000, 0, 9000, 9000, BOX)).length;
    const huge = points(clippedDiscPath(-1150000, 0, 1150000, 1150000, BOX)).length;
    expect(small).toBeLessThan(200);
    expect(huge).toBeLessThan(200);
  });

  it('follows the flattened ellipse Leaflet projects, not a round circle', () => {
    // Same center, radii 10% apart: the vertical edge must land on ry
    // A view sitting on the ellipse's top edge — at y = -20000 + ry
    const box: Rect = { minX: -2000, minY: 6000, maxX: 2000, maxY: 8000 };
    const d = clippedDiscPath(0, -20000, 30000, 27000, box);
    const arc = points(d).filter((p) => p.y > box.minY + 1 && p.y < box.maxY - 1);
    const top = arc.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a));
    // On the ellipse, where a round circle of rx would answer 10000
    expect(top.y).toBeCloseTo(7000, 0);
  });

  it('answers empty rather than throwing on a degenerate radius', () => {
    expect(clippedDiscPath(0, 0, 0, 0, BOX)).toBe('');
    expect(clippedDiscPath(0, 0, Number.NaN, 10, BOX)).toBe('');
  });
});
