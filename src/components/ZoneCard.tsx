import type { ReactNode } from 'react';
import { C, mono } from '../theme';
import {
  useApp,
  selectCheapest,
  selectRecommended,
  selectFocusStation,
  selectZoneDelta,
  selectZoneFuels,
  effectiveFuel,
  effectivePrice,
} from '../state/store';
import { fmtPrice, distLabel, agoLabel, durationLabel } from '../lib/format';
import { fuelLabel, openStatusShort } from '../lib/labels';
import { m } from '../paraglide/messages.js';
import { openStatus } from '../lib/hours';
import BrandAvatar from './BrandAvatar';
import Freshness from './Freshness';
import Star from './Star';

/**
 * The station the zone leads with: the best deal around (or the one selected
 * on the map), with its price, its « Y aller » and its gap to the zone floor.
 *
 * Shared by the two arrangements of the zone — the bottom sheet's collapsed
 * head on a phone (which passes its drag handle in) and the head of the panel
 * docked beside the map on desktop. Both render the same markup, so the card
 * only has one behaviour to get right.
 */
export default function ZoneCard({ handle }: { handle?: ReactNode }) {
  const app = useApp();
  const cheapest = selectCheapest(app);
  // The card crowns the best DEAL (effective price, round-trip fuel counted)
  // — not always the lowest sticker price when a closer pump beats it
  const reco = selectRecommended(app);
  const recoIsCheapest = reco == null || cheapest == null || reco.id === cheapest.id;
  const focused = selectFocusStation(app);
  const shown = focused ?? reco;
  const loading = app.stations.status === 'loading' || app.stations.status === 'idle';

  const hasCard = shown != null;
  // Zone empty for the SELECTED fuel: which fuels are actually sold around?
  const soldFuels = !loading && !hasCard ? selectZoneFuels(app).filter((f) => f !== app.fuel) : [];

  // « vs the zone » chip: null when the card has no zone to compare against
  // (empty circle, or a station selected outside it) — then no chip at all,
  // « +1,67 €/L » against a nonexistent floor is just the price again
  const zoneDelta = selectZoneDelta(app, shown);
  const shownStatus = shown ? openStatus(shown.hours) : null;

  const cardHeading = recoIsCheapest
    ? app.searchedAway
      ? m.sheet_cheapest_in_area()
      : m.sheet_cheapest_nearby()
    : app.searchedAway
      ? m.sheet_best_choice_in_area()
      : m.sheet_best_choice_nearby();

  const stateKey = hasCard ? 'card' : loading ? 'loading' : 'empty';

  return (
    <div key={stateKey} className="sheet-swap">
      {shown ? (
        // The handle carries the top padding when there is one (the phone
        // sheet); without it the kicker would sit flush against the edge.
        <div style={{ padding: handle ? '0 20px 18px' : '16px 20px 18px' }}>
          {handle}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
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
              {/* Four whole sentences, never two glued fragments: word
                  order and adjective agreement differ per language, and
                  « La moins chère » + « près de vous » only happens to
                  concatenate in French. */}
              {focused ? m.sheet_selected_station() : cardHeading}
            </span>
            {focused && (
              <button
                onClick={() => app.setFocusStation(null)}
                aria-label={m.sheet_deselect_aria()}
                title={m.sheet_deselect_aria()}
                style={{ color: C.mut, fontSize: 14, fontWeight: 700, padding: '0 2px' }}
              >
                ✕
              </button>
            )}
            <button
              onClick={() =>
                app.toggleFavorite({
                  id: shown.id,
                  name: shown.name,
                  init: shown.init,
                  city: shown.city,
                  lat: shown.lat,
                  lng: shown.lng,
                })
              }
              aria-label={
                app.isFavorite(shown.id)
                  ? m.sheet_remove_favorite_aria({ station: shown.name })
                  : m.sheet_add_favorite_aria({ station: shown.name })
              }
              title={
                app.isFavorite(shown.id)
                  ? m.sheet_remove_favorite_aria({ station: shown.name })
                  : m.sheet_add_favorite_aria({ station: shown.name })
              }
              style={{ padding: '0 2px', display: 'flex', alignItems: 'center' }}
            >
              <Star
                filled={app.isFavorite(shown.id)}
                color={app.isFavorite(shown.id) ? C.accent : C.mut}
                size={16}
              />
            </button>
            <Freshness />
          </div>

          <button
            onClick={() => app.openStation(shown.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}
          >
            <BrandAvatar label={shown.brand ?? shown.name} init={shown.init} size={46} fontSize={15} />
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ color: C.ink, fontSize: 16, fontWeight: 600 }}>{shown.name}</div>
              <div style={{ color: C.mut, fontSize: 13, marginTop: 2 }}>
                {[
                  distLabel(shown.distKm),
                  shownStatus ? openStatusShort(shownStatus) : undefined,
                  m.sheet_updated_ago({
                    ago: agoLabel(effectivePrice(shown, app.fuel)?.updatedAt),
                  }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ font: mono(700, 22), color: C.accent, whiteSpace: 'nowrap' }}>
                {fmtPrice(effectivePrice(shown, app.fuel)?.value)} €
              </div>
              {/* Fuel of the SHOWN price — SP95 when E10 fell back on it */}
              <div style={{ color: C.mut, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                {m.sheet_per_litre({ fuel: fuelLabel(effectiveFuel(shown, app.fuel) ?? app.fuel) })}
              </div>
            </div>
          </button>

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              onClick={() => app.openInMaps(shown)}
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
              {m.sheet_go_there({ duration: durationLabel(shown.driveMin) })}
            </button>
            {zoneDelta != null && (
              <div
                data-testid="zone-delta"
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
                {m.sheet_price_per_litre_delta({
                  sign: zoneDelta.best ? '−' : '+',
                  amount: fmtPrice(zoneDelta.amount),
                })}
              </div>
            )}
          </div>
        </div>
      ) : loading ? (
        <div style={{ padding: '18px 20px', textAlign: 'center', color: C.mut, fontSize: 13.5 }}>
          {m.sheet_loading()}
        </div>
      ) : soldFuels.length > 0 ? (
        // Stations around, but none sells the selected fuel (no E10/E85
        // outside France…) — name the culprit and offer what IS sold
        <div style={{ padding: '16px 20px 18px', textAlign: 'center', color: C.mut, fontSize: 13.5 }}>
          {m.sheet_fuel_not_sold({ fuel: fuelLabel(app.fuel) })}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: 8,
              marginTop: 10,
            }}
          >
            <span style={{ alignSelf: 'center' }}>{m.sheet_sold_here()}</span>
            {soldFuels.map((f) => (
              <button
                key={f}
                onClick={() => app.setFuel(f)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: C.accent,
                  background: C.surface2,
                  padding: '6px 12px',
                  borderRadius: 14,
                  border: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {fuelLabel(f)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: '18px 20px', textAlign: 'center', color: C.mut, fontSize: 13.5 }}>
          {m.sheet_no_match()}{' '}
          <button
            onClick={() => app.setFiltersOpen(true)}
            style={{ color: C.accent, fontWeight: 700, display: 'inline' }}
          >
            {m.sheet_adjust_filters()}
          </button>
        </div>
      )}
    </div>
  );
}
