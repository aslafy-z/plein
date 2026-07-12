import { C, mono } from '../theme';
import {
  ALL_FUELS,
  FUEL_LABELS,
  SERVICE_TAGS,
  type BrandCat,
} from '../data/types';
import { useApp, selectVisible } from '../state/store';
import { haversineKm } from '../lib/geo';

const BRAND_LABELS: Record<'gs' | 'ind' | 'pet', string> = {
  gs: 'Grandes surfaces',
  ind: 'Indépendants',
  pet: 'Pétroliers (Total, BP…)',
};

const sectionLabel = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: C.mut,
};

export default function FiltersSheet() {
  const app = useApp();
  const nbVisible = selectVisible(app).length;
  const knowsBrands = app.stations.data.some((s) => s.cat !== 'unknown');

  const countInCat = (k: BrandCat) =>
    app.stations.data.filter(
      (s) => s.cat === k && haversineKm(app.userPos, { lat: s.lat, lng: s.lng }) <= app.radius,
    ).length;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 1100 }}>
      <button
        onClick={() => app.setFiltersOpen(false)}
        aria-label="Fermer les filtres"
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', width: '100%' }}
      />
      <div
        className="anim-sheet"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          background: '#15181b',
          borderRadius: '26px 26px 0 0',
          padding: '12px 20px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          maxHeight: '88%',
          overflow: 'auto',
        }}
      >
        <button
          onClick={() => app.setFiltersOpen(false)}
          aria-label="Fermer"
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: 'rgba(255,255,255,.2)',
            margin: '0 auto',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: C.ink, flex: 1 }}>Filtres</span>
          <button
            onClick={() => app.resetFilters()}
            style={{ fontSize: 13, fontWeight: 700, color: C.accent }}
          >
            Réinitialiser
          </button>
        </div>

        {/* Carburant */}
        <div>
          <div style={{ ...sectionLabel, marginBottom: 10 }}>Carburant</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ALL_FUELS.map((f) => {
              const on = app.fuel === f;
              return (
                <button
                  key={f}
                  onClick={() => app.setFuel(f)}
                  style={{
                    background: on ? C.accent : 'transparent',
                    color: on ? C.onAccent : C.body,
                    fontSize: 13.5,
                    fontWeight: 700,
                    padding: '9px 15px',
                    borderRadius: 18,
                    border: `1px solid ${on ? C.accent : C.border12}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {FUEL_LABELS[f]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rayon */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ ...sectionLabel, flex: 1 }}>Rayon de recherche</span>
            <span style={{ font: mono(700, 15), color: C.ink }}>{app.radius} km</span>
          </div>
          <input
            type="range"
            min={1}
            max={25}
            step={1}
            value={app.radius}
            onChange={(e) => app.setRadius(+e.target.value)}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11.5,
              color: C.faint,
              marginTop: 2,
            }}
          >
            <span>1 km</span>
            <span>25 km</span>
          </div>
        </div>

        {/* Marques */}
        <div>
          <div style={{ ...sectionLabel, marginBottom: 6 }}>Marques</div>
          {knowsBrands ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(['gs', 'ind', 'pet'] as const).map((k) => {
                const on = app.brandCats[k];
                return (
                  <button
                    key={k}
                    onClick={() => app.toggleBrandCat(k)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '9px 2px',
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        background: on ? C.accent : 'transparent',
                        border: `2px solid ${on ? C.accent : 'rgba(255,255,255,.25)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: C.onAccent,
                        fontSize: 12,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {on ? '✓' : ''}
                    </div>
                    <span style={{ fontSize: 15, color: C.ink, fontWeight: 600, flex: 1, textAlign: 'left' }}>
                      {BRAND_LABELS[k]}
                    </span>
                    <span style={{ fontSize: 12, color: C.faint }}>{countInCat(k)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.faint }}>
              La source publique ne fournit pas les enseignes des stations.
            </div>
          )}
        </div>

        {/* Services */}
        <div>
          <div style={{ ...sectionLabel, marginBottom: 10 }}>Services</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SERVICE_TAGS.map((t) => {
              const on = !!app.serviceTags[t];
              return (
                <button
                  key={t}
                  onClick={() => app.toggleServiceTag(t)}
                  style={{
                    background: on ? C.accent : 'transparent',
                    color: on ? C.onAccent : C.body,
                    fontSize: 13.5,
                    fontWeight: 600,
                    padding: '9px 15px',
                    borderRadius: 18,
                    border: `1px solid ${on ? C.accent : C.border12}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t === '24/24' ? 'Ouvert 24/24' : t}
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => app.setFiltersOpen(false)}
          style={{
            width: '100%',
            background: C.accent,
            color: C.onAccent,
            fontSize: 15.5,
            fontWeight: 800,
            borderRadius: 26,
            padding: '16px 0',
            textAlign: 'center',
            boxShadow: '0 6px 16px rgba(61,220,132,.25)',
          }}
        >
          Voir {nbVisible} station{nbVisible === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
