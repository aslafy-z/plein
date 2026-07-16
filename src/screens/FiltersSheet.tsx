import { useState } from 'react';
import { C, mono } from '../theme';
import { ALL_FUELS, FUEL_LABELS, SERVICE_TAGS } from '../data/types';
import { useApp, selectVisible } from '../state/store';
import { haversineKm } from '../lib/geo';
import {
  brandGroup,
  brandIconSrc,
  INDEPENDENT_GROUP,
  KNOWN_BRAND_GROUPS,
} from '../lib/brandIcons';

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
  const knowsBrands = app.stations.data.some((s) => s.brand != null);
  // The brand list is collapsed by default so a brand-rich zone doesn't
  // stretch the sheet — the header always shows what's selected.
  const [brandsOpen, setBrandsOpen] = useState(false);

  // Brand groups present in the zone with their station count, most frequent
  // first; brandless stations count as « Indépendants & autres », pinned last
  // so the tail never buries the real enseignes.
  const counts = new Map<string, number>();
  for (const s of app.stations.data) {
    if (haversineKm(app.searchPos, { lat: s.lat, lng: s.lng }) <= app.radius) {
      const g = brandGroup(s.brand);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  const zoneBrands = [...counts.entries()].sort((a, b) => {
    if (a[0] === INDEPENDENT_GROUP) return 1;
    if (b[0] === INDEPENDENT_GROUP) return -1;
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
  // Every known group absent from the zone stays selectable — the selection
  // is persisted across areas and sessions, and prepares the next trip.
  const outOfZone = KNOWN_BRAND_GROUPS.filter((g) => !counts.has(g));

  const brandSummary =
    app.brandSel.length === 0
      ? 'Toutes'
      : app.brandSel.slice(0, 2).join(', ') +
        (app.brandSel.length > 2 ? ` +${app.brandSel.length - 2}` : '');

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

        {/* Marques — accordion, collapsed by default */}
        <div>
          {knowsBrands ? (
            <>
              <button
                onClick={() => setBrandsOpen((o) => !o)}
                aria-expanded={brandsOpen}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}
              >
                <span style={sectionLabel}>Marques</span>
                <span
                  style={{
                    flex: 1,
                    textAlign: 'right',
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: app.brandSel.length ? C.accent : C.faint,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {brandSummary}
                </span>
                <span
                  aria-hidden
                  style={{
                    color: C.mut,
                    fontSize: 12,
                    transform: brandsOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform .15s',
                  }}
                >
                  ▾
                </span>
              </button>
              {brandsOpen && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: C.faint, marginBottom: 6 }}>
                    Aucune sélection = toutes les marques.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {zoneBrands.map(([brand, count]) => {
                      const on = app.brandSel.includes(brand);
                      const icon = brandIconSrc(brand);
                      return (
                        <button
                          key={brand}
                          onClick={() => app.toggleBrand(brand)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '7px 2px',
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
                          {icon && (
                            <img
                              src={icon}
                              alt=""
                              width={18}
                              height={18}
                              style={{
                                objectFit: 'contain',
                                background: '#fff',
                                borderRadius: 5,
                                padding: 1,
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <span
                            style={{
                              fontSize: 15,
                              color: C.ink,
                              fontWeight: 600,
                              flex: 1,
                              textAlign: 'left',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {brand}
                          </span>
                          <span style={{ fontSize: 12, color: C.faint }}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  {outOfZone.length > 0 && (
                    <>
                      <div style={{ fontSize: 11.5, color: C.faint, margin: '10px 0 8px' }}>
                        Hors de la zone — pour un prochain trajet
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                        {outOfZone.map((brand) => {
                          const on = app.brandSel.includes(brand);
                          const icon = brandIconSrc(brand);
                          return (
                            <button
                              key={brand}
                              onClick={() => app.toggleBrand(brand)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                background: on ? C.accentSoft14 : 'transparent',
                                color: on ? C.accent : C.body,
                                fontSize: 12.5,
                                fontWeight: 600,
                                padding: '6px 11px',
                                borderRadius: 15,
                                border: `1px solid ${on ? C.accentBorderStrong : C.border12}`,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {icon && (
                                <img
                                  src={icon}
                                  alt=""
                                  width={14}
                                  height={14}
                                  style={{
                                    objectFit: 'contain',
                                    background: '#fff',
                                    borderRadius: 4,
                                    padding: 1,
                                  }}
                                />
                              )}
                              {brand}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ ...sectionLabel, marginBottom: 6 }}>Marques</div>
              <div style={{ fontSize: 12, color: C.faint }}>
                La source publique ne fournit pas les enseignes des stations.
              </div>
            </>
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
