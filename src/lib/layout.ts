// Where the app stops being a phone and becomes a desktop browser window.
//
// The same screens serve both: the breakpoint only decides how they are
// ARRANGED — bottom tab bar vs side navigation, a bottom sheet dragged over
// the map vs a panel docked beside it, a full-screen page vs a dialog.
//
// The gate is width, not pointer type. A window is resized all day long and
// the layout has to follow it; `(pointer: coarse)` never changes once the page
// is open, so a touch laptop or an iPad in landscape would be stuck with the
// phone arrangement on a 1300px canvas. Width also keeps the CSS and the TS
// on one number: `DESKTOP_QUERY` below is what styles.css matches on.
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';

/** Below this the phone arrangement applies, above it the desktop one */
export const DESKTOP_MIN_WIDTH = 960;
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

/**
 * Comfortable reading width for the text screens (Réglages, Favoris,
 * itinéraire, onboarding). They are single columns of prose and form rows:
 * full-bleed on a wide window would drag one sentence across the whole
 * screen, so they stay a centered column at every width above it.
 */
export const CONTENT_MAX_WIDTH = 760;

/**
 * Width of the panel floating over the map on desktop (the zone list, the
 * route timeline, the station fiche). The floor is what a station row needs
 * to lay its name, distance and price on ONE line — below it the name wraps
 * and the row stops being scannable, which is the whole point of the list.
 */
export const PANEL_WIDTH = 'clamp(350px, 30vw, 440px)';

/** Gap between a floating panel and the edges of the map stage it rides */
export const PANEL_GAP = 12;

/**
 * How much of the map's left edge the floating panel covers — the panel's
 * REAL width (PANEL_WIDTH is a clamp) plus its margins, measured with a
 * ResizeObserver. The map screen and the route screen both feed this to
 * their map as `leftInset` so auto-fits land in the VISIBLE part of the map.
 *
 * `active` is « the panel is on screen » (desktop, with something to show);
 * while false the inset is 0 and nothing observes. `remeasureKey` re-arms
 * the observer when the panel node itself is swapped by a remount (the map
 * screen keys its slot on the fiche).
 */
export function usePanelInset(
  active: boolean,
  remeasureKey?: unknown,
): { panelRef: RefObject<HTMLDivElement>; panelInset: number } {
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelInset, setPanelInset] = useState(0);
  useLayoutEffect(() => {
    if (!active) {
      setPanelInset(0);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const measure = () => setPanelInset(el.offsetWidth + PANEL_GAP * 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, remeasureKey]);
  return { panelRef, panelInset };
}

// One MediaQueryList per query: `getSnapshot` runs on every render, and
// re-creating the object there would allocate a listener target per frame.
const lists = new Map<string, MediaQueryList>();

function listFor(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  let mql = lists.get(query);
  if (!mql) {
    mql = window.matchMedia(query);
    lists.set(query, mql);
  }
  return mql;
}

/** Reactive `matchMedia` — re-renders the caller when the query flips */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = listFor(query);
      if (!mql) return () => {};
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const snapshot = useCallback(() => listFor(query)?.matches ?? false, [query]);
  // Third argument = the server/no-matchMedia snapshot. The phone
  // arrangement is the safe default: it works at any width, the desktop one
  // assumes room it may not have.
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** true when the window is wide enough for the desktop arrangement */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

/** What `visualViewport` reports: the part of the window actually on screen */
export interface VisualViewport {
  /** visible height in CSS pixels, 0 when the API is missing */
  height: number;
  /** how far the visible part has slid down the layout viewport */
  offsetTop: number;
}

const NO_VIEWPORT: VisualViewport = { height: 0, offsetTop: 0 };
let viewport = NO_VIEWPORT;

// One cached object: `useSyncExternalStore` calls this on every render and
// re-allocating it each time would loop forever on the identity check.
function readViewport(): VisualViewport {
  if (typeof window === 'undefined') return NO_VIEWPORT;
  const vv = window.visualViewport;
  if (!vv) return NO_VIEWPORT;
  if (viewport.height !== vv.height || viewport.offsetTop !== vv.offsetTop) {
    viewport = { height: vv.height, offsetTop: vv.offsetTop };
  }
  return viewport;
}

/**
 * The visible viewport, keyboard included.
 *
 * A phone keyboard does NOT shrink the layout viewport — Chrome's
 * `interactive-widget` defaults to `resizes-visual` — so a
 * `position: fixed; inset: 0` overlay keeps its full height and lays half its
 * content behind the keys. Anything that opens WITH a keyboard (the map's
 * place search) sizes itself on this instead, and `height: 0` means the API
 * is missing: fall back to `100dvh` rather than collapsing.
 */
export function useVisualViewport(): VisualViewport {
  const subscribe = useCallback((onChange: () => void) => {
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    if (!vv) return () => {};
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
    };
  }, []);
  return useSyncExternalStore(subscribe, readViewport, () => NO_VIEWPORT);
}
