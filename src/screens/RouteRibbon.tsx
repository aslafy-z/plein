import type { ReactNode } from 'react';
import { C, mono } from '../theme';
import { fmtPrice, durationLabel, plural } from '../lib/format';
import { FUEL_LABELS, type RouteStation } from '../data/types';
import { useApp, selectRouteAnalysis } from '../state/store';

const STRATEGIES = [
  ['compromis', 'Meilleur compromis'],
  ['prix', 'Prix le + bas'],
  ['detour', 'Détour min.'],
] as const;

const detourLabel = (detourMin: number) =>
  detourMin === 0 ? 'sans détour' : `détour +${detourMin} min`;

export default function RouteRibbon() {
  const app = useApp();
  const { fromText, toText, fuel, tank, routeMode, routeState } = app;
  const analysis = selectRouteAnalysis(app);
  const route = routeState.route;

  const toggleStyle = (id: string, size: number) => {
    const inTour = !!app.tour[id];
    return {
      width: size,
      height: size,
      borderRadius: '50%',
      background: inTour ? C.accent : 'transparent',
      color: inTour ? C.onAccent : C.mut,
      border: inTour ? `1.5px solid ${C.accent}` : '1.5px solid rgba(255,255,255,.2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: size >= 40 ? 17 : 15,
      fontWeight: 800,
      cursor: 'pointer',
      flexShrink: 0,
      boxSizing: 'border-box' as const,
    };
  };

  // ── Reco stop card ──────────────────────────────────────────────────────────
  const recoNode = (st: RouteStation) => {
    const inTour = !!app.tour[st.id];
    return (
      <div key={st.id} style={{ position: 'relative', padding: '0 0 14px' }}>
        <div
          style={{
            position: 'absolute',
            left: -27,
            top: 22,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: C.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: C.onAccent,
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          ★
        </div>
        <div
          style={{
            background: C.surface2,
            border: `1px solid ${C.accentBorderStrong}`,
            borderRadius: 16,
            padding: '14px 16px',
            color: C.ink,
            boxShadow: '0 10px 26px rgba(0,0,0,.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: C.accent,
                flex: 1,
              }}
            >
              Arrêt conseillé
            </span>
            <span style={{ fontSize: 11, color: C.mut, whiteSpace: 'nowrap' }}>
              KM {st.kmAlong} · {detourLabel(st.detourMin)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{st.name}</div>
              <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>{analysis.recoSub}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ font: mono(700, 22), color: C.accent, whiteSpace: 'nowrap' }}>
                {fmtPrice(st.prices[fuel]?.value)} €
              </div>
              <div style={{ fontSize: 11, color: C.mut, whiteSpace: 'nowrap' }}>
                {FUEL_LABELS[fuel]} / L
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
            <button
              onClick={() => app.openInMaps(st)}
              style={{
                flex: 1,
                background: C.accent,
                color: C.onAccent,
                fontSize: 13.5,
                fontWeight: 800,
                borderRadius: 20,
                padding: '11px 0',
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              Ouvrir dans Maps
            </button>
            <button
              onClick={() => app.toggleTour(st.id)}
              title="Ajouter à la tournée"
              aria-label={inTour ? 'Retirer de la tournée' : 'Ajouter à la tournée'}
              style={toggleStyle(st.id, 40)}
            >
              {inTour ? '✓' : '+'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Plain stop ──────────────────────────────────────────────────────────────
  const plainNode = (st: RouteStation) => {
    const inTour = !!app.tour[st.id];
    return (
      <div key={st.id} style={{ position: 'relative', padding: '0 0 14px' }}>
        <div
          style={{
            position: 'absolute',
            left: -24,
            top: 16,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: C.bg,
            border: `3px solid ${C.faint}`,
          }}
        />
        <div
          style={{
            background: C.surface,
            border: inTour ? '1.5px solid rgba(61,220,132,.4)' : `1px solid ${C.border}`,
            borderRadius: 14,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <button
            onClick={() => app.openStation(st.id)}
            style={{ flex: 1, minWidth: 0, cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ fontSize: 12, color: C.mut, fontWeight: 700 }}>
              KM {st.kmAlong} · {detourLabel(st.detourMin)}
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.ink, marginTop: 2 }}>
              {st.name}
            </div>
          </button>
          <div style={{ font: mono(700, 17), color: C.ink, whiteSpace: 'nowrap' }}>
            {fmtPrice(st.prices[fuel]?.value)} €
          </div>
          <button
            onClick={() => app.toggleTour(st.id)}
            title="Ajouter à la tournée"
            aria-label={inTour ? 'Retirer de la tournée' : 'Ajouter à la tournée'}
            style={toggleStyle(st.id, 32)}
          >
            {inTour ? '✓' : '+'}
          </button>
        </div>
      </div>
    );
  };

  // ── Body per status ─────────────────────────────────────────────────────────
  let body: ReactNode;
  if (routeState.status === 'error') {
    body = (
      <div style={{ padding: '40px 22px', textAlign: 'center' }}>
        <div style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5 }}>
          {routeState.error ?? 'Itinéraire indisponible.'}
        </div>
        <button
          onClick={() => app.editRoute()}
          style={{ marginTop: 14, fontSize: 14, fontWeight: 700, color: C.accent, cursor: 'pointer' }}
        >
          Modifier l'itinéraire
        </button>
      </div>
    );
  } else if (routeState.status !== 'ready' || !route) {
    body = (
      <div style={{ padding: '40px 22px', textAlign: 'center', fontSize: 13.5, color: C.mut }}>
        Calcul de l'itinéraire…
      </div>
    );
  } else {
    const limitPct = Math.max(8, Math.min(92, (analysis.limitKm / route.distanceKm) * 100));

    const stopNodes: ReactNode[] = [];
    let markerDone = false;
    for (const st of analysis.stops) {
      if (analysis.needsStop && !markerDone && st.kmAlong > analysis.limitKm) {
        markerDone = true;
        stopNodes.push(
          <div key="limit-marker" style={{ position: 'relative', padding: '0 0 14px' }}>
            <div
              style={{
                position: 'absolute',
                left: -22,
                top: 5,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: C.warn,
              }}
            />
            <div style={{ fontSize: 12, color: C.warn, fontWeight: 700 }}>
              ≈ KM {analysis.limitKm} — limite d'autonomie sans arrêt
            </div>
          </div>,
        );
      }
      stopNodes.push(st.id === analysis.recoId ? recoNode(st) : plainNode(st));
    }
    // Autonomy runs out after the last found stop → marker still belongs on the line
    if (analysis.needsStop && !markerDone) {
      stopNodes.push(
        <div key="limit-marker" style={{ position: 'relative', padding: '0 0 14px' }}>
          <div
            style={{
              position: 'absolute',
              left: -22,
              top: 5,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: C.warn,
            }}
          />
          <div style={{ fontSize: 12, color: C.warn, fontWeight: 700 }}>
            ≈ KM {analysis.limitKm} — limite d'autonomie sans arrêt
          </div>
        </div>,
      );
    }

    const nTour = analysis.tourStops.length;

    body = (
      <div style={{ position: 'relative', margin: '14px 22px 0', paddingLeft: 26 }}>
        <div
          style={{
            position: 'absolute',
            left: 7,
            top: 8,
            bottom: 8,
            width: 4,
            borderRadius: 2,
            background: `linear-gradient(${C.accent} 0 ${limitPct}%, ${C.toggleOff} ${limitPct}%)`,
          }}
        />

        {/* Departure */}
        <div style={{ position: 'relative', padding: '0 0 18px' }}>
          <div
            style={{
              position: 'absolute',
              left: -26,
              top: 2,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: C.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.onAccent }} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Départ · {fromText}</div>
          <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>
            Réservoir 70 % · autonomie ≈ {analysis.autonomyKm} km
          </div>
        </div>

        {/* Stops */}
        {analysis.stops.length === 0 ? (
          <div style={{ position: 'relative', padding: '0 0 14px', fontSize: 12.5, color: C.mut }}>
            Aucune station trouvée le long du trajet — élargissez les filtres.
          </div>
        ) : (
          stopNodes
        )}

        {/* Tour bar */}
        {nTour > 0 && (
          <div style={{ position: 'relative', padding: '0 0 16px' }}>
            <button
              onClick={() => app.openTourInMaps()}
              style={{
                width: '100%',
                background: C.accentSoft10,
                border: '1px solid rgba(61,220,132,.3)',
                borderRadius: 14,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.accent, textAlign: 'left' }}>
                {plural(nTour, 'arrêt')} sélectionné{nTour > 1 ? 's' : ''}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap' }}>
                Ouvrir la tournée dans Maps ›
              </span>
            </button>
          </div>
        )}

        {/* Arrival */}
        <div style={{ position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: -24,
              top: 0,
              width: 14,
              height: 14,
              borderRadius: 4,
              background: C.ink,
            }}
          />
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Arrivée · {toText}</div>
          <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>{analysis.arrivalLabel}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '16px 0 20px',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ padding: '0 22px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: C.mut,
              flex: 1,
            }}
          >
            Votre trajet
          </span>
          <button
            onClick={() => app.editRoute()}
            style={{ fontSize: 12.5, fontWeight: 700, color: C.accent, cursor: 'pointer' }}
          >
            Modifier
          </button>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginTop: 4 }}>
          {fromText} → {toText}
        </div>
        {route && (
          <div
            style={{
              display: 'flex',
              gap: 14,
              marginTop: 6,
              fontSize: 13,
              color: C.mut,
              flexWrap: 'wrap',
            }}
          >
            <span>
              {Math.round(route.distanceKm)} km · {durationLabel(route.durationMin)}
            </span>
            <span>·</span>
            <span>
              {FUEL_LABELS[fuel]} · réservoir {tank} L
            </span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 14,
            marginBottom: 6,
            flexWrap: 'wrap',
          }}
        >
          {STRATEGIES.map(([k, label]) => {
            const active = routeMode === k;
            return (
              <button
                key={k}
                onClick={() => app.setRouteMode(k)}
                style={{
                  background: active ? C.accent : 'transparent',
                  color: active ? C.onAccent : C.body,
                  fontSize: 12.5,
                  fontWeight: 700,
                  padding: '7px 13px',
                  borderRadius: 16,
                  border: active ? `1px solid ${C.accent}` : '1px solid rgba(255,255,255,.15)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {body}
    </div>
  );
}
