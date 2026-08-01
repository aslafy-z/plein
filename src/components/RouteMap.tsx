// Map of the route stage, at every step of the flow: before a route exists it
// frames the search area and drops a pin on the departure and the arrival as
// they are picked (fitting the two once both are set); when the route lands it
// draws the corridor — polyline, endpoints, price pins for every corridor stop
// (recommended one highlighted) and the autonomy limit.
//
// The map always fills its stage. The only thing an arrangement may change is
// how much of it is covered: `leftInset` for the desktop panel, `bottomInset`
// for the phone sheet — insets move the framing, never the rendering.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { C } from '../theme';
import { m } from '../paraglide/messages.js';
import { fmtPrice } from '../lib/format';
import { cumulativeKm, radiusBounds, type GeoPoint } from '../lib/geo';
import { useLeafletMap } from '../lib/leafletMap';
import { pricePinHtml } from '../lib/pricePin';
import { useApp, selectRouteAnalysis, effectivePrice } from '../state/store';

/** Vertex at a given km along the polyline (vertex precision is plenty here) */
function pointAtKm(polyline: GeoPoint[], cum: number[], km: number): GeoPoint | null {
  if (!polyline.length || km <= 0) return null;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] >= km) return polyline[i];
  }
  return null;
}

/** Departure (accent circle) / arrival (warn square) marker markup */
function endpointHtml(kind: 'from' | 'to'): string {
  const bg = kind === 'from' ? C.accent : C.warn;
  const border = kind === 'from' ? '#0c2116' : '#2a130c';
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

  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRouteRef = useRef<unknown>(null);
  /** Bounds currently framed (corridor / endpoints / search area) — the shell
      re-frames them when the stage is resized, until the user takes over */
  const frameBoundsRef = useRef<L.LatLngBounds | null>(null);

  const shell = useLeafletMap({
    bottomInset,
    leftInset,
    setup: (map) => {
      // The fit effects below frame the real subject right after mount
      map.setView([app.searchPos.lat, app.searchPos.lng], 11);
      layerRef.current = L.layerGroup().addTo(map);
      return () => {
        layerRef.current = null;
        frameBoundsRef.current = null;
        fittedRouteRef.current = null;
      };
    },
    refitBounds: () => frameBoundsRef.current,
  });
  const { mapRef, containerRef, userInteractedRef } = shell;

  // ── Before the route: departure/arrival pins over the search-area framing ──
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || route) return;

    layer.clearLayers();
    const from = app.fromPoint ?? app.userPos;
    const to = app.toPoint;
    L.marker([from.lat, from.lng], {
      icon: L.divIcon({ className: '', html: endpointHtml('from'), iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false,
    }).addTo(layer);
    if (to) {
      L.marker([to.lat, to.lng], {
        icon: L.divIcon({ className: '', html: endpointHtml('to'), iconSize: [16, 16], iconAnchor: [8, 8] }),
        interactive: false,
      }).addTo(layer);
    }

    // Both ends set → frame the trip to come; otherwise keep the search-area
    // framing the map tab uses, so the stage reads as one map across tabs.
    const box = to
      ? L.latLngBounds([
          [from.lat, from.lng],
          [to.lat, to.lng],
        ])
      : (() => {
          const b = radiusBounds(app.searchPos, app.radius);
          return L.latLngBounds([b.south, b.west], [b.north, b.east]);
        })();
    frameBoundsRef.current = box;
    // A newly picked endpoint deserves its framing, like a newly computed
    // route — but a plain re-render must not fight the user's pan.
    if (!userInteractedRef.current) {
      shell.fitBounds(box, to ? { pad: 60 } : { pad: 40, maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, app.fromPoint, app.toPoint, app.userPos, app.searchPos, app.radius]);

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
    L.polyline(line, { color: C.accent, weight: 4, opacity: 0.85 }).addTo(layer);

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
          `border:3px solid #101214;box-sizing:border-box;` +
          `box-shadow:0 0 0 3px rgba(224,122,95,.3)"></div>`;
        L.marker([limit.lat, limit.lng], {
          icon: L.divIcon({ className: '', html, iconSize: [14, 14], iconAnchor: [7, 7] }),
          interactive: false,
        }).addTo(layer);
      }
    }

    // Corridor stops as price pins (recommended one highlighted) — the same
    // markup the zone map draws (lib/pricePin)
    for (const st of analysis.stops) {
      const price = effectivePrice(st, app.fuel)?.value;
      if (price == null) continue;
      const html = pricePinHtml(fmtPrice(price), {
        recommended: st.id === analysis.recoId,
      });
      const marker = L.marker([st.lat, st.lng], {
        icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
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
  }, [route, app.routeState.stations, app.fuel, app.routeMode, analysis.recoId]);

  return (
    <div aria-label={m.map_route_aria()} style={{ position: 'absolute', inset: 0, background: C.mapBg }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
