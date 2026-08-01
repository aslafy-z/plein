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
import { C, ctaStyle, floatingPanelStyle, mono } from '../theme';
import type { GeocodeResult } from '../data/types';
import { fmtPrice, durationLabel } from '../lib/format';
import { fuelLabel } from '../lib/labels';
import { PANEL_GAP, useIsDesktop, usePanelInset } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import {
  useApp,
  routeFromLabel,
  selectRouteAnalysis,
  effectivePrice,
} from '../state/store';
import RouteMap from '../components/RouteMap';
import PlaceField from '../components/PlaceField';
import SheetShell from '../components/SheetShell';
import RouteTimeline, { recommendationLabel } from './RouteTimeline';

/** Same cap as the map screen's overlay: fields dragged across a window are
    unreadable, and the width belongs to the map */
const OVERLAY_MAX_WIDTH = 460;

type Phase = 'form' | 'computing' | 'error' | 'ready';

/** The departure and arrival fields — the map's search field twice, with the
    route's own icons and write-through semantics. They are always on screen,
    over the map, in both arrangements and every phase. */
function RouteFields() {
  const app = useApp();

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PlaceField
        target="routeFrom"
        value={routeFromLabel(app)}
        // « Ma position » is a value, not text to edit around: the field
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
        clearAria={m.route_from_clear_aria()}
        emptyHint={m.route_search_hint()}
      />
      <PlaceField
        target="routeTo"
        value={app.toText}
        placeholder={m.route_to_placeholder()}
        title={m.route_to_field_title()}
        icon={toIcon}
        onChangeText={(text) => app.setTo(text)}
        onPick={(r: GeocodeResult) => app.setTo(r.label, r.point)}
        onClear={app.toText.trim() ? () => app.setTo('') : undefined}
        clearAria={m.route_to_clear_aria()}
        emptyHint={m.route_search_hint()}
      />
    </div>
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
          <div style={{ fontSize: 24, fontWeight: 800, color: C.ink }}>
            {m.route_setup_title()}
          </div>
          <div style={{ fontSize: 13, color: C.mut, marginTop: 4 }}>
            {m.route_setup_subtitle()}
          </div>
        </>
      )}

      {/* Route preferences */}
      <div style={{ display: 'flex', gap: 8, marginTop: withTitle ? 18 : 8, flexWrap: 'wrap' }}>
        {(
          [
            [m.route_avoid_motorways(), app.avoidMotorway, app.setAvoidMotorway],
            [m.route_avoid_tolls(), app.avoidToll, app.setAvoidToll],
          ] as const
        ).map(([label, on, set]) => (
          <button
            key={label}
            onClick={() => set(!on)}
            style={{
              background: on ? C.accent : 'transparent',
              color: on ? C.onAccent : C.body,
              fontSize: 12.5,
              fontWeight: 700,
              padding: '8px 14px',
              borderRadius: 16,
              border: on ? `1px solid ${C.accent}` : '1px solid rgba(255,255,255,.15)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {on ? '✓ ' : ''}
            {label}
          </button>
        ))}
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

/** Computing / error blocks — same shell, only this content swaps */
function RouteStatus({ phase }: { phase: 'computing' | 'error' }) {
  const app = useApp();
  if (phase === 'computing') {
    return (
      <div style={{ padding: '40px 22px', textAlign: 'center', fontSize: 13.5, color: C.mut }}>
        {m.ribbon_computing()}
      </div>
    );
  }
  return (
    <div style={{ padding: '40px 22px', textAlign: 'center' }}>
      <div style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5 }}>
        {app.routeState.error ?? m.ribbon_error_fallback()}
      </div>
      <button
        onClick={() => app.editRoute()}
        style={{ marginTop: 14, fontSize: 14, fontWeight: 700, color: C.accent, cursor: 'pointer' }}
      >
        {m.ribbon_edit_route()}
      </button>
    </div>
  );
}

