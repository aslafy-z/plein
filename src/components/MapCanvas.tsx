import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { C } from '../theme';
import { useApp, selectVisible, selectCheapest } from '../state/store';

export default function MapCanvas() {
  const app = useApp();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const userInteractedRef = useRef(false);
  const programmaticUntil = useRef(0);

  // ── Create the map once (StrictMode-safe: only if no map yet) ───────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    });
    map.setView([app.userPos.lat, app.userPos.lng], 13);

    L.tileLayer('https://{s}.basemap.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap · © CARTO',
      maxZoom: 19,
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const markInteract = () => {
      if (Date.now() > programmaticUntil.current) userInteractedRef.current = true;
    };
    map.on('dragstart', markInteract);
    map.on('zoomstart', markInteract);

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reset auto-fit when the frame of reference changes ──────────────────────
  useEffect(() => {
    userInteractedRef.current = false;
  }, [app.userPos, app.radius]);

  // ── Rebuild markers + user dot, then auto-fit ───────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    const visible = selectVisible(app);
    const cheapest = selectCheapest(app);
    const coords: L.LatLngExpression[] = [[app.userPos.lat, app.userPos.lng]];

    // User position dot
    const userHtml =
      `<div style="width:34px;height:34px;border-radius:50%;background:rgba(61,220,132,.15);` +
      `display:flex;align-items:center;justify-content:center">` +
      `<div style="width:14px;height:14px;border-radius:50%;background:#3ddc84;` +
      `border:3px solid #0c2116;box-sizing:border-box"></div></div>`;
    L.marker([app.userPos.lat, app.userPos.lng], {
      icon: L.divIcon({ className: '', html: userHtml, iconSize: [34, 34], iconAnchor: [17, 17] }),
      interactive: false,
      keyboard: false,
    }).addTo(layer);

    // Station price pins
    visible.forEach((s) => {
      const best = cheapest?.id === s.id;
      const price = s.prices[app.fuel]!.value;
      const bg = best ? '#3ddc84' : '#22282c';
      const fg = best ? '#08120c' : '#cfd6da';
      const font = best
        ? "700 15px 'Spline Sans Mono',monospace"
        : "600 13px 'Spline Sans Mono',monospace";
      const pad = best ? '7px 11px' : '5px 9px';
      const border = best ? '1px solid #3ddc84' : '1px solid rgba(255,255,255,.08)';
      const shadow = best ? 'drop-shadow(0 4px 12px rgba(61,220,132,.35))' : 'none';
      const label = price.toFixed(2).replace('.', ',');

      const html =
        `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;` +
        `align-items:center;cursor:pointer;filter:${shadow}">` +
        `<div class="pin-bubble" style="background:${bg};color:${fg};font:${font};` +
        `padding:${pad};border:${border}">${label}</div>` +
        `<div class="pin-tip" style="border-top:7px solid ${bg}"></div></div>`;

      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
      });
      marker.on('click', () => app.openStation(s.id));
      marker.addTo(layer);
      coords.push([s.lat, s.lng]);
    });

    // Auto-fit only until the user takes over
    if (!userInteractedRef.current) {
      programmaticUntil.current = Date.now() + 700;
      if (coords.length > 1) {
        map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 15 });
      } else {
        map.setView([app.userPos.lat, app.userPos.lng], 13, { animate: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.stations.data, app.fuel, app.radius, app.brandCats, app.serviceTags, app.userPos]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: C.mapBg }} />;
}
