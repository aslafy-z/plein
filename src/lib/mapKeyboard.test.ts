import { describe, it, expect } from 'vitest';
import { approach, panDirection, zoomDirection, wholePixels } from './mapKeyboard';

describe('approach', () => {
  it('closes the same fraction of the gap whatever the frame rate', () => {
    const tau = 0.1;
    // One 20 ms step must land where two 10 ms steps land: the ease can't run
    // faster on a 120 Hz screen than on a 60 Hz one
    const oneStep = approach(0, 100, tau, 0.02);
    const twoSteps = approach(approach(0, 100, tau, 0.01), 100, tau, 0.01);
    expect(oneStep).toBeCloseTo(twoSteps, 10);
  });

  it('moves towards the target without overshooting it', () => {
    const next = approach(0, 100, 0.1, 0.016);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(100);
    expect(approach(100, 0, 0.1, 0.016)).toBeGreaterThan(0);
  });

  it('reaches cruising speed within a second of holding a key', () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = approach(v, 820, 0.09, 0.016);
    expect(820 - v).toBeLessThan(0.5); // a ½ px/s short of 820: nothing on screen
  });
});

describe('panDirection', () => {
  it('maps each arrow onto its screen direction', () => {
    expect(panDirection(['ArrowRight'])).toEqual({ x: 1, y: 0 });
    expect(panDirection(['ArrowLeft'])).toEqual({ x: -1, y: 0 });
    expect(panDirection(['ArrowUp'])).toEqual({ x: 0, y: -1 });
    expect(panDirection(['ArrowDown'])).toEqual({ x: 0, y: 1 });
  });

  it('keeps a diagonal at the same speed as a straight line', () => {
    const d = panDirection(['ArrowRight', 'ArrowDown']);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 10);
    expect(d.x).toBeCloseTo(d.y, 10);
  });

  it('cancels opposite arrows and ignores anything else', () => {
    expect(panDirection(['ArrowLeft', 'ArrowRight'])).toEqual({ x: 0, y: 0 });
    expect(panDirection(['Shift', 'a'])).toEqual({ x: 0, y: 0 });
    expect(panDirection([])).toEqual({ x: 0, y: 0 });
  });
});

describe('zoomDirection', () => {
  it('reads the sign of the keys held', () => {
    expect(zoomDirection([1])).toBe(1);
    expect(zoomDirection([-1])).toBe(-1);
    expect(zoomDirection([])).toBe(0);
  });

  it('cancels + against -', () => {
    expect(zoomDirection([1, -1])).toBe(0);
  });
});

describe('wholePixels', () => {
  it('carries the sub-pixel remainder over to the next frame', () => {
    // Leaflet rounds the offsets it is given: without the carry, a pan slower
    // than one pixel per frame would never move at all
    let carry = 0;
    let moved = 0;
    for (let i = 0; i < 10; i++) {
      const step = wholePixels(0.4 + carry);
      carry = step.carry;
      moved += step.whole;
    }
    expect(moved).toBe(4);
  });

  it('splits both signs towards zero', () => {
    expect(wholePixels(3.7).whole).toBe(3);
    expect(wholePixels(-3.7).whole).toBe(-3);
    expect(wholePixels(-3.7).carry).toBeCloseTo(-0.7, 10);
  });
});
