// The route — ONE shell from setup to results, both arrangements of it. The
// map fills the stage from the first frame; the departure and arrival fields
// float over its top edge like the map tab's search bar; the form, the
// computing state, the error and the timeline swap INSIDE the bottom sheet
// (phone) or the floating glass panel (desktop). Nothing about the screen
// moves between setting a trip up, computing it and reading the results —
// this is MapScreen's composition generalized, not a new invention.
//
// Which content is up is status-driven: the setup form whenever no computed
// route stands (`routeReady` drops the moment an endpoint changes, so picking
// a new destination over a finished route swaps the panel back to the form —
// no silent recompute), the timeline / computing / error states otherwise.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { C, ctaStyle, display, floatingPanelStyle, kicker, mono } from '../theme';
import type { GeocodeResult } from '../data/types';
import { fmtPrice, durationLabel } from '../lib/format';
import { fuelLabel } from '../lib/labels';
import { PANEL_GAP, useIsDesktop, usePanelInset } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import {
  useApp,
  routeFromLabel,
  routeToLabel,
  selectCanPickCurrentPosition,
  selectRouteAnalysis,
  effectivePrice,
} from '../state/store';
import RouteMap from '../components/RouteMap';
import PlaceField from '../components/PlaceField';
import SheetShell from '../components/SheetShell';
import RouteTimeline, {
  RouteAwaited,
  litresLabel,
  retryStyle,
  stageSentence,
} from './RouteTimeline';
import StationDetail from './StationDetail';

/** Same cap as the map screen's overlay: fields dragged across a window are
    unreadable, and the width belongs to the map */
const OVERLAY_MAX_WIDTH = 460;

/** The endpoint row holds TWO fields where the map's overlay holds one, so it
    gets its own cap rather than the map's: half of 460 is narrower than half a
    phone line, and the dropdown attached under a field inherits that width. */
const ENDPOINTS_MAX_WIDTH = 720;

type Phase = 'form' | 'computing' | 'error' | 'ready';

/** The departure and arrival fields — the map's search field twice, with the
    route's own icons and write-through semantics. They are always on screen,
    over the map, in both arrangements and every phase. */
function RouteFields() {
  const app = useApp();
  // Where the user stands is a place their own search can offer — into either
  // endpoint, and into only one at a time (a trip from here to here is not a
  // trip). The rule is one selector, so the two fields cannot disagree.
  const canPickPosition = selectCanPickCurrentPosition(app);

  const fromIcon = (
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        border: `3px solid ${C.accent}`,
        flexShrink: 0,
      }}
    />
  );
  const toIcon = (
    <div style={{ width: 12, height: 12, borderRadius: 3, background: C.warn, flexShrink: 0 }} />
  );

  // The screen owes its vertical space to the map, on a phone as on a window:
  // the two endpoints share ONE line — departure on the left, destination on
  // the right — instead of stacking two boxes over the corridor. They are
  // halves of the same line, so each takes exactly half of it (`flex: 1 1 0`,
  // never `1 1 auto`: a long remembered label would otherwise eat the other
  // endpoint's width) and ellipsizes its own value; the two icons are what
  // says which is which. The row's WIDTH is the caller's call — the slot it
  // sits in knows how much of the map it may cover.
  const half: CSSProperties = { flex: '1 1 0', minWidth: 0 };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div data-testid="route-endpoint-from" style={half}>
        <PlaceField
          target="routeFrom"
          value={routeFromLabel(app)}
          // « My position » is a value, not text to edit around: the field
          // edits as empty, and an empty field means « wherever I am » again
          // as soon as it settles.
          editValue={app.fromIsCurrentPosition ? '' : undefined}
          placeholder={m.route_from_placeholder()}
          title={m.route_from_field_title()}
          icon={fromIcon}
          onChangeText={(text) =>
            text.trim() ? app.setFrom(text) : app.useCurrentPositionAsStart()
          }
          onPick={(r: GeocodeResult) => app.setFrom(r.label, r.point)}
          onClear={
            app.fromIsCurrentPosition ? undefined : () => app.useCurrentPositionAsStart()
          }
          onPickCurrentPosition={
            canPickPosition ? () => app.useCurrentPositionAsStart() : undefined
          }
          clearAria={m.route_from_clear_aria()}
          emptyHint={m.route_search_hint()}
        />
      </div>
      <div data-testid="route-endpoint-to" style={half}>
        <PlaceField
          target="routeTo"
          value={routeToLabel(app)}
          // Same as the departure's: « My position » is a value the field
          // carries, not text to edit around
          editValue={app.toIsCurrentPosition ? '' : undefined}
          placeholder={m.route_to_placeholder()}
          title={m.route_to_field_title()}
          icon={toIcon}
          onChangeText={(text) => app.setTo(text)}
          // Picking a destination IS the intent: the comparison starts right
          // away (the departure is already resolved or geocodes in the same
          // breath) — no second tap on the CTA. The staged pipeline keeps every
          // control live while it runs.
          pickNavigates
          onPick={(r: GeocodeResult) => {
            app.setTo(r.label, r.point);
            app.startRoute(r);
          }}
          // Picking the user's position is picking a destination: same intent,
          // same immediate compute. The point goes with the call — the store
          // has not committed it yet this tick.
          onPickCurrentPosition={
            canPickPosition
              ? () => {
                  app.useCurrentPositionAsDestination();
                  app.startRoute({ label: m.route_from_current_position(), point: app.userPos });
                }
              : undefined
          }
          onClear={
            app.toText.trim() || app.toIsCurrentPosition ? () => app.setTo('') : undefined
          }
          clearAria={m.route_to_clear_aria()}
          emptyHint={m.route_search_hint()}
        />
      </div>
    </div>
  );
}

