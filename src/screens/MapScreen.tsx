import { C, mono } from '../theme';
import { FUEL_LABELS, SERVICE_TAGS } from '../data/types';
import { useApp, selectVisible, selectCheapest, selectPriceRange } from '../state/store';
import { fmtPrice, distLabel, agoLabel } from '../lib/format';
import { openStatus } from '../lib/hours';
import MapCanvas from '../components/MapCanvas';
import Freshness from '../components/Freshness';

export default function MapScreen() {
  const app = useApp();

  const visible = selectVisible(app);
  const cheapest = selectCheapest(app);
  const range = selectPriceRange(app);
  const nbVisible = visible.length;
  const loading = app.stations.status === 'loading' || app.stations.status === 'idle';

  const filtersActive =
    SERVICE_TAGS.some((t) => app.serviceTags[t]) ||
    !(app.brandCats.gs && app.brandCats.ind && app.brandCats.pet);

  const geoOff = app.geoStatus === 'denied' || app.geoStatus === 'unavailable';

  const chipBase = {
    fontSize: 13,
    padding: '8px 14px',
    borderRadius: 18,
    whiteSpace: 'nowrap' as const,
    pointerEvents: 'auto' as const,
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Map area */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', background: C.mapBg }}>
        <MapCanvas />

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
          <button
            onClick={() => app.go(app.routeReady ? 'route' : 'routeSetup')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: C.surface2,
              border: `1px solid ${C.border09}`,
              borderRadius: 28,
              padding: '14px 18px',
              boxShadow: '0 8px 24px rgba(0,0,0,.4)',
              pointerEvents: 'auto',
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: `2.5px solid ${C.mut}`,
                position: 'relative',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  right: -5,
                  bottom: -4,
                  width: 8,
                  height: 2.5,
                  background: C.mut,
                  borderRadius: 2,
                  transform: 'rotate(45deg)',
                }}
              />
            </div>
            <span style={{ color: C.mut, fontSize: 15 }}>Où allez-vous ?</span>
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => app.cycleFuel()}
              style={{
                ...chipBase,
                background: C.accent,
                color: C.onAccent,
                fontWeight: 700,
              }}
            >
              {FUEL_LABELS[app.fuel]} ↻
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
                  : 'Position par défaut : Lyon — activer la localisation'}
              </button>
            </div>
          )}

          {/* PWA install banner → native Android dialog */}
          {app.installBannerVisible && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => app.promptInstall()}
                style={{
                  ...chipBase,
                  fontWeight: 700,
                  background: C.accent,
                  color: C.onAccent,
                }}
              >
                Installer l'application
              </button>
              <button
                onClick={() => app.dismissInstallBanner()}
                aria-label="Ne plus proposer l'installation"
                style={{
                  ...chipBase,
                  fontWeight: 700,
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

      {/* Bottom sheet */}
      {cheapest ? (
        <div
          style={{
            background: C.surface,
            borderRadius: '24px 24px 0 0',
            padding: '10px 20px 18px',
            boxShadow: '0 -10px 30px rgba(0,0,0,.45)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,.18)',
              margin: '0 auto 12px',
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: C.accent,
              }}
            >
              {app.searchedAway ? 'La moins chère dans cette zone' : 'La moins chère près de vous'}
            </span>
            <Freshness />
          </div>

          <button
            onClick={() => app.openStation(cheapest.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: C.surface3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.mut,
                fontWeight: 800,
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              {cheapest.init}
            </div>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ color: C.ink, fontSize: 16, fontWeight: 600 }}>{cheapest.name}</div>
              <div style={{ color: C.mut, fontSize: 13, marginTop: 2 }}>
                {[
                  distLabel(cheapest.distKm),
                  openStatus(cheapest.hours)?.short,
                  `MàJ ${agoLabel(cheapest.prices[app.fuel]?.updatedAt)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ font: mono(700, 22), color: C.accent, whiteSpace: 'nowrap' }}>
                {fmtPrice(cheapest.prices[app.fuel]?.value)} €
              </div>
              <div style={{ color: C.mut, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                {FUEL_LABELS[app.fuel]} / L
              </div>
            </div>
          </button>

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              onClick={() => app.openInMaps(cheapest)}
              style={{
                flex: 1,
                background: C.accent,
                color: C.onAccent,
                fontSize: 15,
                fontWeight: 700,
                borderRadius: 24,
                padding: '13px 0',
                textAlign: 'center',
              }}
            >
              Ouvrir dans Maps · {cheapest.driveMin} min
            </button>
            <div
              style={{
                width: 100,
                background: C.surface3,
                color: C.body,
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 24,
                padding: '13px 0',
                textAlign: 'center',
                border: `1px solid ${C.border09}`,
                whiteSpace: 'nowrap',
              }}
            >
              −{fmtPrice(range ? range.max - range.min : 0)} €/L
            </div>
          </div>
        </div>
      ) : loading ? (
        <div
          style={{
            background: C.surface,
            padding: '18px 20px',
            textAlign: 'center',
            color: C.mut,
            fontSize: 13.5,
            flexShrink: 0,
          }}
        >
          Recherche des stations autour de vous…
        </div>
      ) : (
        <div
          style={{
            background: C.surface,
            padding: '18px 20px',
            textAlign: 'center',
            color: C.mut,
            fontSize: 13.5,
            flexShrink: 0,
          }}
        >
          Aucune station ne correspond à vos filtres.{' '}
          <button
            onClick={() => app.setFiltersOpen(true)}
            style={{ color: C.accent, fontWeight: 700, display: 'inline' }}
          >
            Ajuster
          </button>
        </div>
      )}
    </div>
  );
}
