// Smooth keyboard navigation for the Leaflet maps: the arrows glide the view
// and +/- zoom continuously, where Leaflet's own handler moves in hard steps.
// Types only: the pure helpers below are unit-tested under node, where merely
// importing Leaflet (it reads `window` at load) would throw.
import type * as L from 'leaflet';

/**
 * Leaflet's keyboard handler pans by one animated 80 px step per keypress and
 * IGNORES every key landing while that step animates (`Map.Keyboard`), so a
 * held arrow moves in lurches — pan, freeze, pan — and a held +/- barely zooms
 * at all: `setZoom` called during a zoom animation is dropped on the floor.
 *
 * This handler replaces it with a single animation-frame loop: the arrows
 * drive a velocity that ramps up and glides back to a stop, +/- ease the zoom
 * towards a moving target the way a pinch does, and the view lands on a whole
 * zoom level once the keys come back up.
 *
 * The loop speaks the same language as a drag or a pinch — `move` events while
 * it runs, `moveend`/`zoomend` once it settles — so everything listening on
 * the map (live search area, price pins, shared URL…) behaves exactly as it
 * does under the finger.
 */

/** Cruising speed of the arrows, in CSS pixels per second */
const PAN_SPEED = 820;
/** Shift is the « faster » modifier, for the pan as for the zoom */
const SHIFT_MUL = 2.5;
/** Time constant of the pan ramp-up (and of the glide to a stop), in seconds */
const PAN_TAU = 0.09;
/** No key held and slower than this (px/s): the glide is over */
const PAN_STOP = 12;
/** A tap on +/- is worth a whole level, however brief it is */
const ZOOM_STEP = 1;
/** Levels per second once the key is held past ZOOM_HOLD_DELAY */
const ZOOM_SPEED = 2.4;
/** A press shorter than this stays a one-level tap, seconds */
const ZOOM_HOLD_DELAY = 0.26;
/** Time constant of the zoom ease, in seconds */
const ZOOM_TAU = 0.1;
/** Distance to the target level under which the zoom counts as landed */
const ZOOM_EPS = 0.01;
/** Longest frame the loop integrates: a tab switch must not teleport the map */
const MAX_FRAME = 0.1;

const PAN_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const ZOOM_KEYS: Record<string, number> = {
  '+': 1,
  '=': 1,
  Add: 1,
  '-': -1,
  _: -1,
  Subtract: -1,
};

/**
 * Exponential approach: covers the same FRACTION of the remaining gap per unit
 * of time, whatever the frame rate — the ease can't run twice as fast on a
 * 120 Hz screen the way a per-frame ratio would.
 */
