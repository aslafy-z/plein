import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { C, floatingPanelStyle, mono } from '../theme';
import { clockLabel, fmtPrice, durationLabel } from '../lib/format';
import { fuelLabel } from '../lib/labels';
import { CONTENT_MAX_WIDTH, PANEL_GAP, useIsDesktop } from '../lib/layout';
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
  type RouteState,
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

/**
 * One whole sentence for the polite live region — never assembled from
 * fragments, so a screen reader announces something that stands on its own.
 */
function stageSentence(s: RouteState): string {
  if (s.geometry === 'loading') {
    return s.provisional ? m.ribbon_stage_provisional() : m.ribbon_computing();
  }
  if (s.geometry === 'error') {
    return s.route ? m.ribbon_stage_geometry_failed() : m.ribbon_error_fallback();
  }
  if (s.corridor === 'loading') return m.ribbon_stage_geometry();
  if (s.corridor === 'error') return m.ribbon_corridor_failed();
  if (s.corridor === 'ready') {
    return s.stations.length === 0
      ? m.ribbon_stage_no_stations()
      : m.ribbon_stage_stations({ count: s.stations.length });
  }
  return '';
}

/** Amber strip: a stale result kept on screen, or a stage that failed */
const noticeStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'rgba(224,122,95,.12)',
  border: '1px solid rgba(224,122,95,.3)',
  borderRadius: 12,
  padding: '10px 14px',
  color: '#e8b3a4',
  fontSize: 12.5,
  fontWeight: 700,
  lineHeight: 1.4,
} as const;

const retryStyle = {
  color: C.accent,
  fontSize: 12.5,
  fontWeight: 800,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
} as const;

const skeletonBar = (width: number | string, height: number) => (
  <div className="skeleton" style={{ width, height, borderRadius: 5 }} />
);

/**
 * A stop the corridor stage has been asked for but has not returned yet. It
 * mirrors the real row — km line, name, price, add button — so the wait reads
 * as « a stop is coming here » instead of as an empty card. Widths vary per
 * row: three identical bars read as a rendering glitch.
 */
const skeletonNode = (i: number, sweep: boolean) => (
  <div key={`skeleton-${i}`} aria-hidden="true" style={{ position: 'relative', padding: '0 0 14px' }}>
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
      className={sweep ? 'skeleton-row' : undefined}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {skeletonBar(['42%', '52%', '46%'][i % 3], 10)}
        {skeletonBar(['68%', '58%', '75%'][i % 3], 13)}
      </div>
      {skeletonBar(52, 16)}
      <div className="skeleton" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
    </div>
  </div>
);

/** Timeline endpoints — shared by the real ribbon and the one still loading */
const departureNode = (place: string, sub: string) => (
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
      {m.ribbon_departure({ place })}
    </div>
    <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>{sub}</div>
  </div>
);

