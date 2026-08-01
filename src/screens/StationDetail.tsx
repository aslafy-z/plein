import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { C, ctaStyle, mono, stickyBarStyle } from '../theme';
import {
  ALL_FUELS,
  MAIN_FUELS,
  type ExtraProductId,
  type FuelId,
  type Station,
} from '../data/types';
import {
  useApp,
  selectVisibleForFuel,
  effectivePrice,
  fuelRange,
  priceCents,
  roadReachOf,
} from '../state/store';
import { routeBusy } from '../state/routePipeline';
import { stationCountry } from '../data/stationIds';
import { fmtPrice, distLabel, agoLabel, durationLabel } from '../lib/format';
import { fuelLabel, openStatusLabel, serviceLabel } from '../lib/labels';
import { useIsDesktop } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import { haversineKm } from '../lib/geo';
import { openStatus } from '../lib/hours';
import { brandIconSrc } from '../lib/brandIcons';
import { addDarkBasemap } from '../lib/tiles';
import Star from '../components/Star';
import ShareIcon from '../components/ShareIcon';

/** Static mini-map centred on the station (replaces the prototype's photo slot) */
function StationMiniMap({ station }: { station: Station }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });
    map.setView([station.lat, station.lng], 15);
    addDarkBasemap(map);
    // The enseigne's logo on a white tile identifies the station far better
    // than its initials; brands we have no logo for keep the initials bubble.
    const iconSrc = brandIconSrc(station.brand ?? station.name);
    const bubble = iconSrc
      ? `<div class="pin-bubble" style="background:#fff;border:1px solid #3ddc84;` +
        `width:34px;height:34px;display:flex;align-items:center;justify-content:center">` +
        // background-image rather than <img>: a missing file leaves the white
        // tile instead of a broken-image glyph.
        `<div style="width:23px;height:23px;background:url('${iconSrc}') center/contain no-repeat"></div>` +
        `</div>`
      : `<div class="pin-bubble" style="background:#3ddc84;color:#08120c;` +
        `font:700 13px 'Spline Sans Mono',monospace;padding:5px 9px;border:1px solid #3ddc84">` +
        `${station.init}</div>`;
    const html =
      `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center">` +
      bubble +
      `<div class="pin-tip" style="border-top:6px solid #3ddc84"></div></div>`;
    L.marker([station.lat, station.lng], {
      icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
      interactive: false,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station.id]);

  return (
    <div
      ref={containerRef}
      aria-label={m.detail_map_aria()}
      style={{ position: 'absolute', inset: 0, background: C.mapBg }}
    />
  );
}

/** Cold load of /station/:id — the fiche has nothing to draw yet */
function StationDetailPending({ desktop }: { desktop: boolean }) {
  return (
    <div
      style={{
        // Same frame as the fiche it is standing in for, so nothing jumps
        // when the station lands
        ...(desktop
          ? { flex: 1, minHeight: 0 }
          : { position: 'absolute', inset: 0, background: '#101214', zIndex: 1200 }),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: C.mut,
        fontSize: 13,
      }}
    >
      {m.detail_loading()}
    </div>
  );
}

