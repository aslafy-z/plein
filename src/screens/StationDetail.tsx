import { useEffect } from 'react';
import { C, mono } from '../theme';
import { ALL_FUELS, MAIN_FUELS, FUEL_LABELS, type FuelId } from '../data/types';
import { useApp, selectVisibleForFuel } from '../state/store';
import { fmtPrice, distLabel, agoLabel } from '../lib/format';
import { haversineKm } from '../lib/geo';

export default function StationDetail() {
  const app = useApp();

  const nearby = app.stations.data.find((x) => x.id === app.detailId);
  const routeSt = app.routeState.stations.find((x) => x.id === app.detailId);
  // Opened from the route ribbon (or only known along the route) → all
  // comparisons are route-relative, not home-radius-relative.
  const isRoute = routeSt != null && (app.prevScreen === 'route' || !nearby);
  const s = isRoute ? routeSt : (nearby ?? routeSt);

  useEffect(() => {
    if (!s) app.back();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  if (!s) return null;

  const distKm = haversineKm(app.userPos, { lat: s.lat, lng: s.lng });
  const driveMin = Math.max(1, Math.round(distKm * 2));
  const placeChip = isRoute
    ? `KM ${routeSt!.kmAlong} · ${routeSt!.detourMin === 0 ? 'sans détour' : `détour +${routeSt!.detourMin} min`}`
    : `${distLabel(distKm)} · ${driveMin} min`;

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

  const cur = s.prices[app.fuel]?.value;
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
  const footerText =
    s.confirmations != null
      ? `Mis à jour ${agoLabel(mostRecent)} · confirmé par ${s.confirmations} conducteurs`
      : activeSource === 'gouv'
        ? `Mis à jour ${agoLabel(mostRecent)} · source : prix-carburants.gouv.fr`
        : `Mis à jour ${agoLabel(mostRecent)} · données de démonstration`;

  const thirdChip = s.brand ?? s.city;

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: '#101214', zIndex: 1200, overflow: 'auto' }}
    >
      {/* Header photo placeholder */}
      <div
        style={{
          position: 'relative',
          height: 160,
          background: 'repeating-linear-gradient(45deg,#1a1f22 0 10px,#15191c 10px 20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            font: "500 11px ui-monospace,monospace",
            color: C.faint,
            background: '#101214cc',
            padding: '4px 8px',
            borderRadius: 6,
          }}
        >
          photo de la station
        </span>
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
          }}
        >
          ←
        </button>
      </div>

      <div style={{ padding: '18px 20px 26px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Title + chips */}
        <div>
          <div style={{ color: C.ink, fontSize: 21, fontWeight: 700 }}>{s.name}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                background: C.accentSoft14,
                color: C.accent,
                fontSize: 12,
                fontWeight: 700,
                padding: '5px 10px',
                borderRadius: 14,
                whiteSpace: 'nowrap',
              }}
            >
              Ouvert
            </span>
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
            } else if (min != null && price <= min + 0.0001) {
              note = scopeLow;
              noteColor = C.accent;
            } else if (min != null) {
              note = `+${fmtPrice(price - min)} vs le + bas`;
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
                <span style={{ color: noteColor, fontSize: 11.5, fontWeight: 600 }}>{note}</span>
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

        {/* CTA */}
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
          Ouvrir dans Google Maps
        </button>
      </div>
    </div>
  );
}