const arrivalNode = (place: string, sub: string) => (
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
    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{m.ribbon_arrival({ place })}</div>
    <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>{sub}</div>
  </div>
);

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
  const desktop = useIsDesktop();
  const { toText, fuel, tank, routeMode, routeState } = app;
  const analysis = selectRouteAnalysis(app);
  const route = routeState.route;
  // The map and the header hang off the geometry alone: they appear at the
  // geometry stage instead of at the final commit, so the layout stops
  // swapping under the user when the stations land.
  const hasRoute = route != null;
  // A displayed result is always labelled with the endpoints it was computed
  // for; only a screen with no result yet shows what is being requested.
  const fromLabel = route ? routeState.endpoints.from : routeFromLabel(app);
  const arrivalPlace = route ? routeState.endpoints.to : toText;
  const tankLabel = m.ribbon_departure_tank({
    percent: app.startTankPct,
    km: analysis.autonomyKm,
  });

  // The floating timeline's real width (PANEL_WIDTH is a clamp) + margins,
  // measured so the route map can pad its fits past it — same slot geometry
  // as the map screen's panel
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelInset, setPanelInset] = useState(0);
  useLayoutEffect(() => {
    if (!desktop || !hasRoute) {
      setPanelInset(0);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const measure = () => setPanelInset(el.offsetWidth + PANEL_GAP * 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [desktop, hasRoute]);

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

  // ── Body ────────────────────────────────────────────────────────────────────
  // Everything below hangs off `route`, not off a global status: once the
  // geometry stage has committed, the timeline is drawn even though the
  // corridor stage is still running or has failed. Only a cold computation —
  // nothing ever committed — gets the full-screen spinner or error.
  let body: ReactNode;
  if (!route) {
    body =
      routeState.geometry === 'error' ? (
        <div style={{ padding: '40px 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5 }}>
            {routeState.geometryError ?? m.ribbon_error_fallback()}
          </div>
          <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 14 }}>
            <button onClick={() => app.retryRoute()} style={{ ...retryStyle, fontSize: 14 }}>
              {m.ribbon_retry()}
            </button>
            <button
              onClick={() => app.editRoute()}
              style={{ fontSize: 14, fontWeight: 700, color: C.mut, cursor: 'pointer' }}
            >
              {m.ribbon_edit_route()}
            </button>
          </div>
        </div>
      ) : (
        // A cold computation has no geometry to draw yet, but it does know the
        // trip that was asked for. Showing that skeleton beats a bare sentence:
        // the wait looks like the result it is turning into, and nothing here
        // is invented — the endpoints are the user's own input and the range
        // comes from the tank, not from a route. The sentence still goes out
        // through the live region.
        <div style={{ position: 'relative', margin: '14px 22px 0', paddingLeft: 26 }}>
          <div
            style={{
              position: 'absolute',
              left: 7,
              top: 8,
              bottom: 8,
              width: 4,
              borderRadius: 2,
              background: C.toggleOff,
            }}
          />
          {departureNode(fromLabel, tankLabel)}
          {[0, 1, 2].map((i) => skeletonNode(i, !desktop))}
          {arrivalNode(arrivalPlace, '')}
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
        {departureNode(fromLabel, tankLabel)}

        {/* Stops — placeholders while the corridor runs, retry when it failed */}
        {routeState.corridor === 'loading' ? (
          [0, 1, 2].map((i) => skeletonNode(i, !desktop))
        ) : routeState.corridor === 'error' ? (
          <div style={{ position: 'relative', padding: '0 0 14px' }}>
            <div style={noticeStyle}>
              <span style={{ flex: 1 }}>
                {routeState.corridorError ?? m.ribbon_corridor_failed()}
              </span>
              <button onClick={() => app.retryCorridor()} style={retryStyle}>
                {m.ribbon_retry()}
              </button>
            </div>
          </div>
        ) : analysis.stops.length === 0 ? (
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
        {arrivalNode(arrivalPlace, arrivalLabel(analysis.arrival))}
      </div>
    );
  }

  // The timeline: header, strategy chips, then the stops. Above the corridor
  // map on a phone, docked beside it on a window.
  const timeline = (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '16px 0 20px',
        boxSizing: 'border-box',
        // While the route is still computing there is no map to sit next to,
        // so the timeline gets the whole region — as a reading column, not
        // a header stretched across it
        ...(desktop && !hasRoute
          ? { maxWidth: CONTENT_MAX_WIDTH, width: '100%', margin: '0 auto' }
          : null),
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
          {fromLabel} → {arrivalPlace}
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
            gap: 6,
            marginTop: 14,
            marginBottom: 6,
            flexWrap: 'wrap',
          }}
        >
          {/* Tight enough that the three of them hold one line at the
              panel's usual widths — wrapping stays the floor's fallback */}
          {STRATEGIES.map((k) => {
            const active = routeMode === k;
            return (
              <button
                key={k}
                onClick={() => app.setRouteMode(k)}
                style={{
                  background: active ? C.accent : 'transparent',
                  color: active ? C.onAccent : C.body,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '7px 11px',
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

      {/* One polite region, whole sentences, for every stage transition */}
      <div className="sr-only" role="status" aria-live="polite">
        {stageSentence(routeState)}
      </div>

      {/* A result for older inputs, or a failed recompute, stays on screen —
          but never silently: it is labelled and, when failed, retryable. */}
      {route && routeState.geometry === 'error' ? (
        <div style={{ margin: '12px 22px 0', ...noticeStyle }}>
          <span style={{ flex: 1 }}>{m.ribbon_geometry_failed_notice()}</span>
          <button onClick={() => app.retryRoute()} style={retryStyle}>
            {m.ribbon_retry()}
          </button>
        </div>
      ) : routeState.provisional ? (
        <div style={{ margin: '12px 22px 0', ...noticeStyle }}>
          <span style={{ flex: 1 }}>{m.ribbon_provisional_notice()}</span>
        </div>
      ) : null}

      {body}
    </div>
  );

  if (!desktop) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {hasRoute && <RouteMap />}
        {timeline}
      </div>
    );
  }

  // With a route: the corridor map takes the whole stage and the timeline
  // floats over it — the same slot the map screen gives its zone panel.
  // Without one (computing, error), there is no map to ride: the timeline
  // reads as a centered column instead.
  if (!hasRoute) {
    return <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{timeline}</div>;
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
        background: C.mapBg,
      }}
    >
      <RouteMap fill leftInset={panelInset} />
      <div ref={panelRef} style={floatingPanelStyle}>
        {timeline}
      </div>
    </div>
  );
}
