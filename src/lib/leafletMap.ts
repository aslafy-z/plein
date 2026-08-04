// The map shell shared by the two Leaflet wrappers (MapCanvas, RouteMap).
//
// It owns the MECHANISM both need and used to duplicate: creating the map
// (no zoom control, attribution on, Leaflet's stepped keyboard off), the dark
// basemap, the smooth keyboard loop, the « the user took the view over » rule,
// the container ResizeObserver (invalidateSize + optional re-fit), and the
// inset-aware fitBounds / visible-center math — the floating panel covers the
// map's LEFT edge on desktop and the bottom sheet its BOTTOM edge on a phone,
// so every fit and every « center of what the user sees » must pad past them.
//
// POLICY stays with each caller: when to fit, on what bounds, what layers to
// draw, what a click means. A shell that owned the policy too is how one
// map's framing would start moving because the other one needed something.
import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import L from 'leaflet';
import { addDarkBasemap } from './tiles';
import { installSmoothKeyboard } from './mapKeyboard';

/** How long after a programmatic fit Leaflet's own move events stay ours */
const PROGRAMMATIC_MS = 700;

export interface LeafletShell {
  containerRef: RefObject<HTMLDivElement>;
  mapRef: MutableRefObject<L.Map | null>;
  /** true once the user panned/zoomed by hand — auto-fits must stand down */
  userInteractedRef: MutableRefObject<boolean>;
  /** Epoch ms until which move/zoom events are the app's own, not the user's */
  programmaticUntilRef: MutableRefObject<number>;
  /** Inset-aware fit — pads past the floating panel and the bottom sheet so
      the bounds land in the VISIBLE part of the map */
  fitBounds(bounds: L.LatLngBounds, opts?: { pad?: number; maxZoom?: number }): void;
  /** Center of the VISIBLE map — the stage minus the floating panel */
  visibleCenterPoint(map: L.Map): L.Point;
}

export interface LeafletShellOptions {
  /** Height of the bottom sheet covering the map's bottom edge (phone) */
  bottomInset?: number;
  /** Width of the floating panel covering the map's left edge (desktop) */
  leftInset?: number;
  /**
   * Runs once, right after the map exists: set the initial view, add layers
   * and listeners. The returned cleanup runs before the map is removed (the
   * map is still alive there — a caller can read its view out).
   */
  setup: (map: L.Map, shell: LeafletShell) => void | (() => void);
  /**
   * Bounds to keep framed when the CONTAINER resizes, while the user hasn't
   * taken the view over. Leaflet keeps the center on resize, not the framing:
   * a fit run at one size shrinks to a stamp at another. Omit to keep
   * Leaflet's center-keeping (the zone map re-frames from its own effect).
   */
  refitBounds?: () => L.LatLngBounds | null;
  /** Base padding of the resize re-fit (the caller's own fits pass theirs) */
  refitPad?: number;
  /** Called when a keyboard pan/zoom gesture begins (after takeover marking) */
  onKeyboardGesture?: () => void;
}

/**
 * One Leaflet init for the whole app. Returns stable refs — the map is
 * created once on mount and never re-created by a re-render; the options
 * are read through refs so the latest closures always apply.
 */
