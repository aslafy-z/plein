import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { C } from '../theme';
import { m } from '../paraglide/messages.js';
import { fmtPrice } from '../lib/format';
import { haversineKm, radiusBounds, type GeoPoint } from '../lib/geo';
import { useIsDesktop } from '../lib/layout';
import { useLeafletMap, type LeafletShell } from '../lib/leafletMap';
import { pricePinDotHtml, pricePinHtml } from '../lib/pricePin';
import ShareIcon from './ShareIcon';
import LocateIcon from './LocateIcon';
import {
  useApp,
  selectVisible,
  selectMapStations,
  selectRecommended,
  selectPriceStats,
  effectivePrice,
  priceTier,
  selectTripOriginKnown,
  type AppStore,
} from '../state/store';

/**
 * Dense areas: only the PIN_CAP cheapest stations wear a price bubble — the
 * ones inside the search circle first — the rest shrink to small dots (still
 * tappable) so the map stays readable. The selected station always keeps its
 * full pin, wherever it ranks.
 */
const PIN_CAP = 15;

/** Min pause between two live search-area updates while the circle drags */
const LIVE_SEARCH_MS = 250;
/** Live drifts smaller than this (km) don't change the results — skip them */
const LIVE_SEARCH_MIN_KM = 0.1;
/**
 * How fast the circle↔center gap left over when a pan begins is absorbed,
 * as a FRACTION OF THE PAN DISTANCE — the circle recenters at 35% of the
 * finger's speed, never faster. A per-frame decay here (the previous 0.8×
 * per move event) absorbed the whole gap in a fraction of a second whatever
 * the finger did: near a results boundary — one station on the circle's
 * edge — the sheet swap (card ⇄ empty) moved the gesture center, the circle
 * shot toward it faster than the pan, re-crossed the boundary, and the
 * whole thing self-accelerated.
 */
const OFFSET_ABSORB_RATE = 0.35;
/**
 * Extra per-frame decay of the gap, for a gesture that BEGINS with the
 * circle's center outside the viewport. Hopping through station pins (every
 * tap pans the map onto its station) can leave the zone a viewport or more
 * behind, and at 35% of the pan the way back would cost ~3× that distance
 * in dragging. The finger-speed cap protects an ON-screen circle from
 * outrunning the gesture near a results boundary; a circle that starts the
 * gesture off screen has no boundary to oscillate across, so its gap also
 * decays 15% per move frame — the circle sweeps back over roughly half a
 * second of panning whatever the distance, then settles under the cap.
 */
const OFFSET_FAR_DECAY = 0.15;

/**
 * Leaflet sizes the SVG holding the vector layers to the viewport (+10%) and
 * only re-clips it on `moveend`. Ordinary paths don't care — they keep their
 * layer coordinates while the pane slides under the finger — but the search
 * circle glides with the screen center, so mid-drag it walks out of that
 * frozen box and gets sliced by its edges: a straight cut across the zone,
 * the circle seemingly unable to leave an invisible rectangle. Re-running the
 * renderer's own clip pass on every move frame keeps the box on the live
 * view. `_update()` is Leaflet's internal `moveend` handler (v1.9) — optional
 * call so a rename would only bring the old clipping back, never a crash.
 */
function reclipRenderer(map: L.Map, layer: L.Path) {
  const renderer = map.getRenderer(layer) as L.Renderer & { _update?: () => void };
  renderer._update?.();
}

/**
 * View kept across unmounts. Opening a station detail (or another tab)
 * unmounts the whole map; without this, coming back rebuilt it on the
 * default zoom + auto-fit and threw away the user's pan/zoom. Only
 * restored while the search area is unchanged — searching elsewhere
 * meanwhile means the old view no longer shows the right zone.
 */
let savedView: {
  center: L.LatLng;
  zoom: number;
  userInteracted: boolean;
  searchPos: GeoPoint;
} | null = null;

/**
 * Stations wearing a price bubble: the PIN_CAP cheapest of the EFFECTIVE
 * zone — the search circle intersected with the current view. When the
 * circle fits the screen that is simply the circle; when it overflows the
 * screen (zoomed in), the visible part of it becomes the zone, so the
 * prices follow what the user is looking at. On-screen stations outside
 * the circle, then off-screen ones, only get the leftover bubbles when
 * the effective zone is sparse.
 */