export function approach(current: number, target: number, tau: number, dt: number): number {
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Unit direction of the arrows held — a diagonal must not run √2 faster */
export function panDirection(held: Iterable<string>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const key of held) {
    const dir = PAN_KEYS[key];
    if (!dir) continue;
    x += dir[0];
    y += dir[1];
  }
  const len = Math.hypot(x, y);
  return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

/** Zoom direction of the keys held: opposite keys cancel each other out */
export function zoomDirection(held: Iterable<number>): number {
  let dir = 0;
  for (const d of held) dir += d;
  return Math.sign(dir);
}

/**
 * Whole pixels to move now and the sub-pixel remainder to carry to the next
 * frame. Leaflet rounds the offsets it is given, so a 0.4 px frame would
 * otherwise be dropped — and a slow pan would stand still.
 */
export function wholePixels(delta: number): { whole: number; carry: number } {
  const whole = Math.trunc(delta);
  return { whole, carry: delta - whole };
}

/**
 * The bits of the map a live gesture needs, all of them private to Leaflet —
 * its own drag and pinch handlers drive the map through exactly these. Guarded
 * calls: should a rename land in a future Leaflet, the fallbacks below give
 * back a stepped keyboard, never a crash.
 */
type InternalMap = L.Map & {
  /** Moves the map pane, silently — the drag's frame-by-frame move */
  _rawPanBy?(offset: { x: number; y: number }): void;
  /** Re-centers/zooms without touching the tiles — the pinch's live frame */
  _move?(
    center: L.LatLng,
    zoom: number,
    data?: { pinch?: boolean; round?: boolean },
    supressEvent?: boolean,
  ): void;
  /** `map.stop()` without its `setZoom` (which would fire a stray moveend) */
  _stop?(): void;
  /** true while a zoom animation owns the map — a live frame would fight it */
  _animatingZoom?: boolean;
};

export type SmoothKeyboardOptions = {
  /** Called when a keyboard gesture takes the map over (never for a fit/pan-to) */
  onGestureStart?: () => void;
};

/**
 * Installs the handler on `map` — which must be created with `keyboard: false`
 * so Leaflet's stepped one stays out of the way. Returns the teardown.
 */
export function installSmoothKeyboard(
  map: L.Map,
  options: SmoothKeyboardOptions = {},
): () => void {
  const el = map.getContainer();
  const internal = map as InternalMap;
  // `keyboard: false` also means Leaflet no longer makes the map focusable,
  // nor focuses it on a click — both are on us now.
  const hadTabIndex = el.hasAttribute('tabindex');
  if (el.tabIndex < 0) el.tabIndex = 0;

  const panHeld = new Set<string>();
  const zoomHeld = new Map<string, number>();
  let shiftHeld = false;
  const vel = { x: 0, y: 0 };
  const carry = { x: 0, y: 0 };
  /** true between the gesture's `movestart` and the `moveend` it owes */
  let moving = false;
  /** Level currently drawn — non-null only while the live zoom runs */
  let zoomShown: number | null = null;
  let zoomTarget = 0;
  /** Levels asked for before the live zoom could start (a zoom animation ran) */
  let zoomQueued = 0;
  /** Timestamp from which a held key starts pushing the target continuously */
  let zoomHoldFrom = 0;
  /** true once a fractional frame was drawn: the landing has nothing to animate */
  let zoomDrawn = false;
  let raf = 0;
  let lastTs = 0;

  const clampZoom = (z: number) => Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z));

  const addZoom = (delta: number) => {
    if (zoomShown == null) zoomQueued += delta;
    else zoomTarget = clampZoom(zoomTarget + delta);
  };

  /** Opens the live zoom on the level the map sits on, unless one is animating */
  const startLiveZoom = () => {
    if (internal._animatingZoom) return;
    zoomShown = map.getZoom();
    zoomTarget = clampZoom(zoomShown + zoomQueued);
    zoomQueued = 0;
    map.fire('zoomstart');
  };

  /** Frame-by-frame pan. Returns false when the fallback fired its own events. */
  const rawPan = (x: number, y: number) => {
    // Leaflet turns any `{x, y}` into a Point on the way in (`toPoint`), so the
    // offset needs no constructor — and this module no runtime Leaflet import.
    if (internal._rawPanBy) {
      internal._rawPanBy({ x, y });
      return true;
    }
    map.panBy([x, y], { animate: false, noMoveStart: true });
    return false;
  };

  /** Frame-by-frame zoom: tiles are scaled, not refetched, exactly like a pinch */
  const drawZoom = (zoom: number) => {
    if (!internal._move) return;
    internal._move(map.getCenter(), zoom, { pinch: true, round: false });
    zoomDrawn = true;
  };

  const settle = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    vel.x = vel.y = carry.x = carry.y = 0;
    const landing = zoomShown == null ? null : zoomTarget;
    const drawn = zoomDrawn;
    zoomShown = null;
    zoomQueued = 0;
    zoomDrawn = false;
    const wasMoving = moving;
    moving = false;
    if (landing != null) {
      // The ease already brought the view within a hundredth of a level of
      // `landing`: this only makes it official — pane origin back to zero,
      // sharp tiles, zoomend/moveend. It animates only when no live frame was
      // drawn (Leaflet internals gone), because then it IS the whole zoom.
      map.setView(map.getCenter(), landing, { animate: !drawn });
    } else if (wasMoving) {
      map.fire('moveend');
    }
  };

  const frame = (ts: number) => {
    const dt = Math.min((ts - lastTs) / 1000, MAX_FRAME);
    lastTs = ts;
    raf = requestAnimationFrame(frame);

    // ── Zoom: the held key keeps pushing the target, the view eases after it ──
    const zDir = zoomDirection(zoomHeld.values());
    if (zDir && ts >= zoomHoldFrom) {
      addZoom(zDir * ZOOM_SPEED * (shiftHeld ? SHIFT_MUL : 1) * dt);
    }
    if (zoomShown == null && (zoomQueued || zDir)) startLiveZoom();
    if (zoomShown != null) {
      // Keys up: aim at a whole level so the map never rests on a fraction
      if (!zDir) zoomTarget = clampZoom(Math.round(zoomTarget));
      zoomShown = approach(zoomShown, zoomTarget, ZOOM_TAU, dt);
    }

    // ── Pan: velocity ramps towards the arrows held, and glides back to zero ──
    const dir = panDirection(panHeld);
    const speed = PAN_SPEED * (shiftHeld ? SHIFT_MUL : 1);
    vel.x = approach(vel.x, dir.x * speed, PAN_TAU, dt);
    vel.y = approach(vel.y, dir.y * speed, PAN_TAU, dt);
    const stepX = wholePixels(vel.x * dt + carry.x);
    const stepY = wholePixels(vel.y * dt + carry.y);
    carry.x = stepX.carry;
    carry.y = stepY.carry;

    let silentPan = false;
    if (stepX.whole || stepY.whole) silentPan = rawPan(stepX.whole, stepY.whole);
    // The live zoom fires `move` itself — one event per frame, like a pinch
    if (zoomShown != null) drawZoom(zoomShown);
    else if (silentPan) map.fire('move');

    const panIdle =
      panHeld.size === 0 && Math.abs(vel.x) < PAN_STOP && Math.abs(vel.y) < PAN_STOP;
    const zoomIdle =
      zoomShown == null ? zoomQueued === 0 : !zDir && Math.abs(zoomTarget - zoomShown) < ZOOM_EPS;
    if (panIdle && zoomIdle) settle();
  };

  const tick = () => {
    if (raf) return;
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const pan = PAN_KEYS[e.key];
    const zoom = ZOOM_KEYS[e.key];
    if (!pan && zoom === undefined) return;
    e.preventDefault(); // the arrows must not scroll the page under the map
    shiftHeld = e.shiftKey;
    if (e.repeat) return; // the OS repeat tells nothing the held keys don't
    if (!moving) {
      moving = true;
      // A pan-to-station still running would fight the loop. `map.stop()` is
      // the public door but it re-applies `setZoom` on the way (stray moveend),
      // so take the one Leaflet's own gesture handlers take.
      internal._stop?.();
      options.onGestureStart?.();
      map.fire('movestart');
    }
    if (pan) {
      panHeld.add(e.key);
    } else {
      zoomHeld.set(e.key, zoom);
      zoomHoldFrom = performance.now() + ZOOM_HOLD_DELAY * 1000;
      addZoom(zoom * ZOOM_STEP);
    }
    tick();
  };

  // Key-ups on the window, not on the container: focus moving away mid-hold
  // (a click elsewhere, a shortcut) would otherwise leave the key stuck down.
  const onKeyUp = (e: KeyboardEvent) => {
    shiftHeld = e.shiftKey;
    panHeld.delete(e.key);
    zoomHeld.delete(e.key);
  };

  const releaseAll = () => {
    panHeld.clear();
    zoomHeld.clear();
    shiftHeld = false;
  };

  const onPointerDown = () => {
    if (el.contains(document.activeElement)) return;
    el.focus({ preventScroll: true });
  };

  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    el.removeEventListener('keydown', onKeyDown);
    el.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', releaseAll);
    if (!hadTabIndex) el.removeAttribute('tabindex');
  };
}