/** What the collapsed sheet leads with, per phase — the recap during setup,
    the recommended stop once the route lands, the way ZoneCard leads the map
    sheet. Expanded is always the detail (the form, the timeline). */
function RouteLead({ phase }: { phase: Phase }) {
  const app = useApp();
  const analysis = selectRouteAnalysis(app);

  const kicker = (text: string, accent = false) => (
    <div
      style={{
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: '.12em',
        textTransform: 'uppercase',
        color: accent ? C.accent : C.mut,
        marginBottom: 6,
      }}
    >
      {text}
    </div>
  );

  if (phase === 'ready') {
    const route = app.routeState.route;
    const reco = analysis.stops.find((s) => s.id === analysis.recoId) ?? null;
    if (reco) {
      return (
        <div>
          {kicker(m.ribbon_recommended_stop(), true)}
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
                {reco.name}
              </div>
              <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>
                {recommendationLabel(analysis.recoReason)}
              </div>
            </div>
            <div style={{ font: mono(700, 22), color: C.accent, whiteSpace: 'nowrap' }}>
              {fmtPrice(effectivePrice(reco, app.fuel)?.value)} €
            </div>
          </div>
        </div>
      );
    }
    return (
      <div>
        {kicker(m.ribbon_header())}
        <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>
          {routeFromLabel(app)} → {app.toText}
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

  return (
    <div>
      {kicker(m.route_setup_title())}
      <div style={{ fontSize: 13.5, color: phase === 'error' ? C.warn : C.mut }}>
        {phase === 'computing'
          ? m.ribbon_computing()
          : phase === 'error'
            ? (app.routeState.error ?? m.ribbon_error_fallback())
            : m.route_sheet_recap({ fuel: fuelLabel(app.fuel), percent: app.startTankPct })}
      </div>
    </div>
  );
}

export default function RouteScreen() {
  const app = useApp();
  const desktop = useIsDesktop();
  const { routeState } = app;

  // Status decides the content, never the layout. `routeReady` drops when an
  // endpoint changes, so editing a computed route swaps back to the form.
  const showForm = app.screen === 'routeSetup' || !app.routeReady;
  const phase: Phase = showForm
    ? 'form'
    : routeState.status === 'ready' && routeState.route
      ? 'ready'
      : routeState.status === 'error'
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

  const { panelRef, panelInset } = usePanelInset(desktop);
  const onCollapsedHeight = useCallback((h: number) => setSheetInset(h), []);

  const canGo = app.toText.trim().length > 0;
  const cta = (
    <button onClick={() => app.startRoute()} disabled={!canGo} style={ctaStyle(canGo)}>
      {m.route_compare_cta()}
    </button>
  );

  const content =
    phase === 'form' ? (
      <RouteForm withTitle={desktop} />
    ) : phase === 'ready' ? (
      <RouteTimeline />
    ) : (
      <RouteStatus phase={phase} />
    );

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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

          {/* The endpoint fields — over the map's top edge, one row beside
              the panel on desktop, a column under the status bar otherwise.
              1010: dropdowns cover the map's floating controls (1000) while
              staying under the scrim (1050) and the sheet (1100). */}
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
              <div style={{ flex: '0 1 460px', minWidth: 240, maxWidth: OVERLAY_MAX_WIDTH }}>
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
            </div>
          )}
        </div>

        {/* Desktop: the same floating glass panel slot the map screen uses */}
        {desktop && (
          <div ref={panelRef} data-testid="route-panel" style={floatingPanelStyle}>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{content}</div>
            {phase === 'form' && (
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
              background: 'rgba(6, 9, 11, 0.35)',
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
            hasBody
            expandAria={m.route_sheet_expand_aria()}
            collapseAria={m.route_sheet_collapse_aria()}
            header={(handle) => (
              <div style={{ padding: '0 20px 12px' }}>
                {handle}
                <RouteLead phase={phase} />
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