function pricedIds(app: AppStore, bounds: L.LatLngBounds | null): Set<string> {
  const zoneIds = new Set(selectVisible(app).map((s) => s.id));
  const pins = selectMapStations(app);
  const rank = new Map(
    pins.map((s) => {
      const inView = bounds == null || bounds.contains([s.lat, s.lng]);
      return [s.id, inView ? (zoneIds.has(s.id) ? 2 : 1) : 0];
    }),
  );
  return new Set(
    [...pins]
      .sort(
        (a, b) =>
          rank.get(b.id)! - rank.get(a.id)! ||
          effectivePrice(a, app.fuel)!.value - effectivePrice(b, app.fuel)!.value,
      )
      .slice(0, PIN_CAP)
      .map((s) => s.id),
  );
}

/**
 * The map always keeps the FULL stage size — the bottom sheet overlays it.
 * Resizing Leaflet whenever the sheet grew or shrank moved the viewport
 * center (and therefore the search circle) under the user, and near a
 * results boundary the sheet⇄circle coupling even self-oscillated. Only
 * the controls riding the bottom edge slide up with `bottomInset`.
 * `leftInset` is the desktop mirror of it: the floating panel covers the
 * map's left edge, so auto-fits pad on that side instead of the bottom.
 */
export default function MapCanvas({
  bottomInset = 0,
  leftInset = 0,
}: {
  bottomInset?: number;
  leftInset?: number;
}) {
  const app = useApp();
  const desktop = useIsDesktop();
  // The pan-to-station math reads the panel inset at run time
  const leftInsetRef = useRef(leftInset);
  leftInsetRef.current = leftInset;

  const layerRef = useRef<L.LayerGroup | null>(null);
  /** true right after the saved view was restored — skip the mount-run pan-to-station */
  const restoredViewRef = useRef(false);
  /** Skip the next auto-fit: the search area moved because the USER moved the map */
  const keepViewRef = useRef(false);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // moveend closures read the latest app state through this ref
  const appRef = useRef(app);
  appRef.current = app;
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;

  // Pins and chip re-rank against the view after a pan/zoom. Guarded on the
  // actual bounds so a programmatic re-fit to the same view can't loop.
  const [viewTick, setViewTick] = useState(0);
  const lastBoundsRef = useRef('');

  const circleRef = useRef<L.Circle | null>(null);
  /** Pixel gap between the drawn circle and the viewport center when a pan
      begins (auto-fit never centers on searchPos), absorbed over the pan */
  const circleOffsetRef = useRef({ x: 0, y: 0 });
  const userDotRef = useRef<L.Marker | null>(null);
  const originLineRef = useRef<L.Polyline | null>(null);
  const reticleRef = useRef<L.Marker | null>(null);
  /** Glue the center attachments (link line's zone end, center reticle) to
      the DRAWN circle: mid-gesture the glide handler owns the circle's
      position and the throttled searchPos trails it — anything aimed at
      searchPos would visibly lag the drag. Called wherever the circle's
      latlng is set outside its own effect. */
  const syncCircleAttachments = () => {
    const circle = circleRef.current;
    if (!circle) return;
    const c = circle.getLatLng();
    const line = originLineRef.current;
    if (line) {
      const pts = line.getLatLngs() as L.LatLng[];
      line.setLatLngs([pts[0], c]);
    }
    reticleRef.current?.setLatLng(c);
  };
  const markersRef = useRef(new Map<string, { marker: L.Marker; sig: string }>());
  /** Set by setup — the keyboard gesture start needs it through the shell */
  const measureCircleOffsetRef = useRef<(() => void) | null>(null);

  // ── The shared shell creates the map; setup below adds this map's own
  // layers, view restore and gesture handlers (StrictMode-safe in the shell)
  const setup = (map: L.Map, sh: LeafletShell) => {
    const saved =
      savedView &&
      savedView.searchPos.lat === app.searchPos.lat &&
      savedView.searchPos.lng === app.searchPos.lng
        ? savedView
        : null;
    if (saved) {
      // Back from the detail (or another tab): put the user's view back
      // exactly where they left it, auto-fit stays off if they had panned
      map.setView(saved.center, saved.zoom, { animate: false });
      sh.userInteractedRef.current = saved.userInteracted;
      restoredViewRef.current = true;
    } else if (savedView == null && app.mapZoom != null) {
      // First mount of the session with a zoom already known = the app was
      // opened on a shared link. Its framing is the point of the link, so
      // auto-fit must not re-frame the zone over it.
      map.setView([app.searchPos.lat, app.searchPos.lng], app.mapZoom, { animate: false });
      sh.userInteractedRef.current = true;
    } else {
      map.setView([app.searchPos.lat, app.searchPos.lng], 13);
    }

    layerRef.current = L.layerGroup().addTo(map);

    // The glide below keeps the circle on the viewport center, but when a
    // pan BEGINS the circle usually isn't there: the load auto-fit centers
    // the view on the zone bounds, not on searchPos (same after a
    // pan-to-station). Snapping it onto the center at the first move event
    // was a visible jump — measure the gap here and absorb it gradually.
    // The keyboard loop begins its gestures the same way (shell option).
    //
    // The center is CAPTURED per gesture, not read per frame: the visible
    // center depends on the sheet height, and the live search resizes the
    // sheet mid-pan whenever the zone crosses a results boundary (list ⇄
    // empty block). A per-frame read made the glide target — and the circle —
    // jump with every resize, and the circle↔results coupling could
    // oscillate. The next gesture re-measures both, and the offset decay
    // absorbs whatever the sheet did in between.
    let gestureMid: L.Point | null = null;
    /** The gesture began with the circle's center off screen (pin-hopping
        panned the map away from the zone) — see OFFSET_FAR_DECAY */
    let farGesture = false;
    /** Projected map center at the last glide frame — its per-frame delta is
        the pan distance the offset absorption is proportional to */
    let lastPanPt: L.Point | null = null;
    let lastPanZoom = 0;
    const measureCircleOffset = () => {
      if (!circleRef.current) return;
      const p = map.latLngToContainerPoint(circleRef.current.getLatLng());
      const mid = sh.visibleCenterPoint(map);
      gestureMid = mid;
      circleOffsetRef.current = { x: p.x - mid.x, y: p.y - mid.y };
      // Judged once per gesture: a gap that STARTS on screen keeps the pure
      // finger-speed absorption below, however large it is
      const size = map.getSize();
      farGesture = p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y;
      lastPanZoom = map.getZoom();
      lastPanPt = map.project(map.getCenter(), lastPanZoom);
    };
    measureCircleOffsetRef.current = measureCircleOffset;
    map.on('dragstart', measureCircleOffset);

    const el = map.getContainer();
    // The zoom the map has LANDED on, mirrored onto the container. Nothing in
    // the DOM says it otherwise: Leaflet keeps the outgoing level's tiles for
    // the length of a zoom animation, and when zooming out that stale level is
    // the higher of the two — reading the tiles reports a level the map is not
    // on. The attribute is dropped while an animation runs, so a reader waits
    // for the map to land instead of catching it mid-flight. `moveend` covers
    // the non-animated `setView`, which fires no zoom event at all.
    const publishZoom = () => el.setAttribute('data-zoom', String(map.getZoom()));
    map.on('zoomstart', () => el.removeAttribute('data-zoom'));
    map.on('moveend zoomend', publishZoom);
    publishZoom();

    map.on('moveend zoomend', () => {
      // The shareable URL carries the zoom — the center comes from searchPos,
      // which the pan handlers below keep in sync
      appRef.current.setMapZoom(map.getZoom());
      const key = map.getBounds().toBBoxString();
      if (key !== lastBoundsRef.current) {
        lastBoundsRef.current = key;
        setViewTick((t) => t + 1);
      }
    });

    // While the USER pans, the zone circle glides with the screen center —
    // no more jumpy circle waiting for the debounce. Never during a zoom
    // (pinch included): reprojecting the circle mid-animation fights the CSS
    // scale transform and draws it at the wrong size until release.
    let zooming = false;
    map.on('zoomstart', () => {
      zooming = true;
    });
    map.on('zoomend', () => {
      zooming = false;
      if (sh.userInteractedRef.current) {
        // Re-capture the gesture center too: a pinch can flow into a drag
        // without a dragstart, and the glide must aim at the point the
        // circle was just snapped onto
        const mid = sh.visibleCenterPoint(map);
        gestureMid = mid;
        farGesture = false;
        circleOffsetRef.current = { x: 0, y: 0 };
        circleRef.current?.setLatLng(map.containerPointToLatLng(mid));
        syncCircleAttachments();
      }
    });
    // Results follow the circle LIVE while the finger drags (throttled):
    // the bottom card, the list and the chips update during the pan, not
    // only once the map settles. In-zone moves cost nothing — the store
    // skips loading when the area already in memory covers the new zone.
    let lastLiveSearch = 0;
    map.on('move', () => {
      // Re-clip on EVERY pan frame, before any early return: even when the
      // circle stands still (programmatic pan, auto-fit) the frozen box
      // drifts with the map and drags its edges — and the cut they make in a
      // circle wider than the screen — into view. NEVER during a live zoom
      // (pinch, keyboard +/-), which also fires `move` per frame: `_update()`
      // re-stamps the reference center/zoom the renderer computes its CSS
      // scale against WITHOUT reprojecting the paths, so the circle freezes
      // at its pre-zoom size until release instead of scaling under the
      // gesture. The animated zooms (wheel, double-tap) are immune — Leaflet
      // guards `_update` on `_animatingZoom` — but a live gesture is not.
      if (circleRef.current && !zooming) reclipRenderer(map, circleRef.current);
      if (!sh.userInteractedRef.current || zooming) return;
      if (Date.now() < sh.programmaticUntilRef.current) return; // pan-to-station, fits…
      // Absorb the gap left at dragstart in proportion to the pan itself —
      // this frame's map movement in container px (never during a zoom: the
      // zooming guard above skips those frames, and a zoom change resets the
      // baseline below instead of measuring across projection scales).
      const z = map.getZoom();
      const panPt = map.project(map.getCenter(), z);
      const step = lastPanPt && lastPanZoom === z ? panPt.distanceTo(lastPanPt) : 0;
      lastPanPt = panPt;
      lastPanZoom = z;
      const off = circleOffsetRef.current;
      const len = Math.hypot(off.x, off.y);
      if (len > 0) {
        const rate = step * OFFSET_ABSORB_RATE + (farGesture ? len * OFFSET_FAR_DECAY : 0);
        const absorb = Math.min(len, rate);
        off.x -= (off.x / len) * absorb;
        off.y -= (off.y / len) * absorb;
        if (Math.hypot(off.x, off.y) < 0.5) {
          off.x = 0;
          off.y = 0;
        }
      }
      const mid = gestureMid ?? sh.visibleCenterPoint(map);
      const c = map.containerPointToLatLng(L.point(mid.x + off.x, mid.y + off.y));
      circleRef.current?.setLatLng(c);
      syncCircleAttachments();
      const now = Date.now();
      if (now - lastLiveSearch < LIVE_SEARCH_MS) return;
      const cur = appRef.current;
      // A fetch is already running for a previous live position — let it land.
      // Background revalidations count too: re-firing setSearchArea would bump
      // the generation counter and discard them, so a long drag over a cached
      // area would keep burning full fetches without ever committing one. The
      // moveend settle pass closes the residual drift once the drag ends.
      if (cur.stations.status === 'loading' || cur.stations.refreshing) return;
      if (haversineKm({ lat: c.lat, lng: c.lng }, cur.searchPos) < LIVE_SEARCH_MIN_KM) return;
      lastLiveSearch = now;
      keepViewRef.current = true; // live tracking must never re-trigger auto-fit
      cur.setSearchArea({ lat: c.lat, lng: c.lng });
    });

    // Moving the map away loads the stations of the new area automatically
    // (debounced; only for user-initiated moves, never programmatic fits)
    map.on('moveend', () => {
      if (!sh.userInteractedRef.current) return;
      if (Date.now() < sh.programmaticUntilRef.current) return;
      // Sync on the DRAWN circle — it may still carry a start-of-pan offset
      const c = circleRef.current?.getLatLng() ?? map.getCenter();
      const cur = appRef.current;
      const drift = haversineKm({ lat: c.lat, lng: c.lng }, cur.searchPos);
      // Live tracking leaves at most a throttle-tick of lag — this settle
      // pass closes it so the circle and the results match exactly
      if (drift <= 0.05) return;
      clearTimeout(moveTimer.current);
      moveTimer.current = setTimeout(() => {
        keepViewRef.current = true; // don't yank the map back after reload
        appRef.current.setSearchArea({ lat: c.lat, lng: c.lng });
      }, 350);
    });

    // No refitBounds handed to the shell: the container only resizes with
    // the window/stage itself (never with the bottom sheet), and Leaflet's
    // default center-keeping is right there — the zone re-frames from its
    // own auto-fit effect below.

    return () => {
      clearTimeout(moveTimer.current);
      savedView = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        userInteracted: sh.userInteractedRef.current,
        searchPos: appRef.current.searchPos,
      };
      layerRef.current = null;
      // refs survive StrictMode remounts — drop everything tied to the dead map
      markersRef.current.clear();
      circleRef.current = null;
      circleOffsetRef.current = { x: 0, y: 0 };
      userDotRef.current = null;
      originLineRef.current = null;
      reticleRef.current = null;
    };
  };

  const shell = useLeafletMap({
    bottomInset,
    leftInset,
    setup,
    onKeyboardGesture: () => measureCircleOffsetRef.current?.(),
  });
  const { containerRef, mapRef, userInteractedRef, programmaticUntilRef } = shell;

  // ── Desktop: the arrows drive the map from wherever focus sits ─────────────
  // Clicking a row or a chip moves the focus there, and the map's keyboard
  // loop only hears keys while its container holds it — so a pan-by-arrows
  // died after every click. Route the arrows back: unless the user is typing
  // or a dialog is up, an arrow press re-focuses the map (the press itself
  // warms up, holding and the next presses pan).
  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.key.startsWith('Arrow')) return;
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
        if (el.closest('[role="dialog"]')) return;
      }
      const mapEl = mapRef.current?.getContainer();
      if (mapEl && el !== mapEl) mapEl.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [desktop]);

  // ── Reset auto-fit when the frame of reference changes ──────────────────────
  const lastFrameRef = useRef({ searchPos: app.searchPos, radius: app.radius });
  useEffect(() => {
    const last = lastFrameRef.current;
    lastFrameRef.current = { searchPos: app.searchPos, radius: app.radius };
    // Mount run (nothing changed): a restored view must keep its
    // « user interacted » flag — only real frame changes re-arm the auto-fit
    if (last.searchPos === app.searchPos && last.radius === app.radius) return;
    if (keepViewRef.current) {
      keepViewRef.current = false;
      return;
    }
    userInteractedRef.current = false;
  }, [app.searchPos, app.radius]);

  // ── Search-zone circle + user dot (own layers, no flicker on data reloads) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!circleRef.current) {
      circleRef.current = L.circle([app.searchPos.lat, app.searchPos.lng], {
        radius: app.radius * 1000,
        // Colors come from the .zone-circle rule in styles.css — Leaflet
        // writes color options as SVG attributes, where a var() can't resolve
        className: 'zone-circle',
        weight: 1,
        opacity: 0.35,
        fillOpacity: 0.04,
        interactive: false,
      }).addTo(map);
    } else {
      // Mid-gesture the glide handler owns the position — snapping back to
      // the (throttled) searchPos would rubber-band the circle backwards
      if (!userInteractedRef.current) {
        circleOffsetRef.current = { x: 0, y: 0 };
        circleRef.current.setLatLng([app.searchPos.lat, app.searchPos.lng]);
        syncCircleAttachments();
      }
      circleRef.current.setRadius(app.radius * 1000);
    }
  }, [app.searchPos, app.radius]);

  // The circle's stroke carries the trip-origin state: solid when the trip
  // figures on screen start from the user, dashed when they don't (area out
  // of reach, or no position ever known) — the map-level echo of the hidden
  // distances and the greyed « Distance » chip. Runs after the effect above,
  // so the circle exists on the render that creates it.
  const tripOrigin = selectTripOriginKnown(app);
  useEffect(() => {
    circleRef.current?.setStyle({ dashArray: tripOrigin ? undefined : '5 9' });
  }, [tripOrigin, app.searchPos, app.radius]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!userDotRef.current) {
      const userHtml =
        `<div style="width:34px;height:34px;border-radius:50%;background:${C.accentSoft15};` +
        `display:flex;align-items:center;justify-content:center">` +
        `<div style="width:14px;height:14px;border-radius:50%;background:${C.accent};` +
        `border:3px solid ${C.accentDeep};box-sizing:border-box"></div></div>`;
      userDotRef.current = L.marker([app.userPos.lat, app.userPos.lng], {
        icon: L.divIcon({ className: '', html: userHtml, iconSize: [34, 34], iconAnchor: [17, 17] }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
    } else {
      userDotRef.current.setLatLng([app.userPos.lat, app.userPos.lng]);
    }
  }, [app.userPos]);

  // ── User → zone link for a zone searched away WITHIN reach ──────────────────
  // A sparse, muted dashed segment from the user's position to the circle,
  // when the circle sits away from a KNOWN position that is still within
  // reach: both ends on screen, it reads « the zone hangs off you, there ».
  // Out of reach it is not drawn — only an off-screen stub would show, and
  // the dashed circle already carries that state; without a known position
  // there is no origin to link from at all. The zone end follows the DRAWN
  // circle (see syncCircleAttachments), so the line never trails a drag.
  // Deliberately styled nothing like the route polyline — this must never
  // read as an itinerary.
  const linkWanted = app.searchedAway && tripOrigin;
  // The recenter control stays lit while the view is still tied to the
  // user's position: on it, or away with the origin link drawn. Only the
  // center dot is reserved for « the view IS on the user ». Plain ink means
  // the tie is gone — zone out of reach, or no position ever known.
  const locateActive = !app.searchedAway || linkWanted;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!linkWanted) {
      originLineRef.current?.remove();
      originLineRef.current = null;
      return;
    }
    const zoneEnd =
      circleRef.current?.getLatLng() ?? L.latLng(app.searchPos.lat, app.searchPos.lng);
    const pts = [L.latLng(app.userPos.lat, app.userPos.lng), zoneEnd];
    if (!originLineRef.current) {
      originLineRef.current = L.polyline(pts, {
        // Color from the .origin-line rule in styles.css — Leaflet writes
        // color options as SVG attributes, where a var() can't resolve
        className: 'origin-line',
        weight: 1.5,
        opacity: 0.45,
        dashArray: '2 10',
        interactive: false,
      }).addTo(map);
    } else {
      originLineRef.current.setLatLngs(pts);
    }
  }, [linkWanted, app.userPos, app.searchPos]);

  // ── Center reticle — a fine fixed-size crosshair on the zone center ─────────
  // Marks what the circle is centered on without competing with the pins:
  // two hairlines, no fill, nothing a station pin or the user dot could be
  // confused with. Permanent — when the zone follows the user it sits under
  // the user dot and disappears into it. Glued to the DRAWN circle during
  // gestures via syncCircleAttachments, exactly like the link line.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pos =
      circleRef.current?.getLatLng() ?? L.latLng(app.searchPos.lat, app.searchPos.lng);
    if (!reticleRef.current) {
      const bar = (r: string) =>
        `<div style="position:absolute;${r};background:${C.accentGlow55};border-radius:1px"></div>`;
      const html =
        `<div style="position:relative;width:14px;height:14px">` +
        bar('left:6.25px;top:0;width:1.5px;height:14px') +
        bar('left:0;top:6.25px;width:14px;height:1.5px') +
        `</div>`;
      reticleRef.current = L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({ className: '', html, iconSize: [14, 14], iconAnchor: [7, 7] }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
    } else {
      reticleRef.current.setLatLng(pos);
    }
  }, [app.searchPos]);

  // ── Station pins: keyed diff so panning/refreshes never blink the markers ──
  // The map shows every loaded station passing the filters (the whole fetched
  // area), not just the radius circle — pins no longer pop in/out on pan.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const pins = selectMapStations(app);
    // The emphasized pin mirrors the sheet card: best effective price
    // (round-trip fuel counted), not always the lowest sticker price
    const reco = selectRecommended(app);
    // Pin & dot colors follow the price tiers of the whole loaded area —
    // the very stations drawn here — so the scale can't flip with the
    // circle: « bons plans » in green (SEVERAL stations at near-identical
    // low prices all stand out, not just the single cheapest), the
    // priciest tier tinted orange. In-zone stations also get the zone
    // floor: the circle's cheapest stays green like its card in the sheet.
    const stats = selectPriceStats(app);
    const markers = markersRef.current;
    const wanted = new Set<string>();

    // map.getBounds() is unusable before the first view is set — rank
    // without the view filter on that very first pass
    const priced = pricedIds(app, lastBoundsRef.current ? map.getBounds() : null);

    for (const s of pins) {
      const best = reco?.id === s.id;
      const focused = app.focusStationId === s.id;
      const dot = !priced.has(s.id) && !focused;
      const price = effectivePrice(s, app.fuel)!.value;
      const tier = priceTier(price, stats, s.searchKm <= app.radius);
      // The recommended pin wears the deal green whatever its tier — it must
      // agree with its green sheet card
      const deal = tier === 'deal' || best;
      const sig = `${price}|${tier}|${best}|${focused}|${dot}`;
      wanted.add(s.id);
      const existing = markers.get(s.id);
      if (existing && existing.sig === sig) continue;

      // One pin markup for both maps — lib/pricePin. The dot tier folds the
      // deal flag in so the recommended pin stays green whatever its tier.
      const html = dot
        ? pricePinDotHtml(deal ? 'deal' : tier)
        : pricePinHtml(fmtPrice(price), {
            tier: deal ? 'deal' : tier,
            recommended: best,
            focused,
          });
      const icon = L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] });
      // Deals float above their tier-mates (green dots above gray dots, green
      // bubbles above the rest) without ever crossing the dot/bubble divide
      const z = focused ? 2000 : best ? 1000 : dot ? (deal ? -200 : -400) : deal ? 500 : 0;

      if (existing) {
        existing.marker.setIcon(icon);
        existing.marker.setZIndexOffset(z);
        existing.sig = sig;
      } else {
        const marker = L.marker([s.lat, s.lng], { zIndexOffset: z, icon });
        // Tapping a pin selects the station in the bottom-sheet card
        // (the full detail opens from there) — Google-Maps-like flow.
        // With a fiche already open (desktop stacks it under the list), the
        // tap swaps the fiche to that station instead: the reader is in
        // detail mode, a pin that only re-pointed a hidden card read as dead.
        marker.on('click', () => {
          const cur = appRef.current;
          if (desktopRef.current && cur.screen === 'detail') cur.openStation(s.id);
          else cur.setFocusStation(s.id);
        });
        marker.addTo(layer);
        markers.set(s.id, { marker, sig });
      }
    }

    for (const [id, entry] of markers) {
      if (!wanted.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }

    // roadReach/consumption/tank feed selectRecommended (effective price over the
    // road distance): the matrix lands a few hundred ms AFTER the stations, so
    // without them the emphasized pin kept the crow-flies pick while the sheet
    // card — a plain render — already showed the road-aware one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.stations.data, app.fuel, app.radius, app.brandSel, app.serviceTags, app.userPos, app.searchPos, app.focusStationId, app.roadReach, app.consumption, app.tank, viewTick]);

  // ── Auto-fit on the SEARCH CIRCLE itself until the user takes over — and
  // never while a station is selected (don't yank the view). Framing the
  // circle rather than the stations inside it makes the zoom answer « how far
  // am I looking? »: searching a place now lands on the radius the user asked
  // for, where fitting the stations zoomed straight past it whenever they
  // clustered near the center, and an empty zone fell back to a fixed level
  // whatever the radius said.
  // Own effect WITHOUT the view tick: re-fitting after every pan/zoom would
  // fight the user's gesture (and revert it whenever it lands inside the
  // post-fit programmatic window). The circle depends on nothing but the
  // search area, so the station data landing (or the filters moving) no
  // longer re-frames anything either.
  useEffect(() => {
    if (!mapRef.current) return;
    if (userInteractedRef.current || app.focusStationId) return;
    const box = radiusBounds(app.searchPos, app.radius);
    // The sheet overlays the map bottom, the desktop panel its left edge —
    // the shell's fit pads past both so the zone lands in the VISIBLE part
    shell.fitBounds(L.latLngBounds([box.south, box.west], [box.north, box.east]), {
      pad: 40,
      maxZoom: 15,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.searchPos, app.radius, app.focusStationId, bottomInset, leftInset]);

  // ── Selecting a station (pin tap or sheet-list tap) pans the map onto it ──
  useEffect(() => {
    // Mount run after a restore: the saved view already frames what the user
    // was looking at when the detail opened — don't recenter on the station
    const wasRestore = restoredViewRef.current;
    restoredViewRef.current = false;
    const map = mapRef.current;
    if (!map || !app.focusStationId || wasRestore) return;
    const s = selectMapStations(app).find((x) => x.id === app.focusStationId);
    if (!s) return;
    programmaticUntilRef.current = Date.now() + 1200; // no auto-search, no circle glide
    // Land the station on the VISIBLE center — panTo would center it on the
    // stage, half a panel to the left of where the user is looking
    const z = map.getZoom();
    const pt = map.project([s.lat, s.lng], z).subtract(L.point(leftInsetRef.current / 2, 0));
    map.panTo(map.unproject(pt, z));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.focusStationId]);

  // Chip numbers: scoped to the EFFECTIVE zone — the circle intersected with
  // the view. Circle on screen → the circle (like « Filtres · 30 »); circle
  // overflowing the screen (zoomed in) → its visible part, so the count
  // matches the dots the user can actually see.
  let zoneInView = 0;
  if (mapRef.current && lastBoundsRef.current) {
    const bounds = mapRef.current.getBounds();
    for (const s of selectVisible(app)) {
      if (bounds.contains([s.lat, s.lng])) zoneInView++;
    }
  } else {
    zoneInView = selectVisible(app).length;
  }
  const zoneDots = Math.max(0, zoneInView - PIN_CAP);

  // Everything riding the map's bottom edge slides up with the sheet
  const bottomEdge = {
    bottom: 26 + bottomInset,
    transition: 'bottom .3s cubic-bezier(.4,0,.2,1)',
  };

  // Floating pills and control clusters share the glass of the panels
  // (theme.ts) with a lighter shadow — they are small and many
  const pillGlass = {
    background: C.glassBgSoft,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${C.glassBorder}`,
  };

  // One button of the desktop control column (zoom, share, recenter)
  const clusterButton = {
    height: 42,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: C.ink,
    fontSize: 19,
    fontWeight: 600,
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: C.mapBg,
        // Leaflet's attribution control follows the sheet too (styles.css)
        ['--map-bottom-inset' as string]: `${bottomInset}px`,
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Dense zone: tell that only the cheapest wear a price, the rest are dots */}
      {app.stations.status !== 'loading' && zoneDots > 0 && (
        <div
          data-testid="pin-cap-hint"
          style={{
            position: 'absolute',
            // The centered pill stays clear of the recenter button (right)
            // and of the desktop panel (left)
            left: 24 + leftInset,
            right: 24,
            ...bottomEdge,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              ...pillGlass,
              color: C.body,
              fontSize: 12,
              fontWeight: 600,
              padding: '7px 14px',
              borderRadius: 16,
              boxShadow: `0 8px 24px ${C.shadow50}`,
              textAlign: 'center',
            }}
          >
            {m.map_pin_cap_hint({ cap: PIN_CAP, dots: zoneDots })}
          </span>
        </div>
      )}

      {/* Loading indicator while the moved area fetches its stations */}
      {app.stations.status === 'loading' && (
        <div
          style={{
            position: 'absolute',
            left: leftInset,
            right: 0,
            ...bottomEdge,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              ...pillGlass,
              color: C.body,
              fontSize: 12.5,
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 18,
              boxShadow: `0 8px 24px ${C.shadow50}`,
            }}
          >
            {m.map_loading_stations()}
          </span>
        </div>
      )}

      {/* Desktop: one glass column for everything a mouse needs on the map.
          Zoom first — a finger pinches and a keyboard has +/− (see
          lib/mapKeyboard), but a mouse has neither: a wheel over the map is
          the only way in without these, and a trackpad user who scrolls to
          pan gets a zoom instead. Same interaction as a wheel notch, so the
          view is the user's from here on and auto-fit stands down. Then the
          share and recenter controls, which the phone keeps as their own
          circles riding the sheet. */}
      {desktop ? (
        <div
          style={{
            position: 'absolute',
            right: 14,
            ...bottomEdge,
            width: 44,
            borderRadius: 22,
            ...pillGlass,
            boxShadow: `0 6px 18px ${C.shadow45}`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 1000,
          }}
        >
          <button
            onClick={() => mapRef.current?.zoomIn()}
            aria-label={m.map_zoom_in()}
            title={m.map_zoom_in()}
            style={clusterButton}
          >
            +
          </button>
          <div style={{ height: 1, background: C.border09 }} />
          <button
            onClick={() => mapRef.current?.zoomOut()}
            aria-label={m.map_zoom_out()}
            title={m.map_zoom_out()}
            style={clusterButton}
          >
            −
          </button>
          <div style={{ height: 1, background: C.border09 }} />
          <button
            onClick={() => app.shareMapView()}
            aria-label={m.map_share_view()}
            title={m.map_share_view()}
            style={clusterButton}
          >
            <ShareIcon color={C.ink} size={18} />
          </button>
          <div style={{ height: 1, background: C.border09 }} />
          <button
            onClick={() => app.resetSearchToUser()}
            aria-label={m.map_recenter_aria()}
            title={m.map_my_position()}
            style={{
              ...clusterButton,
              // Green while the view is tied to the user's position (on it,
              // or away with the origin link drawn — see locateActive); the
              // filled dot alone says « the view IS on the user ». Otherwise
              // the same tappable ink as the zoom and share buttons above.
              background: locateActive ? C.accentSoft15 : 'transparent',
            }}
          >
            <LocateIcon
              color={locateActive ? C.accent : C.ink}
              dot={!app.searchedAway}
              size={19}
            />
          </button>
        </div>
      ) : (
        <>
          {/* Share the view — same picto and same share path as a station
              fiche. The URL already carries the view, but an installed PWA
              has no address bar to copy it from. Rides the map's control
              column so it stays clear of the sheet whatever its height. */}
          <button
            onClick={() => app.shareMapView()}
            aria-label={m.map_share_view()}
            title={m.map_share_view()}
            style={{
              position: 'absolute',
              right: 14,
              ...bottomEdge,
              bottom: bottomEdge.bottom + 52,
              width: 44,
              height: 44,
              borderRadius: '50%',
              ...pillGlass,
              boxShadow: `0 6px 18px ${C.shadow45}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
          >
            <ShareIcon color={C.ink} size={18} />
          </button>

          {/* Recenter on the user. Green while the view is tied to the
              user's position (on it, or away with the origin link drawn —
              see locateActive), the filled dot only when the view IS on the
              user; plain tappable ink (the share button's look) once the
              tie is gone. */}
          <button
            onClick={() => app.resetSearchToUser()}
            aria-label={m.map_recenter_aria()}
            title={m.map_my_position()}
            style={{
              position: 'absolute',
              right: 14,
              ...bottomEdge,
              width: 44,
              height: 44,
              borderRadius: '50%',
              ...pillGlass,
              border: `1px solid ${locateActive ? C.accentBorderStrong : C.glassBorder}`,
              boxShadow: `0 6px 18px ${C.shadow45}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
          >
            <LocateIcon
              color={locateActive ? C.accent : C.ink}
              dot={!app.searchedAway}
              size={19}
            />
          </button>
        </>
      )}
    </div>
  );
}
