// Map view of the computed route: polyline, departure/arrival, price pins for
// every corridor stop (recommended one highlighted) and the autonomy limit.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { C } from '../theme';
import { cumulativeKm, type GeoPoint } from '../lib/geo';
import { addDarkBasemap } from '../lib/tiles';
import { useApp, selectRouteAnalysis, effectivePrice } from '../state/store';

/** Vertex at a given km along the polyline (vertex precision is plenty here) */
function pointAtKm(polyline: GeoPoint[], cum: number[], km: number): GeoPoint | null {
  if (!polyline.length || km <= 0) return null;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] >= km) return polyline[i];
  }
  return null;
}

export default function RouteMap() {
  const app = useApp();
  const analysis = selectRouteAnalysis(app);
  const route = app.routeState.route;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRouteRef = useRef<unknown>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    });
    map.setView([46.6, 2.4], 6);
    addDarkBasemap(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !route) return;

    layer.clearLayers();

    const line = route.polyline.map((p) => [p.lat, p.lng]) as L.LatLngExpression[];
    L.polyline(line, { color: C.accent, weight: 4, opacity: 0.85 }).addTo(layer);

    // Departure / arrival
    const dot = (bg: string, border: string) =>
      `<div style="width:16px;height:16px;border-radius:50%;background:${bg};` +
      `border:3px solid ${border};box-sizing:border-box"></div>`;
    const start = route.polyline[0];
    const end = route.polyline[route.polyline.length - 1];
    L.marker([start.lat, start.lng], {
      icon: L.divIcon({ className: '', html: dot(C.accent, '#0c2116'), iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false,
    }).addTo(layer);
    L.marker([end.lat, end.lng], {
      icon: L.divIcon({ className: '', html: dot(C.warn, '#2a130c'), iconSize: [16, 16], iconAnchor: [8, 8] }),
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

    // Corridor stops as price pins (recommended one highlighted)
    for (const st of analysis.stops) {
      const price = effectivePrice(st, app.fuel)?.value;
      if (price == null) continue;
      const reco = st.id === analysis.recoId;
      const bg = reco ? '#3ddc84' : '#22282c';
      const fg = reco ? '#08120c' : '#cfd6da';
      const font = reco
        ? "700 13px 'Spline Sans Mono',monospace"
        : "600 11.5px 'Spline Sans Mono',monospace";
      const html =
        `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;` +
        `align-items:center;cursor:pointer">` +
        `<div class="pin-bubble" style="background:${bg};color:${fg};font:${font};` +
        `padding:4px 8px;border:1px solid ${reco ? '#3ddc84' : 'rgba(255,255,255,.08)'}">` +
        `${price.toFixed(2).replace('.', ',')}</div>` +
        `<div class="pin-tip" style="border-top:6px solid ${bg}"></div></div>`;
      const marker = L.marker([st.lat, st.lng], {
        icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
      });
      marker.on('click', () => app.openStation(st.id));
      marker.addTo(layer);
    }

    // Fit once per computed route, not on every strategy/fuel switch
    if (fittedRouteRef.current !== route) {
      fittedRouteRef.current = route;
      map.fitBounds(L.latLngBounds(line), { padding: [26, 26] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, app.routeState.stations, app.fuel, app.routeMode, analysis.recoId]);

  return (
    <div
      aria-label="Carte du trajet"
      style={{
        position: 'relative',
        height: 210,
        flexShrink: 0,
        background: C.mapBg,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
