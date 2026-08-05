// Map of the route stage, at every step of the flow: before a route exists it
// frames the search area and drops a pin on the departure and the arrival as
// they are picked (fitting the two once both are set); when the route lands it
// draws the corridor — polyline, endpoints, price pins for every corridor stop
// (recommended one highlighted) and the autonomy limit.
//
// The map always fills its stage. The only thing an arrangement may change is
// how much of it is covered: `leftInset` for the desktop panel, `bottomInset`
// for the phone sheet — insets move the framing, never the rendering.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { C, glassBlur } from '../theme';
import { m } from '../paraglide/messages.js';
import { fmtPrice } from '../lib/format';
import { cumulativeKm, radiusBounds, type GeoPoint } from '../lib/geo';
import { useLeafletMap } from '../lib/leafletMap';
import { pricePinHtml } from '../lib/pricePin';
import { USER_DOT_CLASS, USER_DOT_SIZE, userDotHtml } from '../lib/userDot';
import LocateIcon from './LocateIcon';
import { useApp, selectRouteAnalysis, effectivePrice } from '../state/store';

/** Vertex at a given km along the polyline (vertex precision is plenty here) */
function pointAtKm(polyline: GeoPoint[], cum: number[], km: number): GeoPoint | null {
  if (!polyline.length || km <= 0) return null;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] >= km) return polyline[i];
  }
  return null;
}

/**
 * Last view of the route map, kept across remounts. A phone shows a stop's
 * fiche full screen, which unmounts the whole route screen; without this,
 * coming back rebuilt the map on the corridor auto-fit and threw away the
 * user's pan/zoom. Only restored while the trip is the same one
 * (`routeState.key`) — a new computation deserves its own framing.
 */
let savedRouteView: {
  center: L.LatLng;
  zoom: number;
  userInteracted: boolean;
  routeKey: string | null;
} | null = null;

/** How close to the visible center the user's dot counts as « the view IS on
    me » — the pixel answer to the map tab's 0.5 km `searchedAway` */
const CENTERED_ON_USER_PX = 32;

/**
 * What the recenter control reports about the user's dot, against the VISIBLE
 * map — the stage minus the floating panel (desktop) and the bottom sheet
 * (phone): a dot hidden behind the sheet is not on screen, whatever
 * `map.getBounds()` says. `onScreen` counts the halo's own radius, so a dot
 * half cut by an edge reads as away rather than as here.
 */
function userViewState(
  map: L.Map,
  pos: GeoPoint,
  leftInset: number,
  bottomInset: number,
): { onScreen: boolean; centered: boolean } {
  const p = map.latLngToContainerPoint([pos.lat, pos.lng]);
  const size = map.getSize();
  const r = USER_DOT_SIZE / 2;
  const mid = L.point((size.x + leftInset) / 2, (size.y - bottomInset) / 2);
  return {
    onScreen:
      p.x - r >= leftInset &&
      p.x + r <= size.x &&
      p.y - r >= 0 &&
      p.y + r <= size.y - bottomInset,
    centered: p.distanceTo(mid) <= CENTERED_ON_USER_PX,
  };
}

/** Departure (accent circle) / arrival (warn square) marker markup */
function endpointHtml(kind: 'from' | 'to'): string {
  const bg = kind === 'from' ? C.accent : C.warn;
  const border = kind === 'from' ? C.accentDeep : C.warnDeep;
  const radius = kind === 'from' ? '50%' : '4px';
  return (
    `<div style="width:16px;height:16px;border-radius:${radius};background:${bg};` +
    `border:3px solid ${border};box-sizing:border-box"></div>`
  );
}