/** One chip look for the route's setup controls, in its two homes: the form
    (transparent off-state on a card) and the phone's map overlay, where the
    `onMap` variant is the map tab's chip look — a transparent chip over map
    tiles is unreadable. */
function routeChipStyle(on: boolean, onMap: boolean): CSSProperties {
  return {
    background: on ? C.accent : onMap ? C.surface2 : 'transparent',
    color: on ? C.onAccent : C.body,
    fontSize: onMap ? 13 : 12.5,
    // Constant per variant: a weight that flips with the state changes the
    // label's width and the chip resizes under the finger
    fontWeight: onMap ? 600 : 700,
    padding: '8px 14px',
    borderRadius: onMap ? 18 : 16,
    border: on ? `1px solid ${C.accent}` : `1px solid ${onMap ? C.border09 : C.border15}`,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    pointerEvents: 'auto',
    // transform rides along for .press — an inline transition replaces the
    // class's own (same note as ctaStyle in theme.ts)
    transition:
      'background .25s var(--ease-snap), border-color .25s var(--ease-snap), color .25s var(--ease-snap), transform .16s var(--ease-snap)',
  };
}

/** The avoid-motorways / avoid-tolls toggles — one presentation, two homes.
    They sit in the setup form (desktop panel, expanded phone sheet) and, on a
    phone, ALSO ride the map overlay right under the endpoint fields: picking
    a destination starts the comparison immediately, so the preferences must
    be reachable before that pick, not buried behind a sheet expansion. */
function RoutePrefChips({ onMap = false }: { onMap?: boolean }) {
  const app = useApp();
  return (
    <>
      {(
        [
          [m.route_avoid_motorways(), app.avoidMotorway, app.setAvoidMotorway],
          [m.route_avoid_tolls(), app.avoidToll, app.setAvoidToll],
        ] as const
      ).map(([label, on, set]) => (
        // The state lives in the fill (and aria-pressed), never in the text:
        // a « ✓ » prefix grows the chip on toggle and the row jumps
        <button
          key={label}
          className="press"
          onClick={() => set(!on)}
          aria-pressed={on}
          style={routeChipStyle(on, onMap)}
        >
          {label}
        </button>
      ))}
    </>
  );
}

/** The setup form minus the fields (those float over the map now): the
    preference chips, the departure tank and the settings recap. */
