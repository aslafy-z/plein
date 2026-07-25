import type { ReactNode } from 'react';
import { C, mono } from '../theme';
import { clockLabel, fmtPrice, durationLabel } from '../lib/format';
import { fuelLabel } from '../lib/labels';
import { m } from '../paraglide/messages.js';
import { type RouteStation } from '../data/types';
import {
  useApp,
  routeFromLabel,
  selectRouteAnalysis,
  effectiveFuel,
  effectivePrice,
  type ArrivalEstimate,
  type RecommendationReason,
  type RouteMode,
} from '../state/store';
import RouteMap from '../components/RouteMap';

const STRATEGIES: RouteMode[] = ['balanced', 'price', 'detour'];

function strategyLabel(mode: RouteMode): string {
  switch (mode) {
    case 'balanced':
      return m.ribbon_strategy_balanced();
    case 'price':
      return m.ribbon_strategy_price();
    case 'detour':
      return m.ribbon_strategy_detour();
  }
}

const detourLabel = (detourMin: number) =>
  detourMin === 0 ? m.ribbon_no_detour() : m.ribbon_detour({ minutes: detourMin });

/** Why the ribbon crowns this stop — the analysis hands over data, not copy */
function recommendationLabel(reason: RecommendationReason | null): string {
  if (!reason) return '';
  switch (reason.kind) {
    case 'lowestPrice':
      return m.ribbon_reco_lowest_price({ saving: fmtPrice(reason.saving) });
    case 'noDetour':
      return m.ribbon_reco_no_detour();
    case 'minDetour':
      return m.ribbon_reco_min_detour({ minutes: reason.detourMin });
    case 'balanced':
      return m.ribbon_reco_balanced({ saving: fmtPrice(reason.saving) });
    case 'onlyStation':
      return m.ribbon_reco_only_station();
  }
}

function arrivalLabel(arrival: ArrivalEstimate | null): string {
  if (!arrival) return '';
  switch (arrival.kind) {
    case 'withStops':
      return m.ribbon_arrival_with_stops({
        count: arrival.stops,
        time: clockLabel(new Date(arrival.at)),
        extra: arrival.extraMin,
      });
    case 'autonomyShort':
      return m.ribbon_arrival_autonomy_short({ km: arrival.limitKm });
    case 'direct':
      return m.ribbon_arrival_direct({ time: clockLabel(new Date(arrival.at)) });
  }
}

/** Where the tank runs dry on the timeline — between two stops, or after the last one */
const limitMarker = (limitKm: number) => (
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
      {m.ribbon_autonomy_limit({ km: limitKm })}
    </div>
  </div>
);