export default function StationDetail() {
  const app = useApp();
  const desktop = useIsDesktop();

  const nearby = app.stations.data.find((x) => x.id === app.detailId);
  const routeSt = app.routeState.stations.find((x) => x.id === app.detailId);
  // Opened from the route ribbon (or only known along the route) → all
  // comparisons are route-relative, not home-radius-relative.
  const isRoute = routeSt != null && (app.prevScreen === 'route' || !nearby);
  const s = isRoute ? routeSt : (nearby ?? routeSt);

  // A deep link (/station/:id) boots with `stations.data` still empty: the
  // station is only really unknown once the sources it could come from have
  // settled, otherwise the guard below would back out of every cold load.
  const pending =
    app.stations.status === 'idle' ||
    app.stations.status === 'loading' ||
    routeBusy(app.routeState);

  useEffect(() => {
    if (!s && !pending) app.back();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, pending]);

  // Desktop: the fiche floats over the LIVE map (MapScreen keeps it mounted
  // behind) — select the station there so the map pans onto it and its pin
  // wears the halo, the same link a list row makes. Only when the station
  // belongs to the loaded area: a route stop far from the zone must not
  // teleport the map. The selection is the fiche's own: closing it hands the
  // map back as it was, with the default card heading, not a leftover
  // « station sélectionnée ».
  const nearbyId = nearby?.id;
  const appRef = useRef(app);
  appRef.current = app;
  // « Voir sur la carte » hands the selection over to the map screen — the
  // one exit where clearing it would undo the very thing the user asked for
  const keepFocusRef = useRef(false);
  useEffect(() => {
    if (!desktop || !nearbyId) return;
    appRef.current.setFocusStation(nearbyId);
    return () => {
      if (keepFocusRef.current) return;
      appRef.current.setFocusStation(null);
    };
  }, [desktop, nearbyId]);

  if (!s) return pending ? <StationDetailPending desktop={desktop} /> : null;

  const { distKm, driveMin } = roadReachOf(
    haversineKm(app.userPos, { lat: s.lat, lng: s.lng }),
    app.roadReach[s.id],
  );
  const placeChip = isRoute
    ? m.detail_place_chip_route({
        km: Math.round(routeSt!.kmAlong),
        detour:
          routeSt!.detourMin === 0
            ? m.ribbon_no_detour()
            : m.ribbon_detour({ minutes: routeSt!.detourMin }),
      })
    : m.detail_place_chip_nearby({
        distance: distLabel(distKm),
        duration: durationLabel(driveMin),
      });

  // Fuels to display: any priced fuel + always the main fuels
  const shownFuels = ALL_FUELS.filter((f) => s.prices[f] != null || MAIN_FUELS.includes(f));

  // Comparison set per fuel: stations along the route, or the stations
  // passing the current filters around the user — the SAME set the list
  // and map derive their numbers from, substitution included (fuelRange
  // reads effectivePrice, so a Spanish zone compares E10 on SP95 prices).
  const rangeFor = (f: FuelId) =>
    fuelRange(isRoute ? app.routeState.stations : selectVisibleForFuel(app, f), f);

  const scopeLow = isRoute ? m.detail_scope_low_route() : m.detail_scope_low_radius();
  const scopeSave = isRoute ? m.detail_scope_save_route() : m.detail_scope_save_radius();

  const maxForCurrentFuel = rangeFor(app.fuel)?.max ?? null;

  // SP95 stands in for E10 in Spain/Andorra — same substitution as the map
  const cur = effectivePrice(s, app.fuel)?.value;
  const dSave = cur != null && maxForCurrentFuel != null ? (maxForCurrentFuel - cur) * app.tank : 0;
  const dSaveStr = dSave > 0 ? `−${fmtPrice(dSave)}` : '0,00';

  // Most recent update among this station's prices
  const updatedTimes = Object.values(s.prices)
    .map((p) => p?.updatedAt)
    .filter((t): t is string => !!t);
  const mostRecent =
    updatedTimes.length > 0
      ? updatedTimes.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b))
      : undefined;

  const activeSource = isRoute ? app.sourceId : app.stations.activeSource;
  // The auto source mixes countries — attribute per station (ids are prefixed)
  const stationSource = activeSource === 'auto' ? (stationCountry(s.id) ?? 'fra') : activeSource;
  const ago = agoLabel(mostRecent);
  // The « auto » source mixes countries, so the credit names the flux that
  // actually served THIS station — never a domain hard-coded per screen.
  const sourceName =
    stationSource === 'fra'
      ? 'prix-carburants.gouv.fr'
      : stationSource === 'esp'
        ? 'geoportalgasolineras.es'
        : stationSource === 'and'
          ? m.detail_source_and()
          : stationSource === 'prt'
            ? 'precoscombustiveis.dgeg.gov.pt'
            : null;
  const footerText = sourceName
    ? m.detail_footer_source({ ago, source: sourceName })
    : m.detail_footer_demo({ ago });

  // Address line already shows the city; the third chip adds brand or context
  const thirdChip = s.brand ?? (s.highway ? m.detail_highway() : s.address ? null : s.city);
  const status = openStatus(s.hours);

  const onViewOnMap = () => {
    keepFocusRef.current = true;
    app.setSearchArea({ lat: s.lat, lng: s.lng }, s.name);
    // …with THIS station selected on the map (highlighted pin + card)
    app.setFocusStation(s.id);
    app.go('map');
  };
  const onToggleFavorite = () =>
    app.toggleFavorite({
      id: s.id,
      name: s.name,
      init: s.init,
      city: s.city,
      lat: s.lat,
      lng: s.lng,
    });
  const favoriteAria = app.isFavorite(s.id)
    ? m.detail_remove_favorite_aria()
    : m.detail_add_favorite_aria();

  /** Round icon button of the desktop header row */
  const headerButton = {
    width: 34,
    height: 34,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  } as const;

  // The fiche itself — the same document in both arrangements. It fills the
  // screen on a phone, opening on a mini-map that gives the address a place.
  // On a window it stacks under the zone list, over the LIVE map that is
  // already showing the station — a second map there would say nothing, so
  // its actions move to a compact header row instead.
  const body = (
    <>
      {desktop ? (
        // Stacked under the list, the fiche is dismissed like a panel — a
        // cross, not a « back ». No « view on map » either: the live map at
        // the right is already showing the station.
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '10px 12px 0',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => app.back()}
            aria-label={m.detail_close_aria()}
            title={m.detail_close_aria()}
            style={{ ...headerButton, color: C.ink, fontSize: 15, fontWeight: 700 }}
          >
            ✕
          </button>
          <span style={{ flex: 1 }} />
          {/* Share the fiche — native sheet where it exists, clipboard elsewhere */}
          <button
            onClick={() => app.shareStation(s)}
            aria-label={m.detail_share_aria()}
            style={headerButton}
          >
            <ShareIcon color={C.ink} size={17} />
          </button>
          {/* Pin to Favoris */}
          <button onClick={onToggleFavorite} aria-label={favoriteAria} style={headerButton}>
            <Star
              filled={app.isFavorite(s.id)}
              color={app.isFavorite(s.id) ? C.accent : C.ink}
              size={18}
            />
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative', height: 160, flexShrink: 0, background: C.mapBg }}>
          <StationMiniMap station={s} />
          <button
            onClick={onViewOnMap}
            style={{
              position: 'absolute',
              right: 12,
              bottom: 26,
              zIndex: 1000,
              background: '#101214d9',
              color: C.accent,
              fontSize: 12,
              fontWeight: 700,
              padding: '7px 12px',
              borderRadius: 16,
              border: `1px solid ${C.accentBorder}`,
            }}
          >
            {m.detail_view_on_map()}
          </button>
          <button
            onClick={() => app.back()}
            aria-label={m.detail_back_aria()}
            title={m.detail_back_aria()}
            style={{
              position: 'absolute',
              left: 14,
              top: 14,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: '#101214d9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.ink,
              fontSize: 18,
              zIndex: 1000,
            }}
          >
            ←
          </button>
          {/* Share the fiche — native sheet where it exists, clipboard elsewhere */}
          <button
            onClick={() => app.shareStation(s)}
            aria-label={m.detail_share_aria()}
            style={{
              position: 'absolute',
              right: 62,
              top: 14,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: '#101214d9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
          >
            <ShareIcon color={C.ink} size={18} />
          </button>
          {/* Pin to Favoris */}
          <button
            onClick={onToggleFavorite}
            aria-label={favoriteAria}
            style={{
              position: 'absolute',
              right: 14,
              top: 14,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: '#101214d9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
          >
            <Star filled={app.isFavorite(s.id)} color={app.isFavorite(s.id) ? C.accent : C.ink} size={19} />
          </button>
        </div>
      )}

      <div style={{ padding: '18px 20px 8px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Title + chips */}
        <div>
          <div style={{ color: C.ink, fontSize: 21, fontWeight: 700 }}>{s.name}</div>
          {s.address && (
            <div style={{ color: C.mut, fontSize: 13, marginTop: 4 }}>
              {s.address}
              {s.postalCode || s.city
                ? ` · ${[s.postalCode, s.city].filter(Boolean).join(' ')}`
                : ''}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {status && (
              <span
                style={{
                  background: status.open ? C.accentSoft14 : 'rgba(224,122,95,.14)',
                  color: status.open ? C.accent : C.warn,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '5px 10px',
                  borderRadius: 14,
                  whiteSpace: 'nowrap',
                }}
              >
                {openStatusLabel(status)}
              </span>
            )}
            <span
              style={{
                background: C.surface2,
                color: C.body,
                fontSize: 12,
                fontWeight: 500,
                padding: '5px 10px',
                borderRadius: 14,
                border: `1px solid ${C.border09}`,
                whiteSpace: 'nowrap',
              }}
            >
              {placeChip}
            </span>
            {thirdChip && (
              <span
                style={{
                  background: C.surface2,
                  color: C.body,
                  fontSize: 12,
                  fontWeight: 500,
                  padding: '5px 10px',
                  borderRadius: 14,
                  border: `1px solid ${C.border09}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {thirdChip}
              </span>
            )}
          </div>
        </div>

        {/* Prices card */}
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {shownFuels.map((f) => {
            const price = s.prices[f]?.value;
            const min = rangeFor(f)?.min ?? null;
            let note = '';
            let noteColor: string = C.mut;
            if (price == null) {
              note = m.detail_fuel_not_sold();
            } else if (min != null && priceCents(price) <= priceCents(min)) {
              // Cent precision, like everywhere: a station reading the same
              // displayed price as the minimum IS the minimum for the user
              note = scopeLow;
              noteColor = C.accent;
            } else if (min != null) {
              note = m.detail_price_above_min({
                delta: fmtPrice((priceCents(price) - priceCents(min)) / 100),
              });
            }
            const isCur = f === app.fuel;
            return (
              <div
                key={f}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderBottom: `1px solid rgba(255,255,255,.06)`,
                }}
              >
                <span style={{ flex: 1, color: C.ink, fontSize: 15, fontWeight: 600 }}>
                  {fuelLabel(f)}
                </span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ color: noteColor, fontSize: 11.5, fontWeight: 600, display: 'block' }}>
                    {note}
                  </span>
                  {s.prices[f]?.updatedAt && (
                    <span style={{ color: C.faint, fontSize: 10.5, display: 'block', marginTop: 1 }}>
                      {m.detail_updated_ago({ ago: agoLabel(s.prices[f]?.updatedAt) })}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    font: mono(700, 18),
                    color: isCur ? C.accent : C.ink,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {price == null ? '—' : `${fmtPrice(price)} €`}
                </span>
              </div>
            );
          })}
          <div style={{ padding: '10px 16px', background: '#15181b', color: C.mut, fontSize: 11.5 }}>
            {footerText}
          </div>
        </div>

        {/* Services */}
        <div>
          <div
            style={{
              color: C.mut,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            {m.detail_services()}
          </div>
          {s.services.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {s.services.map((sv, i) => {
                // The Spanish and Andorran fluxes price the extra products
                // they list (AdBlue included) — showing the figure is both
                // the honest reason the station carries the chip and data
                // the app used to parse and throw away.
                const price = s.extraPrices?.[sv as ExtraProductId];
                return (
                  <span
                    key={`${sv}-${i}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'baseline',
                      gap: 7,
                      background: C.surface2,
                      color: C.body,
                      fontSize: 13,
                      padding: '8px 13px',
                      borderRadius: 16,
                      border: `1px solid ${C.border09}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {serviceLabel(sv)}
                    {price && (
                      <span style={{ font: mono(700, 12.5), color: C.ink }}>
                        {m.detail_service_price({ price: fmtPrice(price.value) })}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <div style={{ color: C.mut, fontSize: 13 }}>{m.detail_no_services()}</div>
          )}
        </div>

        {/* Savings */}
        <div
          style={{
            background: C.accentSoft09,
            border: `1px solid ${C.accentBorder}`,
            borderRadius: 16,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ font: mono(700, 20), color: C.accent, whiteSpace: 'nowrap' }}>
            {dSaveStr} €
          </div>
          <div style={{ color: '#aab2b7', fontSize: 12.5, lineHeight: 1.45 }}>
            {m.detail_saving_on_tank({ tank: app.tank, scope: scopeSave })}
          </div>
        </div>

      </div>

      {/* CTA — sticky so the primary action stays reachable on a fiche long
          enough to scroll (many fuels, many services), and pushed to the
          bottom edge by margin-top: auto when the fiche is shorter than the
          screen. No NavBar below it, so the bar carries the safe-area inset. */}
      <div style={stickyBarStyle()}>
        <button onClick={() => app.openInMaps(s)} style={ctaStyle()}>
          {m.detail_go_there()}
        </button>
      </div>
    </>
  );

  return (
    <div
      style={{
        overflow: 'auto',
        // Column layout so the CTA can be pushed to the bottom on a short
        // fiche (margin-top: auto) and stick there on a long one
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        ...(desktop
          ? {
              // The content of the floating panel slot (MapScreen owns the
              // glass, the width and the radius): transparent fill, the map
              // stays alive behind and the rail stays up — the browser Back
              // button still means Back.
              flex: 1,
              minHeight: 0,
              background: 'transparent',
            }
          : { position: 'absolute', inset: 0, zIndex: 1200, background: '#101214' }),
      }}
    >
      {body}
    </div>
  );
}
