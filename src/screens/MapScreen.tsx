import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { C, floatingPanelStyle } from '../theme';
import { SERVICE_TAGS } from '../data/types';
import { fuelLabel } from '../lib/labels';
import { PANEL_GAP, useIsDesktop, usePanelInset } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import { useApp, selectVisible, selectZoneLead } from '../state/store';
import MapCanvas from '../components/MapCanvas';
import MapSheet from '../components/MapSheet';
import ZonePanel from '../components/ZonePanel';
import PlaceSearch from '../components/PlaceSearch';
import StationDetail from './StationDetail';

/** The map's floating controls never grow past this: a search field dragged
    across a window is unreadable, and the width belongs to the map. Applies
    from the first pixel a phone doesn't need it — a tablet stretched the bar
    just as badly as a desktop did. */
const OVERLAY_MAX_WIDTH = 460;

export default function MapScreen() {
  const app = useApp();
  const desktop = useIsDesktop();

  // Desktop keeps the map mounted under the fiche: /station/:id renders in
  // the same floating slot the zone panel uses, over the LIVE map — never a
  // page of its own that would unmount Leaflet on every open/close.
  const fiche = desktop && app.screen === 'detail';

  const visible = selectVisible(app);
  const nbVisible = visible.length;

  // An empty zone has no list under its card — ZoneEmpty is then the whole of
  // the panel's content. The slot hugs it instead of stretching to the bottom
  // edge: a full-height pane of glass around one block reads as broken, and
  // the map has to show through where the void would have been. The fiche
  // keeps the full height; it is a long document that scrolls.
  const hasZone = selectZoneLead(app) != null;
  const hugPanel = !fiche && !hasZone;

  const filtersActive =
    SERVICE_TAGS.some((t) => app.serviceTags[t]) || app.brandSel.length > 0;

  const geoOff = app.geoStatus === 'denied' || app.geoStatus === 'unavailable';

  // The sheet overlays the stage; the map keeps the FULL stage size at all
  // times (a sheet growing/shrinking must never resize Leaflet — that moves
  // the view under the user). Only the controls riding the map's bottom edge
  // (recenter button, pills, attribution) slide up with the collapsed sheet.
  // On desktop the panel floats over the map's left edge instead: Leaflet
  // keeps the full stage there too, and the LEFT inset does what the bottom
  // one does on a phone — auto-fits land the zone in the visible part.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageH, setStageH] = useState(0);
  const [sheetInset, setSheetInset] = useState(0);
  // Open state lives here so the map can dim & close the sheet on tap
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

  // The floating panel's real width, measured so the map knows how much of
  // its left edge is covered (lib/layout, shared with the route screen). The
  // slot remounts when the fiche replaces the zone (keyed below) — the
  // remeasure key makes the observer follow the new node.
  const { panelRef, panelInset } = usePanelInset(desktop, fiche);

  const onCollapsedHeight = useCallback((h: number) => setSheetInset(h), []);

  // Desktop chips match the search bar's height and ride right next to it —
  // same rank as the search, not an afterthought floating under it. The
  // phone keeps its compact second-row chips.
  const chipBase = desktop
    ? {
        fontSize: 14,
        padding: '0 18px',
        height: 51,
        display: 'flex',
        alignItems: 'center',
        borderRadius: 26,
        whiteSpace: 'nowrap' as const,
        pointerEvents: 'auto' as const,
      }
    : {
        fontSize: 13,
        padding: '8px 14px',
        borderRadius: 18,
        whiteSpace: 'nowrap' as const,
        pointerEvents: 'auto' as const,
      };

  const controls = (
    <>
      <button
        onClick={() => app.cycleFuel()}
        title={m.map_cycle_fuel_title()}
        style={{
          ...chipBase,
          background: C.accent,
          color: C.onAccent,
          fontWeight: 700,
        }}
      >
        {fuelLabel(app.fuel)} ↻
      </button>
      <button
        onClick={() => app.setFiltersOpen(true)}
        title={m.filters_title()}
        style={{
          ...chipBase,
          background: C.surface2,
          color: C.body,
          fontWeight: 500,
          border: `1px solid ${C.border09}`,
        }}
      >
        {m.map_radius_chip({ km: app.radius })}
      </button>
      <button
        onClick={() => app.setFiltersOpen(true)}
        aria-label={m.map_filters_aria({ count: nbVisible })}
        title={m.filters_title()}
        style={{
          ...chipBase,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: C.surface2,
          color: C.body,
          fontWeight: 500,
          border: `1px solid ${filtersActive ? C.accent : C.border09}`,
        }}
      >
        {filtersActive && (
          <span
            style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, flexShrink: 0 }}
          />
        )}
        {m.map_filters_chip({ count: nbVisible })}
      </button>
    </>
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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
            floating panel (desktop) overlay it */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <MapCanvas
            bottomInset={desktop ? 0 : sheetInset}
            leftInset={desktop ? panelInset : 0}
          />

          {/* Top overlay controls — one row beside the panel on desktop, a
              column under the phone's status bar otherwise. 1010: the search
              suggestion dropdown must cover the map's floating controls
              (1000) while staying under the scrim (1050) and the sheets. */}
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
                flexWrap: 'wrap',
                pointerEvents: 'none',
              }}
            >
              <div style={{ flex: '0 1 460px', minWidth: 240, maxWidth: OVERLAY_MAX_WIDTH }}>
                <PlaceSearch />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>{controls}</div>
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
              <PlaceSearch />

              <div style={{ display: 'flex', gap: 8 }}>{controls}</div>

              {/* On desktop this notice lives at the bottom of the side rail —
                  app-level state, not a map control */}
              {geoOff && (
                <div style={{ display: 'flex' }}>
                  <button
                    onClick={() => app.requestGeolocation()}
                    style={{
                      ...chipBase,
                      fontWeight: 600,
                      background: C.surface2,
                      color: C.accent,
                      border: `1px solid ${C.border09}`,
                      whiteSpace: 'normal',
                      textAlign: 'left',
                    }}
                  >
                    {app.geoLocating
                      ? m.map_locating()
                      : app.hasKnownPos
                        ? m.map_geo_last_known()
                        : m.map_geo_default_pos()}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop: the floating glass panel. The zone list always rides the
            top; opening a station stacks its fiche UNDER the list, so the
            next station is one click away while its details are read — the
            map at the right never gets covered. */}
        {desktop && (
          <div
            ref={panelRef}
            data-testid="zone-panel"
            style={
              hugPanel
                ? {
                    ...floatingPanelStyle,
                    bottom: 'auto',
                    maxHeight: `calc(100% - ${PANEL_GAP * 2}px)`,
                  }
                : floatingPanelStyle
            }
          >
            <div
              style={{
                // Nothing to list above a fiche either: the zone gives its
                // share of the panel back rather than leaving a gap over it
                flex: fiche ? (hasZone ? '0 1 38%' : '0 0 auto') : 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <ZonePanel listOnly={fiche} />
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
          </div>
        )}

        {/* List open → the visible map dims and a tap on it closes the sheet.
            Phone only: the floating panel never needs pulling up. */}
        {!desktop && sheetOpen && (
          <button
            onClick={() => setSheetOpen(false)}
            aria-label={m.map_close_list()}
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

        {/* Bottom sheet — swipe it (card, list at top, or handle) or tap the handle */}
        {!desktop && (
          <MapSheet
            stageH={stageH}
            onCollapsedHeight={onCollapsedHeight}
            expanded={sheetOpen}
            onExpandedChange={setSheetOpen}
          />
        )}
      </div>
    </div>
  );
}
