import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { FUEL_LABELS, SERVICE_TAGS } from '../data/types';
import { useApp, selectVisible, selectVisibleCharge } from '../state/store';
import MapCanvas from '../components/MapCanvas';
import MapSheet from '../components/MapSheet';
import PlaceSearch from '../components/PlaceSearch';

export default function MapScreen() {
  const app = useApp();
  const ev = app.mode === 'ev';

  const nbVisible = ev ? selectVisibleCharge(app).length : selectVisible(app).length;

  const filtersActive = ev
    ? app.connSel.length > 0 || app.minPowerKw > 0 || app.evFreeOnly || app.evPricedOnly
    : SERVICE_TAGS.some((t) => app.serviceTags[t]) || app.brandSel.length > 0;

  const geoOff = app.geoStatus === 'denied' || app.geoStatus === 'unavailable';

  // The sheet overlays the stage; the map keeps the FULL stage size at all
  // times (a sheet growing/shrinking must never resize Leaflet — that moves
  // the view under the user). Only the controls riding the map's bottom edge
  // (recenter button, pills, attribution) slide up with the collapsed sheet.
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
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        ref={stageRef}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', background: C.mapBg }}
      >
        {/* Map area — always the full stage; the sheet overlays it */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <MapCanvas bottomInset={sheetInset} />

          {/* Top overlay controls */}
          <div
            style={{
              position: 'absolute',
              left: 16,
              right: 16,
              top: 14,
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              pointerEvents: 'none',
            }}
          >
            <PlaceSearch />

            <div style={{ display: 'flex', gap: 8 }}>
              {/* Fuel ↔ EV mode toggle — the map compares €/L or €/kWh, never both */}
              <button
                onClick={() => app.setMode(ev ? 'fuel' : 'ev')}
                aria-label={ev ? 'Passer aux carburants' : 'Passer à la recharge électrique'}
                title={ev ? 'Carburants' : 'Recharge électrique'}
                style={{
                  ...chipBase,
                  padding: '8px 11px',
                  background: C.surface2,
                  color: C.body,
                  fontWeight: 700,
                  border: `1px solid ${C.border09}`,
                }}
              >
                {ev ? '⛽' : '⚡'}
              </button>
              <button
                onClick={() => (ev ? app.cyclePower() : app.cycleFuel())}
                style={{
                  ...chipBase,
                  background: C.accent,
                  color: C.onAccent,
                  fontWeight: 700,
                }}
              >
                {ev
                  ? app.minPowerKw > 0
                    ? `≥ ${app.minPowerKw} kW ↻`
                    : 'Puissance ↻'
                  : `${FUEL_LABELS[app.fuel]} ↻`}
              </button>
              <button
                onClick={() => app.setFiltersOpen(true)}
                style={{
                  ...chipBase,
                  background: C.surface2,
                  color: C.body,
                  fontWeight: 500,
                  border: `1px solid ${C.border09}`,
                }}
              >
                &lt; {app.radius} km
              </button>
              <button
                onClick={() => app.setFiltersOpen(true)}
                aria-label={`Filtres, ${nbVisible} stations`}
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
                Filtres · {nbVisible}
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
                  {app.hasKnownPos
                    ? 'Dernière position connue — réactiver la localisation'
                    : 'Position par défaut : Toulouse — activer la localisation'}
                </button>
              </div>
            )}

            {/* PWA install — discreet chip (native dialog on tap; also in Réglages) */}
            {app.installBannerVisible && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  onClick={() => app.promptInstall()}
                  style={{
                    ...chipBase,
                    fontSize: 12,
                    padding: '6px 12px',
                    fontWeight: 600,
                    background: C.surface2,
                    color: C.body,
                    border: `1px solid ${C.border09}`,
                  }}
                >
                  ⤓ Installer l'app
                </button>
                <button
                  onClick={() => app.dismissInstallBanner()}
                  aria-label="Ne plus proposer l'installation"
                  style={{
                    ...chipBase,
                    fontSize: 12,
                    padding: '6px 10px',
                    fontWeight: 600,
                    background: C.surface2,
                    color: C.mut,
                    border: `1px solid ${C.border09}`,
                  }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>

        {/* List open → the visible map dims and a tap on it closes the sheet */}
        {sheetOpen && (
          <button
            onClick={() => setSheetOpen(false)}
            aria-label="Fermer la liste"
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
        <MapSheet
          stageH={stageH}
          onCollapsedHeight={onCollapsedHeight}
          expanded={sheetOpen}
          onExpandedChange={setSheetOpen}
        />
      </div>
    </div>
  );
}
