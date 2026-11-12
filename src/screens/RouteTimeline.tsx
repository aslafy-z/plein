// The computed route as a timeline: header (trip, distance, strategy chips),
// then the road from departure to arrival in kilometre order — the fuel-stop
// PLAN (zero, one or several stops with the litres to buy at each), the
// browsable alternatives and the autonomy limit all sit on the one line, so
// where a station falls against the dry point is read off its position.
// Presentation of the READY state only — the route shell (RouteScreen) owns
// the stage, the sheet/panel this scrolls in, the computing/error states and
// the « Start the trip » CTA on its bottom edge.
//
// The stop cards keep their own presentation on purpose: they are a timeline
// with an « add to the trip » toggle, not the scannable rows ZoneList draws.
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { C, display, kicker, mono } from '../theme';
import { clockLabel, fmtDecimal, fmtPrice, durationLabel } from '../lib/format';
import { fuelLabel } from '../lib/labels';
import { useIsDesktop } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import { type RouteStation } from '../data/types';
import type { InfeasibleDiagnostics, RoutePlan } from '../lib/routeOptimizer';
import ShareIcon from '../components/ShareIcon';
import EditIcon from '../components/EditIcon';
import ActionPill, { ActionPills, actionPillInk } from '../components/ActionPill';
import {
  useApp,
  routeFromLabel,
  routeToLabel,
  selectRouteAnalysis,
  effectiveFuel,
  effectivePrice,
  type ArrivalEstimate,
  type PlanStopView,
  type RouteMode,
  type RouteState,
} from '../state/store';

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

/** Litres with locale decimals — one digit under 10 L, whole litres above */
export const litresLabel = (litres: number) => fmtDecimal(litres, litres < 10 ? 1 : 0);

/** Headline of the no-plan block: short of range, or short of the arrival floor */
export function infeasibleTitle(
  diag: InfeasibleDiagnostics | undefined,
  arrivalTankPct: number,
): string {
  return diag?.arrivalFloorUnmet
    ? m.ribbon_infeasible_arrival_title({ percent: arrivalTankPct })
    : m.ribbon_infeasible_title();
}

/** Why no plan exists — structured diagnostics become one clear sentence */
function infeasibleLabel(
  diag: InfeasibleDiagnostics | undefined,
  limitKm: number,
  arrivalTankPct: number,
): string {
  if (diag?.arrivalFloorUnmet) return m.ribbon_infeasible_arrival({ percent: arrivalTankPct });
  const km = Math.round(diag?.furthestReachableKm ?? limitKm);
  if (!diag || diag.noStationInRange) return m.ribbon_infeasible_no_station({ km });
  return m.ribbon_infeasible_gap({ km });
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
    case 'arrivalFloorUnmet':
      return m.ribbon_arrival_floor_unmet({ percent: arrival.percent });
    case 'direct':
      return m.ribbon_arrival_direct({ time: clockLabel(new Date(arrival.at)) });
  }
}

/**
 * One whole sentence for the polite live region — never assembled from
 * fragments, so a screen reader announces something that stands on its own.
 * The plan lands last: once the corridor stands and the matrix stage has
 * settled, the announcement is the plan itself, not the station count.
 */
export function stageSentence(s: RouteState, plan?: RoutePlan | null): string {
  if (s.geometry === 'loading') {
    return s.provisional ? m.ribbon_stage_provisional() : m.ribbon_computing();
  }
  if (s.geometry === 'error') {
    return s.route ? m.ribbon_stage_geometry_failed() : m.ribbon_error_fallback();
  }
  if (s.corridor === 'loading') return m.ribbon_stage_geometry();
  if (s.corridor === 'error') return m.ribbon_corridor_failed();
  if (s.corridor === 'ready') {
    if (s.stations.length === 0) return m.ribbon_stage_no_stations();
    if (s.matrix !== 'loading' && plan) {
      if (plan.status === 'direct') return m.ribbon_stage_plan_direct();
      if (plan.status === 'planned') return m.ribbon_stage_plan_stops({ count: plan.stops.length });
      return m.ribbon_stage_plan_infeasible();
    }
    return m.ribbon_stage_stations({ count: s.stations.length });
  }
  return '';
}

