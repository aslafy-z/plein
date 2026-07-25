import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { SERVICE_TAGS } from '../data/types';
import { fuelLabel } from '../lib/labels';
import { useIsDesktop } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import { useApp, selectVisible } from '../state/store';
import MapCanvas from '../components/MapCanvas';
import MapSheet from '../components/MapSheet';
import ZonePanel from '../components/ZonePanel';
import PlaceSearch from '../components/PlaceSearch';

/** The map's floating controls never grow past this: a search field dragged
    across a window is unreadable, and the width belongs to the map. Applies
    from the first pixel a phone doesn't need it — a tablet stretched the bar
    just as badly as a desktop did. */
const OVERLAY_MAX_WIDTH = 460;

export default function MapScreen() {
  const app = useApp();
  const desktop = useIsDesktop();

  const visible = selectVisible(app);
  const nbVisible = visible.length;

  const filtersActive =
    SERVICE_TAGS.some((t) => app.serviceTags[t]) || app.brandSel.length > 0;

  const geoOff = app.geoStatus === 'denied' || app.geoStatus === 'unavailable';

  // The sheet overlays the stage; the map keeps the FULL stage size at all
  // times (a sheet growing/shrinking must never resize Leaflet — that moves
  // the view under the user). Only the controls riding the map's bottom edge
  // (recenter button, pills, attribution) slide up with the collapsed sheet.
  // On desktop the zone sits BESIDE the map instead, so there is no inset at
  // all and Leaflet's own size is already the right one.
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

  const onCollapsedHeight = useCallback((h: number) => setSheetInset(h), []);

  const chipBase = {
    fontSize: 13,
    padding: '8px 14px',
    borderRadius: 18,
    whiteSpace: 'nowrap' as const,
    pointerEvents: 'auto' as const,
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: desktop ? 'row' : 'column',
      }}
    >
      {/* Desktop: the leading station card and the zone list, docked, always open */}
      {desktop && <ZonePanel />}

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
        {/* Map area — always the full stage; on a phone the sheet overlays it */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <MapCanvas bottomInset={desktop ? 0 : sheetInset} />

          {/* Top overlay controls */}
          <div
            style={{
              position: 'absolute',
              left: 16,
              right: 16,
              top: 14,
              maxWidth: OVERLAY_MAX_WIDTH,
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              pointerEvents: 'none',
            }}
          >
            <PlaceSearch />

            <div style={{ display: 'flex', gap: 8 }}>
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
            </div>

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
                  {app.hasKnownPos ? m.map_geo_last_known() : m.map_geo_default_pos()}
                </button>
              </div>
            )}

          </div>
        </div>

        {/* List open → the visible map dims and a tap on it closes the sheet.
            Phone only: the docked panel never covers the map. */}
        {!desktop && sheetOpen && (
          <button
            onClick={() => setSheetOpen(false)}
            aria-label={m.map_close_list()}
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
