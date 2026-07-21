import { useState } from 'react';
import { C, mono } from '../theme';
import { FUEL_LABELS } from '../data/types';
import {
  useApp,
  effectivePrice,
  sortFavoriteRows,
  type FavoriteStation,
  type FavSort,
} from '../state/store';
import { fmtPrice, distLabel, agoLabel, plural } from '../lib/format';
import { openStatus } from '../lib/hours';
import { haversineKm } from '../lib/geo';
import BrandAvatar from '../components/BrandAvatar';
import Star from '../components/Star';

const SORTS: [FavSort, string][] = [
  ['reco', 'Recommandé'],
  ['prix', 'Prix'],
  ['dist', 'Distance'],
];

/**
 * Favoris — the user's pinned stations (★ on a station detail or on the map
 * card). Favorites are stored as snapshots so they render even when their
 * area isn't loaded; live price/status appear when it is, and tapping a row
 * jumps to the map with the station selected (which loads its area).
 */
export default function FavoritesScreen() {
  const app = useApp();
  const [sort, setSort] = useState<FavSort>('reco');

  const rows = app.favorites.map((f) => {
    const live = app.stations.data.find((s) => s.id === f.id);
    const price = (live && effectivePrice(live, app.fuel)?.value) ?? null;
    const distKm = haversineKm(app.userPos, f);
    return { f, live, price, distKm };
  });

  // « Recommandé » : prix effectif au litre en comptant le carburant brûlé
  // pour l'aller-retour (conso & réservoir des Réglages) — même notion que
  // la station mise en avant sur la carte.
  const favs = sortFavoriteRows(rows, sort, app);

  const locate = (f: FavoriteStation) => {
    app.setSearchArea({ lat: f.lat, lng: f.lng }, f.name);
    app.setFocusStation(f.id);
    app.go('map');
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: '14px 20px 18px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: C.ink, flex: 1 }}>Favoris</span>
          {favs.length > 0 && (
            <span style={{ fontSize: 13, color: C.mut, fontWeight: 600 }}>
              {plural(favs.length, 'station')}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: C.mut, marginTop: 4 }}>
          Vos stations habituelles, au prix du jour.
        </div>

        {/* Sort chips — « Recommandé » = meilleur rapport prix / distance */}
        {favs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {SORTS.map(([k, label]) => {
              const active = sort === k;
              return (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: active ? C.onAccent : C.mut,
                    background: active ? C.accent : C.surface2,
                    padding: '7px 13px',
                    borderRadius: 15,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {favs.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              padding: '56px 20px',
              textAlign: 'center',
            }}
          >
            <Star filled={false} color={C.faint} size={34} />
            <span style={{ fontSize: 15, fontWeight: 700, color: C.body }}>
              Aucun favori pour l'instant
            </span>
            <span style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5, maxWidth: 300 }}>
              Touchez l'étoile d'une fiche station pour l'épingler ici et comparer vos stations
              habituelles d'un coup d'œil.
            </span>
            <button
              onClick={() => app.go('map')}
              style={{
                marginTop: 6,
                background: C.accent,
                color: C.onAccent,
                fontSize: 14,
                fontWeight: 700,
                borderRadius: 22,
                padding: '11px 22px',
              }}
            >
              Explorer la carte
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {favs.map(({ f, live, price, distKm }) => {
              const updated = live && effectivePrice(live, app.fuel)?.updatedAt;
              const status = live ? openStatus(live.hours)?.short : undefined;
              return (
                <div
                  key={f.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: C.surface,
                    borderRadius: 16,
                    border: `1px solid ${C.border}`,
                    padding: '12px 8px 12px 14px',
                  }}
                >
                  <button
                    onClick={() => locate(f)}
                    aria-label={`Voir ${f.name} sur la carte`}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}
                  >
                    <BrandAvatar label={f.name} init={f.init} size={40} fontSize={13} />
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: C.ink,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {f.name}
                      </div>
                      <div style={{ fontSize: 12.5, color: C.mut, marginTop: 2 }}>
                        {[
                          distLabel(distKm),
                          status,
                          updated
                            ? `MàJ ${agoLabel(updated)}`
                            : price == null
                              ? 'toucher pour voir la zone'
                              : undefined,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div
                        style={{
                          font: mono(700, 18),
                          color: price != null ? C.accent : C.faint,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {price != null ? `${fmtPrice(price)} €` : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: C.mut, whiteSpace: 'nowrap' }}>
                        {FUEL_LABELS[app.fuel]} / L
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => app.toggleFavorite(f)}
                    aria-label={`Retirer ${f.name} des favoris`}
                    style={{
                      width: 40,
                      height: 40,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Star filled color={C.accent} size={17} />
                  </button>
                </div>
              );
            })}
            <div
              style={{
                fontSize: 12,
                color: C.faint,
                textAlign: 'center',
                marginTop: 6,
                lineHeight: 1.5,
              }}
            >
              Le prix s'affiche quand la station est dans la zone chargée — toucher une station
              l'ouvre sur la carte.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
