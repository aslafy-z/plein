import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { C, mono } from '../theme';
import { ALL_FUELS, MAIN_FUELS, FUEL_LABELS, type FuelId, type Station } from '../data/types';
import { useApp, selectVisibleForFuel, effectivePrice, priceCents, roadReachOf } from '../state/store';
import { stationCountry } from '../data/stationIds';
import { fmtPrice, distLabel, agoLabel, durationLabel } from '../lib/format';
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
      aria-label="Carte de la station"
      style={{ position: 'absolute', inset: 0, background: C.mapBg }}
    />
  );
}

/** Cold load of /station/:id — the fiche has nothing to draw yet */
function StationDetailPending() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#101214',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: C.mut,
        fontSize: 13,
      }}
    >
      Chargement de la station…
    </div>
  );
}

export default function StationDetail() {
  const app = useApp();

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
    app.routeState.status === 'loading';

  useEffect(() => {
    if (!s && !pending) app.back();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, pending]);

  if (!s) return pending ? <StationDetailPending /> : null;

  const { distKm, driveMin } = roadReachOf(
    haversineKm(app.userPos, { lat: s.lat, lng: s.lng }),
    app.roadReach[s.id],
  );
  const placeChip = isRoute
    ? `KM ${routeSt!.kmAlong} · ${routeSt!.detourMin === 0 ? 'sans détour' : `détour +${routeSt!.detourMin} min`}`
    : `${distLabel(distKm)} · ${durationLabel(driveMin)}`;

  // Fuels to display: any priced fuel + always the main fuels
  const shownFuels = ALL_FUELS.filter((f) => s.prices[f] != null || MAIN_FUELS.includes(f));

  // Comparison set per fuel: stations along the route, or the stations
  // passing the current filters around the user — the SAME set the list
  // and map derive their numbers from.
  const comparables = (f: FuelId) =>
    (isRoute ? app.routeState.stations : selectVisibleForFuel(app, f))
      .filter((x) => x.prices[f] != null)
      .map((x) => x.prices[f]!.value);

  const minFor = (f: FuelId): number | null => {
    const values = comparables(f);
    return values.length ? Math.min(...values) : null;
  };

  const scopeLow = isRoute ? '▼ le + bas du trajet' : '▼ le + bas dans le rayon';
  const scopeSave = isRoute ? 'vs le + cher du trajet' : 'vs la plus chère dans le rayon';

  const maxForCurrentFuel = (() => {
    const values = comparables(app.fuel);
    return values.length ? Math.max(...values) : null;
  })();

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

  const activeSource = isRoute
    ? (app.routeState.fellBack ? 'demo' : app.sourceId)
    : app.stations.activeSource;
  // The auto source mixes countries — attribute per station (ids are prefixed)
  const stationSource = activeSource === 'auto' ? (stationCountry(s.id) ?? 'fra') : activeSource;
  const footerText =
    s.confirmations != null
      ? `Mis à jour ${agoLabel(mostRecent)} · confirmé par ${s.confirmations} conducteurs`
      : stationSource === 'fra'
        ? `Mis à jour ${agoLabel(mostRecent)} · source : prix-carburants.gouv.fr`
        : stationSource === 'esp'
          ? `Mis à jour ${agoLabel(mostRecent)} · source : geoportalgasolineras.es`
          : stationSource === 'and'
            ? `Mis à jour ${agoLabel(mostRecent)} · source : Govern d’Andorra (sig.govern.ad)`
            : `Mis à jour ${agoLabel(mostRecent)} · données de démonstration`;

  // Address line already shows the city; the third chip adds brand or context
  const thirdChip = s.brand ?? (s.highway ? 'Autoroute' : s.address ? null : s.city);
  const status = openStatus(s.hours);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#101214',
        zIndex: 1200,
        overflow: 'auto',
        // Column layout so the CTA can be pushed to the bottom on a short
        // fiche (margin-top: auto) and stick there on a long one
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header mini-map */}
      <div style={{ position: 'relative', height: 160, flexShrink: 0, background: C.mapBg }}>
        <StationMiniMap station={s} />
        <button
          onClick={() => {
            app.setSearchArea({ lat: s.lat, lng: s.lng }, s.name);
            // …with THIS station selected on the map (highlighted pin + card)
            app.setFocusStation(s.id);
            app.go('map');
          }}
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
          Voir sur la carte ›
        </button>
        <button
          onClick={() => app.back()}
          aria-label="Retour"
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
          aria-label="Partager la station"
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
          onClick={() =>
            app.toggleFavorite({
              id: s.id,
              name: s.name,
              init: s.init,
              city: s.city,
              lat: s.lat,
              lng: s.lng,
            })
          }
          aria-label={app.isFavorite(s.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
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

      <div style={{ padding: '18px 20px 8px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Title + chips */}
        <div>
          <div style={{ color: C.ink, fontSize: 21, fontWeight: 700 }}>{s.name}</div>
          {s.address && (
            <div style={{ color: C.mut, fontSize: 13, marginTop: 4 }}>
              {s.address}
              {s.cp || s.city ? ` · ${[s.cp, s.city].filter(Boolean).join(' ')}` : ''}
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
                {status.label}
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
            const min = minFor(f);
            let note = '';
            let noteColor: string = C.mut;
            if (price == null) {
              note = 'non distribué';
            } else if (min != null && priceCents(price) <= priceCents(min)) {
              // Cent precision, like everywhere: a station reading the same
              // displayed price as the minimum IS the minimum for the user
              note = scopeLow;
              noteColor = C.accent;
            } else if (min != null) {
              note = `+${fmtPrice((priceCents(price) - priceCents(min)) / 100)} vs le + bas`;
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
                  {FUEL_LABELS[f]}
                </span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ color: noteColor, fontSize: 11.5, fontWeight: 600, display: 'block' }}>
                    {note}
                  </span>
                  {s.prices[f]?.updatedAt && (
                    <span style={{ color: C.faint, fontSize: 10.5, display: 'block', marginTop: 1 }}>
                      MàJ {agoLabel(s.prices[f]?.updatedAt)}
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
            Services
          </div>
          {s.services.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {s.services.map((sv, i) => (
                <span
                  key={`${sv}-${i}`}
                  style={{
                    background: C.surface2,
                    color: C.body,
                    fontSize: 13,
                    padding: '8px 13px',
                    borderRadius: 16,
                    border: `1px solid ${C.border09}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {sv}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ color: C.mut, fontSize: 13 }}>Aucun service renseigné</div>
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
            sur un plein de {app.tank} L {scopeSave}
          </div>
        </div>

      </div>

      {/* CTA — sticky so the primary action stays reachable on a fiche long
          enough to scroll (many fuels, many services), and pushed to the
          bottom edge by margin-top: auto when the fiche is shorter than the
          screen. The gradient keeps the content readable as it passes under. */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          marginTop: 'auto',
          padding: '14px 20px calc(18px + env(safe-area-inset-bottom, 0px))',
          background: 'linear-gradient(to top, #101214 62%, #10121400)',
        }}
      >
        <button
          onClick={() => app.openInMaps(s)}
          style={{
            width: '100%',
            background: C.accent,
            color: C.onAccent,
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 26,
            padding: '15px 0',
            textAlign: 'center',
          }}
        >
          Y aller
        </button>
      </div>
    </div>
  );
}