function RouteForm({ withTitle }: { withTitle: boolean }) {
  const app = useApp();
  const { fuel, tank } = app;

  return (
    <div style={{ padding: withTitle ? '20px 22px 8px' : '4px 22px 8px' }}>
      {withTitle && (
        <>
          <div style={display(24)}>{m.route_setup_title()}</div>
          <div style={{ fontSize: 13, color: C.mut, marginTop: 4 }}>
            {m.route_setup_subtitle()}
          </div>
        </>
      )}

      {/* Route preferences */}
      <div style={{ display: 'flex', gap: 8, marginTop: withTitle ? 18 : 8, flexWrap: 'wrap' }}>
        <RoutePrefChips />
      </div>

      {/* Departure tank level — drives the autonomy line on the timeline.
          A horizontal slider inside a vertically-dragged sheet: the marker
          keeps the gesture engine's hands off it. */}
      <div
        data-sheet-no-drag=""
        style={{
          background: C.surface2,
          border: `1px solid ${C.border08}`,
          borderRadius: 14,
          padding: '12px 16px',
          marginTop: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>
            {m.route_start_tank()}
          </span>
          <span style={{ font: mono(700, 14), color: C.accent }}>{app.startTankPct} %</span>
        </div>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={app.startTankPct}
          onChange={(e) => app.setStartTankPct(+e.target.value)}
          style={{ width: '100%', cursor: 'pointer' }}
        />
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>
          {m.route_start_tank_hint()}
        </div>
      </div>

      {/* Info card */}
      <div
        style={{
          background: C.navBg,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: '12px 16px',
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, fontSize: 12.5, color: C.mut, lineHeight: 1.45 }}>
          <strong style={{ color: C.ink }}>{fuelLabel(fuel)}</strong> ·{' '}
          {m.route_settings_recap({ tank })}
        </div>
        <button
          onClick={() => app.go('settings')}
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: C.accent,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {m.route_settings_link()}
        </button>
      </div>
    </div>
  );
}

/** Cold geometry failure — nothing standable was ever committed. A failure
    OVER a standing route renders as a strip above the kept timeline instead. */
function RouteError() {
  const app = useApp();
  return (
    <div style={{ padding: '40px 22px', textAlign: 'center' }}>
      <div style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5 }}>
        {app.routeState.geometryError ?? m.ribbon_error_fallback()}
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
  );
}

/** What the collapsed sheet leads with, per phase — the recap during setup,
    the recommended stop once the route lands, the way ZoneCard leads the map
    sheet. Expanded is always the detail (the form, the timeline). */