export default function RouteRibbon() {
  const app = useApp();
  const { toText, fuel, tank, routeMode, routeState } = app;
  const fromLabel = routeFromLabel(app);
  const analysis = selectRouteAnalysis(app);
  const route = routeState.route;

  const toggleStyle = (id: string, size: number) => {
    const inRun = !!app.plannedStops[id];
    return {
      width: size,
      height: size,
      borderRadius: '50%',
      background: inRun ? C.accent : 'transparent',
      color: inRun ? C.onAccent : C.mut,
      border: inRun ? `1.5px solid ${C.accent}` : '1.5px solid rgba(255,255,255,.2)',
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
    const inRun = !!app.plannedStops[st.id];
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
              {m.ribbon_recommended_stop()}
            </span>
            <span style={{ fontSize: 11, color: C.mut, whiteSpace: 'nowrap' }}>
              {m.ribbon_km_marker({ km: st.kmAlong })} · {detourLabel(st.detourMin)}
            </span>
          </div>
          <button
            onClick={() => app.openStation(st.id)}
            aria-label={m.ribbon_station_aria({ station: st.name })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 8,
              width: '100%',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{st.name}</div>
              <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>
                {recommendationLabel(analysis.recoReason)}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ font: mono(700, 22), color: C.accent, whiteSpace: 'nowrap' }}>
                {fmtPrice(effectivePrice(st, fuel)?.value)} €
              </div>
              {/* Fuel of the SHOWN price — SP95 when E10 fell back on it */}
              <div style={{ fontSize: 11, color: C.mut, whiteSpace: 'nowrap' }}>
                {m.sheet_per_litre({ fuel: fuelLabel(effectiveFuel(st, fuel) ?? fuel) })}
              </div>
            </div>
          </button>
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
              {m.ribbon_go_there()}
            </button>
            <button
              onClick={() => app.togglePlannedStop(st.id)}
              title={m.ribbon_add_stop_title()}
              aria-label={inRun ? m.ribbon_remove_stop_aria() : m.ribbon_add_stop_aria()}
              style={toggleStyle(st.id, 40)}
            >
              {inRun ? '✓' : '+'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Plain stop ──────────────────────────────────────────────────────────────
  const plainNode = (st: RouteStation) => {
    const inRun = !!app.plannedStops[st.id];
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
            border: inRun ? '1.5px solid rgba(61,220,132,.4)' : `1px solid ${C.border}`,
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
              {m.ribbon_km_marker({ km: st.kmAlong })} · {detourLabel(st.detourMin)}
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.ink, marginTop: 2 }}>
              {st.name}
            </div>
          </button>
          <div style={{ font: mono(700, 17), color: C.ink, whiteSpace: 'nowrap' }}>
            {fmtPrice(effectivePrice(st, fuel)?.value)} €
          </div>
          <button
            onClick={() => app.togglePlannedStop(st.id)}
            title={m.ribbon_add_stop_title()}
            aria-label={inRun ? m.ribbon_remove_stop_aria() : m.ribbon_add_stop_aria()}
            style={toggleStyle(st.id, 32)}
          >
            {inRun ? '✓' : '+'}
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
          {routeState.error ?? m.ribbon_error_fallback()}
        </div>
        <button
          onClick={() => app.editRoute()}
          style={{ marginTop: 14, fontSize: 14, fontWeight: 700, color: C.accent, cursor: 'pointer' }}
        >
          {m.ribbon_edit_route()}
        </button>
      </div>
    );
  } else if (routeState.status !== 'ready' || !route) {
    body = (
      <div style={{ padding: '40px 22px', textAlign: 'center', fontSize: 13.5, color: C.mut }}>
        {m.ribbon_computing()}
      </div>
    );
  } else {
    const limitPct = Math.max(8, Math.min(92, (analysis.limitKm / route.distanceKm) * 100));

    const stopNodes: ReactNode[] = [];
    let markerDone = false;
    for (const st of analysis.stops) {
      if (analysis.needsStop && !markerDone && st.kmAlong > analysis.limitKm) {
        markerDone = true;
        stopNodes.push(limitMarker(analysis.limitKm));
      }
      stopNodes.push(st.id === analysis.recoId ? recoNode(st) : plainNode(st));
    }
    // Autonomy runs out after the last found stop → marker still belongs on the line
    if (analysis.needsStop && !markerDone) stopNodes.push(limitMarker(analysis.limitKm));

    const nStops = analysis.plannedStops.length;

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
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
            {m.ribbon_departure({ place: fromLabel })}
          </div>
          <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>
            {m.ribbon_departure_tank({ percent: app.startTankPct, km: analysis.autonomyKm })}
          </div>
        </div>

        {/* Stops */}
        {analysis.stops.length === 0 ? (
          <div style={{ position: 'relative', padding: '0 0 14px', fontSize: 12.5, color: C.mut }}>
            {m.ribbon_no_stops()}
          </div>
        ) : (
          stopNodes
        )}

        {/* Tour bar */}
        {nStops > 0 && (
          <div style={{ position: 'relative', padding: '0 0 16px' }}>
            <button
              onClick={() => app.openPlannedStopsInMaps()}
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
                {m.ribbon_selected_stops({ count: nStops })}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap' }}>
                {m.ribbon_start_run()}
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
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
            {m.ribbon_arrival({ place: toText })}
          </div>
          <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>
            {arrivalLabel(analysis.arrival)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {routeState.status === 'ready' && route && <RouteMap />}
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
            {m.ribbon_header()}
          </span>
          <button
            onClick={() => app.editRoute()}
            style={{ fontSize: 12.5, fontWeight: 700, color: C.accent, cursor: 'pointer' }}
          >
            {m.ribbon_edit()}
          </button>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginTop: 4 }}>
          {fromLabel} → {toText}
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
              {m.ribbon_distance_duration({
                km: Math.round(route.distanceKm),
                duration: durationLabel(route.durationMin),
              })}
            </span>
            <span>·</span>
            <span>{m.ribbon_fuel_tank({ fuel: fuelLabel(fuel), tank })}</span>
            {analysis.tripCost != null && analysis.tripLitres != null && (
              <>
                <span>·</span>
                <span>
                  {m.ribbon_trip_fuel({
                    litres: Math.round(analysis.tripLitres),
                    cost: fmtPrice(analysis.tripCost),
                  })}
                </span>
              </>
            )}
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
          {STRATEGIES.map((k) => {
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
                {strategyLabel(k)}
              </button>
            );
          })}
        </div>
      </div>

        {body}
      </div>
    </div>
  );
}
