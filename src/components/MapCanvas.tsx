import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { C } from '../theme';
import { haversineKm } from '../lib/geo';
import { addDarkBasemap } from '../lib/tiles';
import { useApp, selectVisible, selectMapStations, selectCheapest } from '../state/store';

export default function MapCanvas() {
  const app = useApp();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const userInteractedRef = useRef(false);
  const programmaticUntil = useRef(0);
  /** Skip the next auto-fit: the search area moved because the USER moved the map */
  const keepViewRef = useRef(false);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // moveend closures read the latest app state through this ref
  const appRef = useRef(app);
  appRef.current = app;

  const circleRef = useRef<L.Circle | null>(null);
  const userDotRef = useRef<L.Marker | null>(null);
  const markersRef = useRef(new Map<string, { marker: L.Marker; sig: string }>());

  // ── Create the map once (StrictMode-safe: only if no map yet) ───────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    });
    map.setView([app.searchPos.lat, app.searchPos.lng], 13);

    addDarkBasemap(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const markInteract = () => {
      if (Date.now() > programmaticUntil.current) userInteractedRef.current = true;
    };
    map.on('dragstart', markInteract);
    map.on('zoomstart', markInteract);

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
      if (userInteractedRef.current) circleRef.current?.setLatLng(map.getCenter());
    });
    map.on('move', () => {
      if (!userInteractedRef.current || zooming) return;
      circleRef.current?.setLatLng(map.getCenter());
    });

    // Moving the map away loads the stations of the new area automatically
    // (debounced; only for user-initiated moves, never programmatic fits)
    map.on('moveend', () => {
      if (!userInteractedRef.current) return;
      const c = map.getCenter();
      const cur = appRef.current;
      const drift = haversineKm({ lat: c.lat, lng: c.lng }, cur.searchPos);
      // Track the screen center closely so shown pumps match the visible area
      if (drift <= Math.max(0.4, cur.radius * 0.1)) return;
      clearTimeout(moveTimer.current);
      moveTimer.current = setTimeout(() => {
        keepViewRef.current = true; // don't yank the map back after reload
        appRef.current.setSearchArea({ lat: c.lat, lng: c.lng });
      }, 350);
    });

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      clearTimeout(moveTimer.current);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      // refs survive StrictMode remounts — drop everything tied to the dead map
      markersRef.current.clear();
      circleRef.current = null;
      userDotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reset auto-fit when the frame of reference changes ──────────────────────
  useEffect(() => {
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
        color: '#3ddc84',
        weight: 1,
        opacity: 0.35,
        fillColor: '#3ddc84',
        fillOpacity: 0.04,
        interactive: false,
      }).addTo(map);
    } else {
      circleRef.current.setLatLng([app.searchPos.lat, app.searchPos.lng]);
      circleRef.current.setRadius(app.radius * 1000);
    }
  }, [app.searchPos, app.radius]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!userDotRef.current) {
      const userHtml =
        `<div style="width:34px;height:34px;border-radius:50%;background:rgba(61,220,132,.15);` +
        `display:flex;align-items:center;justify-content:center">` +
        `<div style="width:14px;height:14px;border-radius:50%;background:#3ddc84;` +
        `border:3px solid #0c2116;box-sizing:border-box"></div></div>`;
      userDotRef.current = L.marker([app.userPos.lat, app.userPos.lng], {
        icon: L.divIcon({ className: '', html: userHtml, iconSize: [34, 34], iconAnchor: [17, 17] }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
    } else {
      userDotRef.current.setLatLng([app.userPos.lat, app.userPos.lng]);
    }
  }, [app.userPos]);

  // ── Station pins: keyed diff so panning/refreshes never blink the markers ──
  // The map shows every loaded station passing the filters (the whole fetched
  // area), not just the radius circle — pins no longer pop in/out on pan.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const pins = selectMapStations(app);
    const cheapest = selectCheapest(app);
    const markers = markersRef.current;
    const wanted = new Set<string>();

    for (const s of pins) {
      const best = cheapest?.id === s.id;
      const price = s.prices[app.fuel]!.value;
      const sig = `${price}|${best}`;
      wanted.add(s.id);
      const existing = markers.get(s.id);
      if (existing && existing.sig === sig) continue;

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
      const icon = L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] });

      if (existing) {
        existing.marker.setIcon(icon);
        existing.sig = sig;
      } else {
        const marker = L.marker([s.lat, s.lng], { icon });
        marker.on('click', () => appRef.current.openStation(s.id));
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

    // Auto-fit (to the radius zone, not the whole fetched area) until the user takes over
    if (!userInteractedRef.current) {
      programmaticUntil.current = Date.now() + 700;
      const zone = selectVisible(app);
      const coords: L.LatLngExpression[] = [[app.searchPos.lat, app.searchPos.lng]];
      zone.forEach((s) => coords.push([s.lat, s.lng]));
      if (coords.length > 1) {
        map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 15 });
      } else {
        map.setView([app.searchPos.lat, app.searchPos.lng], 13, { animate: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.stations.data, app.fuel, app.radius, app.brandCats, app.serviceTags, app.userPos, app.searchPos]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: C.mapBg }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Loading indicator while the moved area fetches its stations */}
      {app.stations.status === 'loading' && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 26,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              background: C.surface2,
              color: C.body,
              fontSize: 12.5,
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 18,
              border: `1px solid ${C.border09}`,
              boxShadow: '0 8px 24px rgba(0,0,0,.5)',
            }}
          >
            Recherche des stations…
          </span>
        </div>
      )}

      {/* Recenter on the user */}
      <button
        onClick={() => app.resetSearchToUser()}
        aria-label="Recentrer sur ma position"
        title="Ma position"
        style={{
          position: 'absolute',
          right: 14,
          bottom: 26,
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: C.surface2,
          border: `1px solid ${app.searchedAway ? C.accentBorderStrong : C.border09}`,
          boxShadow: '0 6px 18px rgba(0,0,0,.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            border: `2.5px solid ${app.searchedAway ? C.accent : C.mut}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: app.searchedAway ? C.accent : C.mut,
            }}
          />
        </div>
      </button>
    </div>
  );
}