export default function RouteMap({
  bottomInset = 0,
  leftInset = 0,
}: {
  /** Height of the sheet covering the map's bottom edge (phone) */
  bottomInset?: number;
  /** Width of the floating timeline covering the map's left edge (desktop) */
  leftInset?: number;
}) {
  const app = useApp();
  const analysis = selectRouteAnalysis(app);
  const route = app.routeState.route;
  // Stable pin signature: the draw effect must rerun when the PLAN changes,
  // not when unrelated store state produces a fresh analysis object.
  const planKey = [
    analysis.plan?.status ?? '',
    ...analysis.planStops.map((p) => p.station.id),
    '|',
    ...analysis.alternatives.map((s) => s.id),
  ].join(',');

  const layerRef = useRef<L.LayerGroup | null>(null);
  const userDotRef = useRef<L.Marker | null>(null);
  const fittedRouteRef = useRef<unknown>(null);
  /** Bumped when the map lands — the recenter control reads the live view */
  const [, setViewTick] = useState(0);
  /** Bounds currently framed (corridor / endpoints / search area) — the shell
      re-frames them when the stage is resized, until the user takes over */
  const frameBoundsRef = useRef<L.LatLngBounds | null>(null);

  // Unmount-time closures read the latest state through this ref
  const appRef = useRef(app);
  appRef.current = app;

  const shell = useLeafletMap({
    bottomInset,
    leftInset,
    setup: (map, sh) => {
      const saved =
        savedRouteView && savedRouteView.routeKey === app.routeState.key ? savedRouteView : null;
      if (saved) {
        // Back from a full-screen fiche: the user's view returns exactly as
        // they left it, and the standing route must not re-fit over it.
        map.setView(saved.center, saved.zoom, { animate: false });
        sh.userInteractedRef.current = saved.userInteracted;
        fittedRouteRef.current = app.routeState.route;
      } else {
        // The fit effects below frame the real subject right after mount
        map.setView([app.searchPos.lat, app.searchPos.lng], 11);
      }
      layerRef.current = L.layerGroup().addTo(map);
      // The recenter control reports the LIVE view, so a landed pan/zoom has
      // to re-render it (the listener dies with the map, like the layers)
      map.on('moveend zoomend', () => setViewTick((t) => t + 1));
      return () => {
        savedRouteView = {
          center: map.getCenter(),
          zoom: map.getZoom(),
          userInteracted: sh.userInteractedRef.current,
          routeKey: appRef.current.routeState.key,
        };
        layerRef.current = null;
        // refs survive StrictMode remounts — drop what belonged to the dead map
        userDotRef.current = null;
        frameBoundsRef.current = null;
        fittedRouteRef.current = null;
      };
    },
    refitBounds: () => frameBoundsRef.current,
  });
  const { mapRef, containerRef, userInteractedRef } = shell;

  // ── « You are here » — the same dot the zone map draws (lib/userDot) ───────
  // The stage is one map across the tabs, so the user's position is marked the
  // same way on both. Its own marker straight on the map, NOT in `layer`: both
  // draw effects clear that group whole, and the position has nothing to do
  // with the corridor being redrawn. Under everything else (negative z) — a
  // trip departing from the user puts the departure marker right on it, and
  // the halo has to read as its surround, not as something covering it.
  // Drawn only where geolocation actually put the user: until a fix lands
  // `userPos` is the area the app fell back to, and a dot on it would tell
  // the trip it departs from a place the user has never been located in.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!app.hasKnownPos) {
      userDotRef.current?.remove();
      userDotRef.current = null;
      return;
    }
    if (!userDotRef.current) {
      userDotRef.current = L.marker([app.userPos.lat, app.userPos.lng], {
        icon: L.divIcon({
          className: USER_DOT_CLASS,
          html: userDotHtml(),
          iconSize: [USER_DOT_SIZE, USER_DOT_SIZE],
          iconAnchor: [USER_DOT_SIZE / 2, USER_DOT_SIZE / 2],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: -1000,
      }).addTo(map);
    } else {
      userDotRef.current.setLatLng([app.userPos.lat, app.userPos.lng]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.userPos, app.hasKnownPos]);

  // ── Before the route: departure/arrival pins over the search-area framing ──
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || route) return;

    layer.clearLayers();
    // The departure defaults to the user, so it exists only where they do:
    // without a fix `userPos` is the fallback area, and a departure pin on it
    // would mark a trip starting from a place the user has never been located
    // in — the same claim the dot above refuses to make.
    const from = app.fromPoint ?? (app.hasKnownPos ? app.userPos : null);
    const to = app.toPoint;
    if (from) {
      L.marker([from.lat, from.lng], {
        icon: L.divIcon({ className: '', html: endpointHtml('from'), iconSize: [16, 16], iconAnchor: [8, 8] }),
        interactive: false,
      }).addTo(layer);
    }
    if (to) {
      L.marker([to.lat, to.lng], {
        icon: L.divIcon({ className: '', html: endpointHtml('to'), iconSize: [16, 16], iconAnchor: [8, 8] }),
        interactive: false,
      }).addTo(layer);
    }

    // Both ends set → frame the trip to come; one end alone (a destination
    // picked with no departure yet) → frame that end; neither → keep the
    // search-area framing the map tab uses, so the stage reads as one map
    // across tabs.
    const ends = [from, to].filter((p): p is GeoPoint => p != null);
    const box = ends.length
      ? L.latLngBounds(ends.map((p) => [p.lat, p.lng] as [number, number]))
      : (() => {
          const b = radiusBounds(app.searchPos, app.radius);
          return L.latLngBounds([b.south, b.west], [b.north, b.east]);
        })();
    frameBoundsRef.current = box;
    // A newly picked endpoint deserves its framing, like a newly computed
    // route — but a plain re-render must not fight the user's pan.
    if (!userInteractedRef.current) {
      shell.fitBounds(box, ends.length > 1 ? { pad: 60 } : { pad: 40, maxZoom: 15 });
    }
    // The insets are deps like they are on the zone map's auto-fit: the
    // desktop panel only reports its width AFTER the first render, so a fit
    // run without it centered the framing on the whole stage — half of it
    // under the panel — and nothing re-ran to correct it (the container never
    // resizes, so the shell's re-fit doesn't fire either).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    route, app.fromPoint, app.toPoint, app.userPos, app.hasKnownPos, app.searchPos, app.radius,
    bottomInset, leftInset,
  ]);

  // Picking a new endpoint re-arms the framing the way a new route does
  useEffect(() => {
    if (!route) userInteractedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.fromPoint, app.toPoint]);

  // ── The computed route: corridor, stops, autonomy limit ────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !route) return;

    layer.clearLayers();

    const line = route.polyline.map((p) => [p.lat, p.lng]) as L.LatLngExpression[];
    // Color from the .route-line rule in styles.css — Leaflet writes color
    // options as SVG attributes, where a var() can't resolve
    L.polyline(line, { className: 'route-line', weight: 4, opacity: 0.85 }).addTo(layer);

    // Departure / arrival
    const start = route.polyline[0];
    const end = route.polyline[route.polyline.length - 1];
    L.marker([start.lat, start.lng], {
      icon: L.divIcon({ className: '', html: endpointHtml('from'), iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false,
    }).addTo(layer);
    L.marker([end.lat, end.lng], {
      icon: L.divIcon({ className: '', html: endpointHtml('to'), iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false,
    }).addTo(layer);

    // Autonomy limit
    if (analysis.needsStop) {
      const cum = cumulativeKm(route.polyline);
      const limit = pointAtKm(route.polyline, cum, analysis.limitKm);
      if (limit) {
        const html =
          `<div style="width:14px;height:14px;border-radius:50%;background:${C.warn};` +
          `border:3px solid ${C.bg};box-sizing:border-box;` +
          `box-shadow:0 0 0 3px ${C.warnBorder30}"></div>`;
        L.marker([limit.lat, limit.lng], {
          icon: L.divIcon({ className: '', html, iconSize: [14, 14], iconAnchor: [7, 7] }),
          interactive: false,
        }).addTo(layer);
      }
    }

    // Plan stops + alternatives as price pins — the same markup the zone map
    // draws (lib/pricePin): the plan's own stops crowned, and the stop whose
    // fiche is being read wearing the selection halo, exactly like the map's
    // pins. The fiche releases the halo with the screen when it closes.
    const selectedId = app.screen === 'detail' ? app.detailId : null;
    const planIds = new Set(analysis.planStops.map((p) => p.station.id));
    const shown = [...analysis.planStops.map((p) => p.station), ...analysis.alternatives];
    for (const st of shown) {
      const price = effectivePrice(st, app.fuel)?.value;
      if (price == null) continue;
      const recommended = planIds.has(st.id);
      const focused = st.id === selectedId;
      const html = pricePinHtml(fmtPrice(price), { recommended, focused });
      const marker = L.marker([st.lat, st.lng], {
        icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
        // The selected pin rises above the recommendation, which rises above
        // the rest — same order the zone map keeps
        zIndexOffset: focused ? 2000 : recommended ? 1000 : 0,
      });
      marker.on('click', () => app.openStation(st.id));
      marker.addTo(layer);
    }

    // Fit once per computed route, not on every strategy/fuel switch
    const box = L.latLngBounds(line);
    frameBoundsRef.current = box;
    if (fittedRouteRef.current !== route) {
      fittedRouteRef.current = route;
      userInteractedRef.current = false; // a new route deserves its own framing
      shell.fitBounds(box, { pad: 26 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, app.routeState.stations, app.fuel, app.routeMode, planKey, analysis.limitKm, app.screen, app.detailId]);

  // ── Recenter on the user — the zone map's control, on this map's terms ─────
  // The map tab's button resets the SEARCH AREA to the user; this map has no
  // search area, so here it is purely about the view: pan the user's dot back
  // to the VISIBLE center (the panel and the sheet cover part of the stage) and
  // re-ask for a fresh fix, the way the map tab's does. It never touches the
  // trip — the departure is the « from » field's business, and a locate control
  // that silently rewrote the itinerary would be a different button.
  const recenterOnUser = () => {
    app.requestGeolocation();
    const map = mapRef.current;
    // No fix yet → the button is only the ask. There is no dot to go back to,
    // and panning onto the fallback area would look like one was found.
    if (!map || !app.hasKnownPos) return;
    // A deliberate recenter is the user's framing from here on: without this
    // the next stage resize would re-fit the corridor over it
    userInteractedRef.current = true;
    const z = map.getZoom();
    // Visible center = stage center + (leftInset/2, −bottomInset/2), so the map
    // center that lands the user THERE is their point minus that offset
    const pt = map
      .project([app.userPos.lat, app.userPos.lng], z)
      .subtract(L.point(leftInset / 2, -bottomInset / 2));
    map.panTo(map.unproject(pt, z));
  };

  // Lit while the user's dot is on screen, the center dot filled only once the
  // view actually sits on them — the two states the map tab's control wears,
  // told about this map's subject (the view) instead of about a search area.
  // Both are about a dot: without a fix there is none, and the control falls
  // back to plain ink rather than reporting on the fallback area.
  const userView =
    mapRef.current && app.hasKnownPos
      ? userViewState(mapRef.current, app.userPos, leftInset, bottomInset)
      : { onScreen: app.hasKnownPos, centered: false };

  // A fix can take seconds and nothing else on the map moves meanwhile — the
  // control that asked says so here exactly as it does on the map tab
  // (MapCanvas): the app's spinner in place of the crosshair, and aria-busy.
  const locating = app.geoLocating;

  return (
    <div aria-label={m.map_route_aria()} style={{ position: 'absolute', inset: 0, background: C.mapBg }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Same glass circle, same corner and same picto as the map tab's — it
          rides the map's bottom edge, so it slides up with the sheet. This map
          has no control column to join (no zoom, no share), so the phone
          arrangement's standalone button is what both arrangements wear. */}
      <button
        onClick={recenterOnUser}
        aria-label={locating ? m.map_locating() : m.map_recenter_aria()}
        aria-busy={locating}
        title={locating ? m.map_locating() : m.map_my_position()}
        data-testid="route-recenter"
        style={{
          position: 'absolute',
          right: 14,
          bottom: 26 + bottomInset,
          transition: 'bottom .3s cubic-bezier(.4,0,.2,1)',
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: C.glassBgSoft,
          ...glassBlur(12),
          border: `1px solid ${userView.onScreen ? C.accentBorderStrong : C.glassBorder}`,
          boxShadow: `0 6px 18px ${C.shadow45}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
      >
        {locating ? (
          <span className="spin" aria-hidden style={{ color: C.accent, fontSize: 16, lineHeight: 1 }}>
            ↻
          </span>
        ) : (
          <LocateIcon
            color={userView.onScreen ? C.accent : C.ink}
            dot={userView.centered}
            size={19}
          />
        )}
      </button>
    </div>
  );
}