function RouteLead({ phase }: { phase: Phase }) {
  const app = useApp();
  const analysis = selectRouteAnalysis(app);

  const kickerLine = (text: string, accent = false) => (
    <div style={{ ...kicker(accent ? C.accent : C.mut), marginBottom: 6 }}>{text}</div>
  );

  if (phase === 'ready') {
    const route = app.routeState.route;
    const plan = app.routeState.corridor === 'ready' ? analysis.plan : null;
    // The plan's headline only once a plan is actually known: between the
    // geometry and corridor commits the trip branch below covers the window.
    const first = plan?.status === 'planned' ? (analysis.planStops[0] ?? null) : null;
    if (first) {
      const count = analysis.planStops.length;
      return (
        <div>
          {kickerLine(
            count > 1
              ? m.ribbon_plan_stop_index({ index: 1, count })
              : m.ribbon_recommended_stop(),
            true,
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: C.ink,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {first.station.name}
              </div>
              <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>
                {m.ribbon_plan_buy({
                  litres: litresLabel(first.stop.purchasedLitres),
                  cost: fmtPrice(first.stop.purchaseCostCents / 100),
                })}
              </div>
            </div>
            <div style={{ font: mono(700, 22), color: C.accent, whiteSpace: 'nowrap' }}>
              {fmtPrice(effectivePrice(first.station, app.fuel)?.value)} €
            </div>
          </div>
        </div>
      );
    }
    if (plan?.status === 'direct' || plan?.status === 'infeasible') {
      const infeasible = plan.status === 'infeasible';
      return (
        <div>
          {kickerLine(m.ribbon_header())}
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>
            {app.routeState.endpoints.from} → {app.routeState.endpoints.to}
          </div>
          <div
            style={{
              fontSize: 12,
              color: infeasible ? C.warn : C.accent,
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            {infeasible ? m.ribbon_infeasible_title() : m.ribbon_no_stop_needed()}
          </div>
        </div>
      );
    }
    // The trip + distance branch — also the whole window between the geometry
    // and corridor commits, labelled with the endpoints the geometry was
    // computed for (a recompute keeps the previous trip under its own labels).
    return (
      <div>
        {kickerLine(m.ribbon_header())}
        <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>
          {route ? app.routeState.endpoints.from : routeFromLabel(app)} →{' '}
          {route ? app.routeState.endpoints.to : routeToLabel(app)}
        </div>
        {route && (
          <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>
            {m.ribbon_distance_duration({
              km: Math.round(route.distanceKm),
              duration: durationLabel(route.durationMin),
            })}
          </div>
        )}
      </div>
    );
  }

  if (phase === 'computing') {
    // A cold compute: the trip being awaited — the endpoints are the user's
    // own input and the range comes from the tank. Nothing invented: no
    // distance, no duration, no station.
    return (
      <div>
        {kickerLine(m.route_setup_title())}
        <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>
          {routeFromLabel(app)} → {routeToLabel(app)}
        </div>
        <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>
          {m.ribbon_departure_tank({ percent: app.startTankPct, km: analysis.autonomyKm })}
        </div>
      </div>
    );
  }

  return (
    <div>
      {kickerLine(m.route_setup_title())}
      <div style={{ fontSize: 13.5, color: phase === 'error' ? C.warn : C.mut }}>
        {phase === 'error'
          ? (app.routeState.geometryError ?? m.ribbon_error_fallback())
          : m.route_sheet_recap({ fuel: fuelLabel(app.fuel), percent: app.startTankPct })}
      </div>
    </div>
  );
}

export default function RouteScreen() {
  const app = useApp();
  const desktop = useIsDesktop();
  const { routeState } = app;

  // Desktop keeps the corridor map mounted under a stop's fiche: it renders
  // in the same panel, stacked under the timeline, the way the map screen
  // stacks a fiche under its zone list. A phone shows the fiche full screen
  // (App.tsx) — this screen is then not mounted at all.
  const fiche = desktop && app.screen === 'detail';

  // Status decides the content, never the layout. `routeReady` drops when an
  // endpoint changes, so editing a computed route swaps back to the form.
  // `ready` as soon as a route STANDS — the current key's or the previous
  // one's — so the timeline and the corridor stay up through a recompute; the
  // computing and error blocks only when nothing standable exists (a cold
  // trip). Stage detail (skeleton stops, provisional notice, per-stage retry)
  // is the timeline's own business.
  const showForm = app.screen === 'routeSetup' || !app.routeReady;
  const phase: Phase = showForm
    ? 'form'
    : routeState.route
      ? 'ready'
      : routeState.geometry === 'error'
        ? 'error'
        : 'computing';

  // The sheet overlays the stage; the map keeps the FULL stage size at all
  // times, exactly like the map screen (see MapScreen for the whole story).
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageH, setStageH] = useState(0);
  const [sheetInset, setSheetInset] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { panelRef, panelInset } = usePanelInset(desktop, fiche);
  const onCollapsedHeight = useCallback((h: number) => setSheetInset(h), []);

  // The submit acknowledges in place: the CTA goes busy while the addresses
  // geocode (the same spinner idiom as PlaceField), and `startRoute` guards
  // re-entry synchronously so a second tap cannot start a second pipeline.
  // « My position » as the destination carries no text — its point is what
  // says a destination is set.
  const canGo = (app.toText.trim().length > 0 || app.toIsCurrentPosition) && !app.geocoding;
  const cta = (
    <button
      className="press"
      onClick={() => app.startRoute()}
      disabled={!canGo}
      style={ctaStyle(canGo)}
    >
      {app.geocoding ? (
        <span
          className="spin"
          role="status"
          aria-label={m.route_geocoding_in_progress()}
          style={{ display: 'inline-block', lineHeight: 1 }}
        >
          ↻
        </span>
      ) : (
        m.route_compare_cta()
      )}
    </button>
  );

  const content =
    phase === 'form' ? (
      <RouteForm withTitle={desktop} />
    ) : phase === 'ready' ? (
      <RouteTimeline />
    ) : phase === 'computing' ? (
      <RouteAwaited />
    ) : (
      <RouteError />
    );

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* One polite region for the whole pipeline, whole catalog sentences,
          announced once per stage transition. Focus never moves. */}
      <div className="sr-only" role="status" aria-live="polite">
        {app.geocoding
          ? m.route_geocoding_in_progress()
          : phase === 'form'
            ? ''
            : stageSentence(routeState, selectRouteAnalysis(app).plan)}
      </div>
      <div
        ref={stageRef}
        style={{
          position: 'relative',
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          background: C.mapBg,
        }}
      >
        {/* Map area — always the full stage; the sheet (phone) and the
            floating panel (desktop) overlay it. The map is mounted once for
            the whole flow: setup handing over to the results must not throw
            the view away. */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <RouteMap
            bottomInset={desktop ? 0 : sheetInset}
            leftInset={desktop ? panelInset : 0}
          />

          {/* The endpoint fields — over the map's top edge, beside the panel
              on desktop, under the status bar otherwise. They split one line
              in both arrangements (see RouteFields); only how wide that line
              may run changes. 1010: dropdowns cover the map's floating
              controls (1000) while staying under the scrim (1050) and the
              sheet (1100). */}
          {desktop ? (
            <div
              style={{
                position: 'absolute',
                left: panelInset || undefined,
                right: 16,
                top: PANEL_GAP,
                zIndex: 1010,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  flex: `0 1 ${ENDPOINTS_MAX_WIDTH}px`,
                  minWidth: 240,
                  maxWidth: ENDPOINTS_MAX_WIDTH,
                }}
              >
                <RouteFields />
              </div>
            </div>
          ) : (
            <div
              style={{
                position: 'absolute',
                left: 16,
                right: 16,
                top: 14,
                maxWidth: OVERLAY_MAX_WIDTH,
                zIndex: 1010,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                pointerEvents: 'none',
              }}
            >
              <RouteFields />

              {/* The setup chips ride the overlay — the sheet's copy of the
                  form only shows once expanded, and picking a destination
                  computes right away, so the per-trip choices must be at hand
                  BEFORE the pick. The avoids toggle in place; the tank chip
                  is the map tab's radius-chip idiom — it names the value and
                  opens the sheet on the real control (the slider sits right
                  under the chips in the form). Once a route stands they all
                  retreat into the form: toggling one here would not recompute
                  the standing route, and a chip that silently stops matching
                  the itinerary on screen is a lie. */}
              {phase === 'form' && (
                <div
                  data-testid="route-pref-chips"
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                >
                  <RoutePrefChips onMap />
                  <button
                    onClick={() => setSheetOpen(true)}
                    title={m.route_start_tank()}
                    style={routeChipStyle(false, true)}
                  >
                    {m.route_tank_chip({ percent: app.startTankPct })}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop: the same floating glass panel slot the map screen uses.
            A stop's fiche stacks UNDER the timeline, so the next stop stays
            one click away while its details are read. */}
        {desktop && (
          <div ref={panelRef} data-testid="route-panel" style={floatingPanelStyle}>
            <div
              style={{
                flex: fiche ? '0 1 38%' : 1,
                minHeight: 0,
                overflowY: 'auto',
              }}
            >
              {content}
            </div>
            {fiche && (
              <div
                key={app.detailId ?? 'fiche'}
                className="sheet-swap"
                style={{
                  flex: '1 1 62%',
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  borderTop: `1px solid ${C.border12}`,
                }}
              >
                <StationDetail />
              </div>
            )}
            {phase === 'form' && !fiche && (
              // The CTA sticks to the panel's bottom edge, whatever the form
              // scrolls above it
              <div
                style={{ flexShrink: 0, padding: '14px 18px 18px', borderTop: `1px solid ${C.border}` }}
              >
                {cta}
              </div>
            )}
          </div>
        )}

        {/* Sheet open → the visible map dims and a tap on it closes the
            sheet. Phone only: the floating panel never needs pulling up. */}
        {!desktop && sheetOpen && (
          <button
            onClick={() => setSheetOpen(false)}
            aria-label={m.route_sheet_close_aria()}
            className="sheet-swap"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1050,
              background: C.scrimSoft,
              cursor: 'pointer',
            }}
          />
        )}

        {/* Phone: the bottom sheet — the map sheet's gesture engine with the
            route's content. Collapsed leads (recap / recommended stop), the
            CTA rides the bottom edge during setup, expanding reveals the
            whole form or the whole timeline. */}
        {!desktop && (
          <SheetShell
            stageH={stageH}
            onCollapsedHeight={onCollapsedHeight}
            expanded={sheetOpen}
            onExpandedChange={setSheetOpen}
            // The timeline runs longer than a screen — the route sheet opens
            // to the full stage (minus the shell's map peek strip)
            expandRatio={1}
            // The collapsed header changes with every pipeline commit; each
            // change landing instantly keeps the flap grabbable during a load
            instantContentResize
            hasBody
            expandAria={m.route_sheet_expand_aria()}
            collapseAria={m.route_sheet_collapse_aria()}
            header={(handle) => (
              <div style={{ padding: '0 20px 12px' }}>
                {handle}
                {/* Expanded past the form, the body opens on the timeline's
                    own trip header — repeating the lead right above it reads
                    as a doubled screen, not as a summary. The form keeps it:
                    its title and recap live here on a phone. */}
                {(!sheetOpen || phase === 'form') && <RouteLead phase={phase} />}
              </div>
            )}
            body={(scrollerRef, gestures) => (
              <div
                ref={scrollerRef}
                {...gestures}
                data-testid="route-sheet-body"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {content}
              </div>
            )}
            footer={
              phase === 'form' ? <div style={{ padding: '4px 16px 14px' }}>{cta}</div> : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