export function useLeafletMap(options: LeafletShellOptions): LeafletShell {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const userInteractedRef = useRef(false);
  const programmaticUntilRef = useRef(0);

  const bottomInsetRef = useRef(options.bottomInset ?? 0);
  bottomInsetRef.current = options.bottomInset ?? 0;
  const leftInsetRef = useRef(options.leftInset ?? 0);
  leftInsetRef.current = options.leftInset ?? 0;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const shellRef = useRef<LeafletShell | null>(null);
  if (!shellRef.current) {
    shellRef.current = {
      containerRef,
      mapRef,
      userInteractedRef,
      programmaticUntilRef,
      fitBounds(bounds, opts) {
        const map = mapRef.current;
        if (!map) return;
        const pad = opts?.pad ?? 26;
        // The fit's own move/zoom events must not read as a user takeover
        programmaticUntilRef.current = Date.now() + PROGRAMMATIC_MS;
        map.fitBounds(bounds, {
          paddingTopLeft: [pad + leftInsetRef.current, pad],
          paddingBottomRight: [pad, pad + bottomInsetRef.current],
          ...(opts?.maxZoom != null ? { maxZoom: opts.maxZoom } : null),
        });
      },
      visibleCenterPoint(map) {
        // Both insets count: the floating panel covers the LEFT edge on
        // desktop, the bottom sheet the BOTTOM edge on a phone. Ignoring the
        // sheet made every « center of what the user sees » land half a sheet
        // too low — the circle glide absorbed that gap on the first small pan
        // and the whole search zone drifted under the sheet.
        const size = map.getSize();
        return L.point(
          (size.x + leftInsetRef.current) / 2,
          (size.y - bottomInsetRef.current) / 2,
        );
      },
    };
  }
  const shell = shellRef.current;

  // ── Create the map once (StrictMode-safe: only if no map yet) ──────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      // Leaflet's stepped arrows/± give way to the smooth loop installed below
      keyboard: false,
      // The ResizeObserver below owns resizing. Leaflet's own window-resize
      // tracker would invalidateSize from its own rAF, BEFORE the observer
      // fires — a center-keeping pan outside the programmatic window the
      // observer opens, which the zone map's glide handler would read as a
      // user pan (see the observer for what that did to a shared link).
      trackResize: false,
    });
    addDarkBasemap(map);
    mapRef.current = map;

    // ── The takeover rule, one copy for both maps ─────────────────────────
    // Leaflet's zoomstart fires for programmatic fits too, so it only counts
    // outside the programmatic window. Everything else below can only ever
    // come from the user — the DOM events by nature, and dragstart because
    // Leaflet only fires it from a real pointer drag (programmatic pans fire
    // movestart, never dragstart) — so they mark the takeover directly AND
    // end the programmatic window: a drag begun right after a fit (the load /
    // geolocation moment) used to be swallowed by the window, leaving the
    // map moved but the app convinced it still owned the view — the next
    // auto-fit (the sheet resizing on a results change) yanked the pan back.
    const markInteract = () => {
      if (Date.now() > programmaticUntilRef.current) userInteractedRef.current = true;
    };
    const el = map.getContainer();
    const domInteract = () => {
      userInteractedRef.current = true;
      programmaticUntilRef.current = 0;
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) domInteract(); // pinch, not a tap
    };
    el.addEventListener('wheel', domInteract, { passive: true });
    el.addEventListener('dblclick', domInteract);
    el.addEventListener('touchstart', onTouchStart, { passive: true });

    // Arrows and +/- move the map on their own animation-frame loop (see
    // mapKeyboard): it drives the same move/moveend path as a drag, so
    // whatever follows the finger follows the keyboard too.
    const stopKeyboard = installSmoothKeyboard(map, {
      onGestureStart: () => {
        domInteract();
        optionsRef.current.onKeyboardGesture?.();
      },
    });

    // invalidateSize on every container resize; re-frame the caller's bounds
    // while the user hasn't taken over (Leaflet alone would keep the CENTER,
    // not the framing). A caller without refitBounds keeps center-keeping.
    const ro = new ResizeObserver(() => {
      // The center-keeping pan inside invalidateSize fires move/moveend like
      // any other, so it needs the programmatic window fitBounds opens: a map
      // opened on a shared link counts as user-owned from the first frame, and
      // without the window the zone map's glide handler read the resize pan
      // (the mobile URL bar collapsing right after load) as a user pan and
      // committed the visible-center offset into searchPos — the link's `ll`
      // walked north by half a sheet on every reload. Only an actual size
      // change opens it: the observe() callback at mount must not delay the
      // takeover rule for nothing.
      const el = map.getContainer();
      if (!map.getSize().equals(L.point(el.clientWidth, el.clientHeight))) {
        programmaticUntilRef.current = Date.now() + PROGRAMMATIC_MS;
      }
      map.invalidateSize();
      const box = optionsRef.current.refitBounds?.() ?? null;
      if (box && !userInteractedRef.current) {
        shell.fitBounds(box, { pad: optionsRef.current.refitPad });
      }
    });
    ro.observe(containerRef.current);

    const cleanup = optionsRef.current.setup(map, shell);

    // AFTER setup: the caller's initial setView fires a zoomstart of its own
    // (Leaflet's first _resetView), and hearing it here would mark the mount
    // itself as a user takeover — killing every auto-fit for good.
    map.on('dragstart', domInteract);
    map.on('zoomstart', markInteract);

    return () => {
      cleanup?.();
      ro.disconnect();
      stopKeyboard();
      el.removeEventListener('wheel', domInteract);
      el.removeEventListener('dblclick', domInteract);
      el.removeEventListener('touchstart', onTouchStart);
      map.remove();
      mapRef.current = null;
      // refs survive StrictMode remounts — the next mount starts untouched
      userInteractedRef.current = false;
      programmaticUntilRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return shell;
}