/** Amber strip: a stale result kept on screen, or a stage that failed */
export const noticeStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: C.warnSoft,
  border: `1px solid ${C.warnBorder30}`,
  borderRadius: 12,
  padding: '10px 14px',
  color: C.warnText,
  fontSize: 12.5,
  fontWeight: 700,
  lineHeight: 1.4,
} as const;

export const retryStyle = {
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
  <div
    key={`skeleton-${i}`}
    aria-hidden="true"
    style={{ position: 'relative', padding: '0 0 14px' }}
  >
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
      <div
        className="skeleton"
        style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }}
      />
    </div>
  </div>
);

/** Timeline endpoints — shared by the real timeline and the one still loading */
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

const arrivalNode = (place: string, sub: string, ref?: Ref<HTMLDivElement>) => (
  <div ref={ref} data-testid="route-arrival" style={{ position: 'relative' }}>
    <div
      style={{
        position: 'absolute',
        left: -24,
        top: 0,
        width: 14,
        height: 14,
        borderRadius: 4,
        // The destination wears warn everywhere — the route map's arrival
        // square, the range limit — so the timeline's square matches instead
        // of borrowing the text color (near-black on the light theme)
        background: C.warn,
      }}
    />
    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{m.ribbon_arrival({ place })}</div>
    <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>{sub}</div>
  </div>
);

/**
 * A cold computation has no geometry to draw yet, but it does know the trip
 * that was asked for. Showing that skeleton beats a bare sentence: the wait
 * looks like the result it is turning into, and nothing here is invented —
 * the endpoints are the user's own input and the range comes from the tank,
 * not from a route. The sentence still goes out through the live region.
 */
export function RouteAwaited() {
  const app = useApp();
  const desktop = useIsDesktop();
  const analysis = selectRouteAnalysis(app);
  return (
    <div style={{ position: 'relative', margin: '14px 22px 20px', paddingLeft: 26 }}>
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
      {departureNode(
        routeFromLabel(app),
        m.ribbon_departure_tank({ percent: app.startTankPct, km: analysis.autonomyKm }),
      )}
      {[0, 1, 2].map((i) => skeletonNode(i, !desktop))}
      {arrivalNode(routeToLabel(app), '')}
    </div>
  );
}

