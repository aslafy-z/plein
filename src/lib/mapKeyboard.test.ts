import { afterEach, describe, it, expect, vi } from 'vitest';
import type * as L from 'leaflet';
import {
  approach,
  heldKeyId,
  installSmoothKeyboard,
  panDirection,
  zoomDirection,
  wholePixels,
} from './mapKeyboard';

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

describe('heldKeyId', () => {
  it('names the physical key, whatever character Shift makes of it', () => {
    expect(heldKeyId({ code: 'Equal', key: '+' })).toBe(heldKeyId({ code: 'Equal', key: '=' }));
    expect(heldKeyId({ code: 'Minus', key: '_' })).toBe(heldKeyId({ code: 'Minus', key: '-' }));
  });

  it('tells the numpad key from the main-row one', () => {
    expect(heldKeyId({ code: 'NumpadAdd', key: '+' })).not.toBe(
      heldKeyId({ code: 'Equal', key: '+' }),
    );
  });

  it('falls back on the character when the keyboard reports no code', () => {
    expect(heldKeyId({ code: '', key: '+' })).toBe('+');
  });
});

describe('installSmoothKeyboard', () => {
  type Listener = (e: unknown) => void;

  /** The handler under node: a fake container, window, clock and frame loop */
  const mount = (startZoom: number) => {
    const onEl = new Map<string, Listener>();
    const onWindow = new Map<string, Listener>();
    let now = 1000;
    let pending: ((ts: number) => void) | null = null;
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: Listener) => onWindow.set(type, fn),
      removeEventListener: () => {},
    });
    vi.stubGlobal('requestAnimationFrame', (fn: (ts: number) => void) => {
      pending = fn;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      pending = null;
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    let zoom = startZoom;
    const setView = vi.fn((_center: unknown, z: number) => {
      zoom = z;
    });
    const map = {
      getContainer: () => ({
        tabIndex: 0,
        hasAttribute: () => true,
        addEventListener: (type: string, fn: Listener) => onEl.set(type, fn),
        removeEventListener: () => {},
      }),
      getZoom: () => zoom,
      getMinZoom: () => 0,
      getMaxZoom: () => 18,
      getCenter: () => ({ lat: 0, lng: 0 }),
      fire: () => {},
      setView,
      _move: (_center: unknown, z: number) => {
        zoom = z;
      },
    };
    installSmoothKeyboard(map as unknown as L.Map);

    const key = (type: 'keydown' | 'keyup', code: string, char: string, shiftKey: boolean) =>
      (type === 'keydown' ? onEl : onWindow).get(type)!({
        code,
        key: char,
        shiftKey,
        preventDefault: () => {},
      });
    /** Runs the loop for `seconds`; true when it settled on its own */
    const run = (seconds: number) => {
      for (let t = 0; t < seconds && pending; t += 0.016) {
        now += 16;
        const fn: (ts: number) => void = pending;
        pending = null;
        fn(now);
      }
      return pending == null;
    };
    return { key, run, setView };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stops zooming in when Shift is let go before the « + » key', () => {
    const { key, run, setView } = mount(10);
    key('keydown', 'Equal', '+', true);
    // Shift comes up first: the same physical key is now reported as « = »
    key('keyup', 'ShiftLeft', 'Shift', false);
    key('keyup', 'Equal', '=', false);
    expect(run(5)).toBe(true);
    expect(setView).toHaveBeenLastCalledWith(expect.anything(), 11, expect.anything());
  });

  it('stops zooming out when Shift is let go before the « _ » key', () => {
    const { key, run, setView } = mount(10);
    key('keydown', 'Minus', '_', true);
    key('keyup', 'ShiftLeft', 'Shift', false);
    key('keyup', 'Minus', '-', false);
    expect(run(5)).toBe(true);
    expect(setView).toHaveBeenLastCalledWith(expect.anything(), 9, expect.anything());
  });

  it('keeps zooming for as long as the key really is held', () => {
    const { key, run } = mount(10);
    key('keydown', 'Equal', '+', true);
    key('keyup', 'ShiftLeft', 'Shift', false);
    expect(run(1)).toBe(false);
  });
});
