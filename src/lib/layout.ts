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
import { useCallback, useSyncExternalStore } from 'react';

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
