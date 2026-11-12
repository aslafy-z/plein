import { useState } from 'react';
import { C, mono } from '../theme';
import {
  useApp,
  effectivePrice,
  roadReachOf,
  sortFavoriteRows,
  effectiveFavSort,
  type FavoriteStation,
  type FavSort,
} from '../state/store';
import { fmtPrice, distLabel, agoLabel, agoLabelFrom } from '../lib/format';
import { fuelLabel, openStatusShort } from '../lib/labels';
import { useIsDesktop } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import { stationOpenStatus } from '../lib/hours';
import { fuelOutage } from '../lib/outages';
import { haversineKm } from '../lib/geo';
import BrandAvatar from '../components/BrandAvatar';
import Star from '../components/Star';

/**
 * Favorites read as a grid on a window and a column on a phone — one
 * `auto-fill` track list does both, collapsing to a single column below the
 * track floor. That floor is deliberately generous: a card narrower than this
 * truncates the station name (« Station U · Croix-… »), which is exactly the
 * word the user is scanning for.
 */
const FAV_GRID = 'repeat(auto-fill, minmax(440px, 1fr))';
/** Two roomy columns rather than four cramped ones */
const FAV_MAX_WIDTH = 1000;

/**
 * Favorites — the user's pinned stations (★ on a station detail or on the map
 * card). Favorites are stored as snapshots so they render even when their
 * area isn't loaded. The price cell reads the live area when it covers the
 * favorite and the compact favorite-price store otherwise — favorites in two
 * different cities, or two different countries, show their prices side by
 * side, each with an honest age. Tapping a row jumps to the map with the
 * station selected (which loads its area).
 */
export default function FavoritesScreen() {
  const app = useApp();
  const desktop = useIsDesktop();
  const [sort, setSort] = useState<FavSort>('recommended');
  const sorts: [FavSort, string][] = [
    ['recommended', m.favorites_sort_recommended()],
    ['price', m.favorites_sort_price()],
    ['distance', m.favorites_sort_distance()],
  ];

  const rows = app.favorites.map((f) => {
    const live = app.stations.data.find((s) => s.id === f.id);
    const held = live ? undefined : app.favoritePrices[f.id];
    const priced =
      live ?? (held ? { id: f.id, prices: held.prices, outages: held.outages } : null);
    const priceInfo = priced ? effectivePrice(priced, app.fuel) : undefined;
    // Read, and out of the selected fuel — not a price still to load
    const outOfStock = priced != null && fuelOutage(priced, app.fuel) != null;
    const { distKm } = roadReachOf(haversineKm(app.userPos, f), app.roadReach[f.id]);
    return { f, live, held, priceInfo, price: priceInfo?.value ?? null, outOfStock, distKm };
  });

  // « Recommended » ranks on the effective per-litre price: the fuel burnt on
  // the round trip (consumption & tank size from Settings) counted in — the
  // same notion as the station the map card crowns.
  //
  // Every distance here starts from the user, so without a known position
  // (geolocation refused on a first visit — `userPos` is only the fallback
  // area) there is none: rows show no distance, « Distance » greys out and
  // « Recommended » ranks on price alone. The chosen sort survives untouched
  // for when a fix lands.
  const originKnown = app.hasKnownPos;
  const effectiveSort = effectiveFavSort(sort, originKnown);
  const favs = sortFavoriteRows(rows, sort, app, originKnown);

  const locate = (f: FavoriteStation) => {
    app.setSearchArea({ lat: f.lat, lng: f.lng }, f.name);
    app.setFocusStation(f.id);
    app.go('map');
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div
        style={{
          padding: desktop ? '26px 32px 32px' : '14px 20px 18px',
          maxWidth: FAV_MAX_WIDTH,
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: C.ink, flex: 1 }}>{m.favorites_title()}</span>
          {favs.length > 0 && (
            <span style={{ fontSize: 13, color: C.mut, fontWeight: 600 }}>
              {m.favorites_count({ count: favs.length })}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: C.mut, marginTop: 4 }}>
          {m.favorites_subtitle()}
        </div>

        {/* Sort chips — « Recommended » = best price / distance trade-off */}
        {favs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {sorts.map(([k, label]) => {
              const active = effectiveSort === k;
              const disabled = k === 'distance' && !originKnown;
              return (
                <button
                  key={k}
                  className="press"
                  onClick={disabled ? undefined : () => setSort(k)}
                  aria-pressed={active}
                  disabled={disabled}
                  aria-label={disabled ? m.favorites_sort_distance_unavailable_aria() : undefined}
                  title={disabled ? m.favorites_sort_distance_unavailable_aria() : undefined}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: active ? C.onAccent : C.mut,
                    background: active ? C.accent : C.surface2,
                    padding: '7px 13px',
                    borderRadius: 15,
                    whiteSpace: 'nowrap',
                    transition: 'background .25s var(--ease-snap), color .25s var(--ease-snap)',
                    ...(disabled ? { opacity: 0.4, cursor: 'default' } : null),
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
              {m.favorites_empty_title()}
            </span>
            <span style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5, maxWidth: 300 }}>
              {m.favorites_empty_body()}
            </span>
            <button
              className="press"
              onClick={() => app.go('map')}
              style={{
                marginTop: 6,
                background: C.accent,
                color: C.onAccent,
                fontSize: 14,
                fontWeight: 700,
                borderRadius: 22,
                padding: '11px 22px',
                boxShadow: `0 8px 20px ${C.accentGlow25}`,
              }}
            >
              {m.favorites_explore_map()}
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: FAV_GRID,
              gap: 10,
              marginTop: 14,
            }}
          >
            {favs.map(({ f, live, held, priceInfo, price, outOfStock, distKm }) => {
              const liveStatus = live ? stationOpenStatus(live) : null;
              const status = liveStatus ? openStatusShort(liveStatus) : undefined;
              // The source's own update stamp stays the thing shown; a source
              // that doesn't stamp its prices falls back to when we read them
              const ago = priceInfo?.updatedAt
                ? agoLabel(priceInfo.updatedAt)
                : price != null && held
                  ? agoLabelFrom(held.fetchedAt)
                  : null;
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
                    aria-label={m.sheet_locate_aria({ station: f.name })}
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
                          originKnown ? distLabel(distKm) : undefined,
                          status,
                          outOfStock
                            ? m.favorites_out_of_stock()
                            : ago
                              ? m.sheet_updated_ago({ ago })
                              : price == null
                                ? m.favorites_tap_to_load()
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
                        {m.sheet_per_litre({ fuel: fuelLabel(app.fuel) })}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => app.toggleFavorite(f)}
                    aria-label={m.favorites_remove_aria({ station: f.name })}
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
                // Spans every column of the grid — a note about the list, not
                // a card in it
                gridColumn: '1 / -1',
                fontSize: 12,
                color: C.faint,
                textAlign: 'center',
                marginTop: 6,
                lineHeight: 1.5,
              }}
            >
              {m.favorites_footer()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