/** Where the tank runs dry on the timeline — between two stations, or after the last one */
const limitMarker = (limitKm: number, ref?: Ref<HTMLDivElement>) => (
  <div
    key="limit-marker"
    ref={ref}
    data-testid="limit-marker"
    style={{ position: 'relative', padding: '0 0 14px' }}
  >
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

export default function RouteTimeline() {
  const app = useApp();
  const desktop = useIsDesktop();
  const { fuel, tank, routeMode, routeState } = app;
  const analysis = selectRouteAnalysis(app);
  const route = routeState.route;
  // A displayed result is always labelled with the endpoints it was computed
  // for; only a screen with no result yet shows what is being requested.
  const fromLabel = route ? routeState.endpoints.from : routeFromLabel(app);
  const arrivalPlace = route ? routeState.endpoints.to : routeToLabel(app);

  // The rail is measured, not proportional: it ends ON the arrival square
  // and turns grey AT the range-limit dot, wherever the rows between them
  // put those two. A percentage of the column's height drew the dry point
  // between the wrong rows as soon as cards of different heights stacked up.
  const bodyRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const arrivalRef = useRef<HTMLDivElement>(null);
  const [rail, setRail] = useState<{ end: number; split: number | null } | null>(null);
  // The last values set, compared BEFORE calling setRail: the effect runs on
  // every commit, and even a no-op updater schedules a synchronous re-render
  // from a layout effect — enough to trip React's nested-update limit.
  const railRef = useRef(rail);
  const measureRail = useCallback(() => {
    const arrival = arrivalRef.current;
    if (!arrival) return;
    // Centres of the arrival square (14px at top 0) and the limit dot (10px
    // at top 5), in the body's coordinates
    const end = arrival.offsetTop + 7;
    const marker = markerRef.current;
    const split = marker ? marker.offsetTop + 10 : null;
    const last = railRef.current;
    if (last && last.end === end && last.split === split) return;
    railRef.current = { end, split };
    setRail(railRef.current);
  }, []);
  // Rows reorder without the column changing height (a strategy chip swaps
  // which station is the stop): re-measure after every commit, cheaply…
  useLayoutEffect(measureRail);
  // …and on reflow the commits do not see (a resized panel rewraps names).
  // The body mounts with the first route, so that is when to observe it.
  const hasRoute = route != null;
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const ro = new ResizeObserver(measureRail);
    ro.observe(body);
    return () => ro.disconnect();
  }, [measureRail, hasRoute]);

  const toggleStyle = (id: string, size: number) => {
    const inRun = !!app.plannedStops[id];
    return {
      width: size,
      height: size,
      borderRadius: '50%',
      background: inRun ? C.accent : 'transparent',
      color: inRun ? C.onAccent : C.mut,
      border: inRun ? `1.5px solid ${C.accent}` : `1.5px solid ${C.border20}`,
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

  // The minutes a stop adds, on the plan's own legs — routed when the matrix
  // answered. The load-time `detourMin` estimate only stands in for a station
  // the candidate set does not cover.
  const detourOf = (st: RouteStation) => analysis.detourMinById[st.id] ?? st.detourMin;

  // ── Plan stop card ──────────────────────────────────────────────────────────
  const planStopNode = (view: PlanStopView, index: number, count: number) => {
    const st = view.station;
    const inRun = !!app.plannedStops[st.id];
    return (
      <div key={st.id} data-testid="plan-stop" style={{ position: 'relative', padding: '0 0 14px' }}>
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
          {count > 1 ? index + 1 : '★'}
        </div>
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.accentBorderStrong}`,
            borderRadius: 16,
            padding: '14px 16px',
            color: C.ink,
            boxShadow: `0 10px 26px ${C.shadow35}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...kicker(C.accent), flex: 1 }}>
              {count > 1
                ? m.ribbon_plan_stop_index({ index: index + 1, count })
                : m.ribbon_recommended_stop()}
            </span>
            <span style={{ fontSize: 11, color: C.mut, whiteSpace: 'nowrap' }}>
              {m.ribbon_km_marker({ km: Math.round(st.kmAlong) })} · {detourLabel(detourOf(st))}
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
                {m.ribbon_plan_buy({
                  litres: litresLabel(view.stop.purchasedLitres),
                  cost: fmtPrice(view.stop.purchaseCostCents / 100),
                })}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ font: mono(700, 22), color: C.accent, whiteSpace: 'nowrap' }}>
                {fmtPrice(effectivePrice(st, fuel)?.value)} €
              </div>
              {/* Fuel of the SHOWN price — Unleaded 95 when E10 fell back on it */}
              <div style={{ fontSize: 11, color: C.mut, whiteSpace: 'nowrap' }}>
                {m.sheet_per_litre({ fuel: fuelLabel(effectiveFuel(st, fuel) ?? fuel) })}
              </div>
            </div>
          </button>
          {/* « Go there » is the station alone — a secondary action now
              that « Start the trip » (the sheet's CTA) hands over the whole
              itinerary, this stop included */}
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
            <ActionPill onClick={() => app.openInMaps(st)} label={m.ribbon_go_there()} />
            <div style={{ flex: 1 }} />
            <button
              className="press"
              onClick={() => app.togglePlannedStop(st.id)}
              title={m.ribbon_add_stop_title()}
              aria-label={inRun ? m.ribbon_remove_stop_aria() : m.ribbon_add_stop_aria()}
              style={toggleStyle(st.id, 34)}
            >
              {inRun ? '✓' : '+'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Alternative: a compact row on the line ─────────────────────────────────
  // Lighter than a plan stop on purpose — a hollow dot and no frame — so the
  // plan's cards stay the headline while the alternatives sit at their km.
  const plainNode = (st: RouteStation) => {
    const inRun = !!app.plannedStops[st.id];
    return (
      <div
        key={st.id}
        data-testid="plan-alternative"
        style={{ position: 'relative', padding: '0 0 14px' }}
      >
        <div
          style={{
            position: 'absolute',
            left: -24,
            top: 13,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: C.bg,
            border: `3px solid ${C.faint}`,
          }}
        />
        <div
          style={{
            borderRadius: 12,
            padding: '4px 0 4px 2px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <button
            onClick={() => app.openStation(st.id)}
            style={{ flex: 1, minWidth: 0, cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ fontSize: 11.5, color: C.mut, fontWeight: 700 }}>
              {m.ribbon_km_marker({ km: Math.round(st.kmAlong) })} · {detourLabel(detourOf(st))}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: C.body,
                marginTop: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {st.name}
            </div>
          </button>
          <div style={{ font: mono(700, 15), color: C.body, whiteSpace: 'nowrap' }}>
            {fmtPrice(effectivePrice(st, fuel)?.value)} €
          </div>
          <button
            className="press"
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

  if (!route) return null;

  const plan = analysis.plan;
  const limitPct = Math.max(8, Math.min(92, (analysis.limitKm / route.distanceKm) * 100));

  // The road in kilometre order: the plan's stops, the alternatives and the
  // dry point on one line. A station AT the limit is still reachable, so it
  // sorts before the marker; the sort is stable, so equal kms keep the plan
  // ahead of an alternative.
  const count = analysis.planStops.length;
  const onLine: { km: number; rank: number; node: ReactNode }[] = [];
  if (plan?.status === 'planned') {
    analysis.planStops.forEach((view, i) =>
      onLine.push({ km: view.station.kmAlong, rank: 0, node: planStopNode(view, i, count) }),
    );
  }
  for (const st of analysis.alternatives) {
    onLine.push({ km: st.kmAlong, rank: 1, node: plainNode(st) });
  }
  if (analysis.needsStop) {
    onLine.push({ km: analysis.limitKm, rank: 2, node: limitMarker(analysis.limitKm, markerRef) });
  }
  onLine.sort((a, b) => a.km - b.km || a.rank - b.rank);

  // Measured once laid out; the proportional split only stands in for the
  // first paint. No dry point on the line → the whole road is within range.
  const railTop = 8;
  const railStyle = rail
    ? {
        top: railTop,
        height: Math.max(0, rail.end - railTop),
        background:
          rail.split != null
            ? `linear-gradient(${C.accent} 0 ${rail.split - railTop}px, ${C.toggleOff} ${rail.split - railTop}px)`
            : analysis.needsStop
              ? `linear-gradient(${C.accent} 0 ${limitPct}%, ${C.toggleOff} ${limitPct}%)`
              : C.accent,
      }
    : {
        top: railTop,
        bottom: railTop,
        background: `linear-gradient(${C.accent} 0 ${limitPct}%, ${C.toggleOff} ${limitPct}%)`,
      };

  return (
    <div style={{ padding: '16px 0 20px' }}>
      {/* Header */}
      <div style={{ padding: '0 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              ...kicker(),
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {m.ribbon_header()}
          </span>
          <ActionPills>
            {/* The URL already carries the trip, but an installed PWA has no
                address bar to copy it from — same share path as the map view.
                Icon-only: a labelled pill squeezes the Catalan eyebrow. */}
            <ActionPill
              onClick={() => app.shareRoute()}
              aria-label={m.ribbon_share_aria()}
              icon={<ShareIcon color={actionPillInk('accent')} size={15} />}
            />
            {/* The endpoints are editable in place above the map — this is
                the way back to the preferences and the tank */}
            <ActionPill
              onClick={() => app.editRoute()}
              label={m.ribbon_edit()}
              icon={<EditIcon color={actionPillInk('accent')} size={14} />}
            />
          </ActionPills>
        </div>
        <div style={{ ...display(22), marginTop: 4 }}>
          {fromLabel} → {arrivalPlace}
        </div>
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
          {plan?.status === 'planned' &&
            analysis.purchaseLitres != null &&
            analysis.purchaseCostCents != null && (
              <>
                <span>·</span>
                <span>
                  {m.ribbon_trip_purchase({
                    litres: litresLabel(analysis.purchaseLitres),
                    cost: fmtPrice(analysis.purchaseCostCents / 100),
                  })}
                </span>
                {/* The reserve rule makes plans arrive with different amounts
                    left in the tank — without this figure, a plan that buys
                    litres it delivers at the destination reads as « more
                    expensive » than one arriving near empty */}
                {analysis.destinationFuelLitres != null && (
                  <>
                    <span>·</span>
                    <span>
                      {m.ribbon_fuel_at_destination({
                        litres: litresLabel(analysis.destinationFuelLitres),
                      })}
                    </span>
                  </>
                )}
              </>
            )}
        </div>
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
                className="press"
                onClick={() => app.setRouteMode(k)}
                aria-pressed={active}
                style={{
                  background: active ? C.accent : 'transparent',
                  color: active ? C.onAccent : C.body,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '7px 11px',
                  borderRadius: 16,
                  border: active ? `1px solid ${C.accent}` : `1px solid ${C.border15}`,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition:
                    'background .25s var(--ease-snap), border-color .25s var(--ease-snap), color .25s var(--ease-snap), transform .16s var(--ease-snap)',
                }}
              >
                {strategyLabel(k)}
              </button>
            );
          })}
        </div>
        {/* Routed matrix settled without cells → the plan runs on geometric
            estimates. Quiet while the matrix is still loading: flashing the
            notice before the answer had a chance to land would cry wolf. */}
        {analysis.quality === 'estimated' && routeState.matrix !== 'loading' && (
          <div style={{ fontSize: 11.5, color: C.mut, marginTop: 2 }} data-testid="plan-estimated">
            {m.ribbon_estimated_notice()}
          </div>
        )}
      </div>

      {/* A result for older inputs, or a failed recompute, stays on screen —
          but never silently: it is labelled and, when failed, retryable. */}
      {routeState.geometry === 'error' ? (
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

      {/* Timeline body */}
      <div ref={bodyRef} style={{ position: 'relative', margin: '14px 22px 0', paddingLeft: 26 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 7,
            width: 4,
            borderRadius: 2,
            ...railStyle,
          }}
        />

        {/* Departure */}
        {departureNode(
          fromLabel,
          m.ribbon_departure_tank({ percent: app.startTankPct, km: analysis.autonomyKm }),
        )}

        {/* The plan — placeholders while the corridor runs, retry when it
            failed, then the direct / stops / infeasible states */}
        {routeState.corridor === 'loading' && !plan ? (
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
        ) : (
          <>
            {plan?.status === 'direct' && (
              <div style={{ position: 'relative', padding: '0 0 14px' }} data-testid="plan-direct">
                <div
                  style={{
                    background: C.accentSoft10,
                    border: `1px solid ${C.accentBorder30}`,
                    borderRadius: 14,
                    padding: '12px 16px',
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.accent }}>
                    {m.ribbon_no_stop_needed()}
                  </div>
                  {analysis.destinationFuelLitres != null && (
                    <div style={{ fontSize: 12, color: C.mut, marginTop: 3 }}>
                      {m.ribbon_fuel_at_destination({
                        litres: litresLabel(analysis.destinationFuelLitres),
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
            {plan?.status === 'infeasible' && (
              <div
                style={{ position: 'relative', padding: '0 0 14px' }}
                data-testid="plan-infeasible"
              >
                <div
                  style={{
                    background: C.card,
                    border: `1px solid ${C.warn}`,
                    borderRadius: 14,
                    padding: '12px 16px',
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.warn }}>
                    {infeasibleTitle(plan.diagnostics, app.arrivalTankPct)}
                  </div>
                  <div style={{ fontSize: 12, color: C.mut, marginTop: 3, lineHeight: 1.45 }}>
                    {infeasibleLabel(plan.diagnostics, analysis.limitKm, app.arrivalTankPct)}
                  </div>
                </div>
              </div>
            )}
            {onLine.map((e) => e.node)}
            {routeState.corridor === 'ready' && routeState.stations.length === 0 && (
              <div
                style={{ position: 'relative', padding: '0 0 14px', fontSize: 12.5, color: C.mut }}
              >
                {m.ribbon_no_stops()}
              </div>
            )}
            {analysis.invalidPlannedStopIds.length > 0 && (
              <div style={{ position: 'relative', padding: '0 0 14px', fontSize: 12, color: C.warn }}>
                {m.ribbon_manual_stops_invalid()}
              </div>
            )}
          </>
        )}

        {/* Arrival */}
        {arrivalNode(arrivalPlace, arrivalLabel(analysis.arrival), arrivalRef)}
      </div>
    </div>
  );
}
