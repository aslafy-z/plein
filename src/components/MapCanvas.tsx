import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { C } from '../theme';
import { haversineKm } from '../lib/geo';
import { addDarkBasemap } from '../lib/tiles';
import {
  useApp,
  selectVisible,
  selectMapStations,
  selectCheapest,
  type AppStore,
} from '../state/store';

/**
 * Dense areas: only the PIN_CAP cheapest stations wear a price bubble — the
 * ones inside the search circle first — the rest shrink to small dots (still
 * tappable) so the map stays readable. The selected station always keeps its
 * full pin, wherever it ranks.
 */
const PIN_CAP = 15;

/**
 * Stations wearing a price bubble: the PIN_CAP cheapest, the search circle
 * first — a dense zone always shows PIN_CAP prices INSIDE the circle,
 * whatever cheaper stations sit outside it; out-of-zone stations only get
 * the leftover bubbles when the zone is sparse.
 */
function pricedIds(app: AppStore): Set<string> {
  const zoneIds = new Set(selectVisible(app).map((s) => s.id));
  return new Set(
    [...selectMapStations(app)]
      .sort(
        (a, b) =>
          Number(zoneIds.has(b.id)) - Number(zoneIds.has(a.id)) ||
          a.prices[app.fuel]!.value - b.prices[app.fuel]!.value,
      )
      .slice(0, PIN_CAP)
      .map((s) => s.id),
  );
}

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

  // The pin-cap chip counts what is actually ON SCREEN — re-render on view
  // changes so its numbers follow the pan/zoom
  const [, setViewTick] = useState(0);

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

    map.on('moveend zoomend', () => setViewTick((t) => t + 1));

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
      if (Date.now() < programmaticUntil.current) return; // pan-to-station, fits…
      circleRef.current?.setLatLng(map.getCenter());
    });

    // Moving the map away loads the stations of the new area automatically
    // (debounced; only for user-initiated moves, never programmatic fits)
    map.on('moveend', () => {
      if (!userInteractedRef.current) return;
      if (Date.now() < programmaticUntil.current) return;
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

    const priced = pricedIds(app);

    for (const s of pins) {
      const best = cheapest?.id === s.id;
      const focused = app.focusStationId === s.id;
      const dot = !priced.has(s.id) && !focused;
      const price = s.prices[app.fuel]!.value;
      const sig = `${price}|${best}|${focused}|${dot}`;
      wanted.add(s.id);
      const existing = markers.get(s.id);
      if (existing && existing.sig === sig) continue;

      const bg = best ? '#3ddc84' : '#22282c';
      const fg = best ? '#08120c' : '#cfd6da';
      const big = best || focused;
      const font = big
        ? "700 15px 'Spline Sans Mono',monospace"
        : "600 13px 'Spline Sans Mono',monospace";
      const pad = big ? '7px 11px' : '5px 9px';
      // The selected pin gets an accent halo so it stands out from the list
      const border = focused
        ? `2px solid ${best ? '#eafff3' : '#3ddc84'}`
        : best
          ? '1px solid #3ddc84'
          : '1px solid rgba(255,255,255,.08)';
      const shadow = focused
        ? 'drop-shadow(0 6px 16px rgba(61,220,132,.55))'
        : best
          ? 'drop-shadow(0 4px 12px rgba(61,220,132,.35))'
          : 'none';
      const label = price.toFixed(2).replace('.', ',');
      const html = dot
        ? `<div style="transform:translate(-50%,-50%)"><div class="pin-dot"></div></div>`
        : `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;` +
          `align-items:center;cursor:pointer;filter:${shadow}">` +
          `<div class="pin-bubble" style="background:${bg};color:${fg};font:${font};` +
          `padding:${pad};border:${border}">${label}</div>` +
          `<div class="pin-tip" style="border-top:7px solid ${bg}"></div></div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] });
      const z = focused ? 2000 : best ? 1000 : dot ? -400 : 0;

      if (existing) {
        existing.marker.setIcon(icon);
        existing.marker.setZIndexOffset(z);
        existing.sig = sig;
      } else {
        const marker = L.marker([s.lat, s.lng], { zIndexOffset: z, icon });
        // Tapping a pin selects the station in the bottom-sheet card
        // (the full detail opens from there) — Google-Maps-like flow
        marker.on('click', () => appRef.current.setFocusStation(s.id));
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

    // Auto-fit (to the radius zone, not the whole fetched area) until the user
    // takes over — and never while a station is selected (don't yank the view)
    if (!userInteractedRef.current && !app.focusStationId) {
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
  }, [app.stations.data, app.fuel, app.radius, app.brandSel, app.serviceTags, app.userPos, app.searchPos, app.focusStationId]);

  // ── Selecting a station (pin tap or sheet-list tap) pans the map onto it ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !app.focusStationId) return;
    const s = selectMapStations(app).find((x) => x.id === app.focusStationId);
    if (!s) return;
    programmaticUntil.current = Date.now() + 1200; // no auto-search, no circle glide
    map.panTo([s.lat, s.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.focusStationId]);

  // Chip numbers: only the stations inside the CURRENT view — the fetched
  // area is far larger than the screen, and counting it reads as nonsense
  // (« 110 en points » with five dots visible)
  let bubblesInView = 0;
  let dotsInView = 0;
  if (mapRef.current && app.stations.status !== 'loading') {
    const bounds = mapRef.current.getBounds();
    const priced = pricedIds(app);
    for (const s of selectMapStations(app)) {
      if (!bounds.contains([s.lat, s.lng])) continue;
      if (priced.has(s.id) || s.id === app.focusStationId) bubblesInView++;
      else dotsInView++;
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: C.mapBg }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Dense area: tell that only the cheapest wear a price, the rest are dots */}
      {app.stations.status !== 'loading' && dotsInView > 0 && (
        <div
          data-testid="pin-cap-hint"
          style={{
            position: 'absolute',
            // Clear of the recenter button (right) and the attribution line
            left: 64,
            right: 64,
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
              fontSize: 12,
              fontWeight: 600,
              padding: '7px 14px',
              borderRadius: 16,
              border: `1px solid ${C.border09}`,
              boxShadow: '0 8px 24px rgba(0,0,0,.5)',
              textAlign: 'center',
            }}
          >
            {bubblesInView > 0
              ? `${
                  bubblesInView > 1 ? `Les ${bubblesInView} moins chères` : 'La moins chère'
                } · ${dotsInView} en point${dotsInView > 1 ? 's' : ''}`
              : 'Touchez un point pour son prix'}
          </span>
        </div>
      )}

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
