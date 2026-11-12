import type { ReactNode } from 'react';
import { C, accentPill, kicker, mono } from '../theme';
import {
  useApp,
  selectCheapest,
  selectRecommended,
  selectFocusStation,
  selectZoneDelta,
  selectZoneLead,
  selectZoneLoading,
  effectiveFuel,
  effectivePrice,
  selectTripOriginKnown,
} from '../state/store';
import { fmtPrice, distLabel, agoLabel, durationLabel } from '../lib/format';
import { fuelLabel, openStatusShort } from '../lib/labels';
import { m } from '../paraglide/messages.js';
import { stationOpenStatus } from '../lib/hours';
import BrandAvatar from './BrandAvatar';
import Freshness from './Freshness';
import Star from './Star';
import CrossIcon from './CrossIcon';
import ActionPill, { ActionPills, actionPillInk } from './ActionPill';
import ZoneEmpty from './ZoneEmpty';

/**
 * The station the zone leads with: the best deal around (or the one selected
 * on the map), with its price, its « Go there » and its gap to the zone floor.
 *
 * Shared by the two arrangements of the zone — the bottom sheet's collapsed
 * head on a phone (which passes its drag handle in) and the head of the panel
 * docked beside the map on desktop. Both render the same markup, so the card
 * only has one behaviour to get right. With nothing to lead with — still
 * loading, or a zone the filters leave empty — ZoneEmpty takes its place and
 * is then the whole of the zone.
 */
export default function ZoneCard({ handle }: { handle?: ReactNode }) {
  const app = useApp();
  const cheapest = selectCheapest(app);
  // The card crowns the best DEAL (effective price, round-trip fuel counted)
  // — not always the lowest sticker price when a closer pump beats it
  const reco = selectRecommended(app);
  const recoIsCheapest = reco == null || cheapest == null || reco.id === cheapest.id;
  const focused = selectFocusStation(app);
  const shown = selectZoneLead(app);

  // « vs the zone » chip: null when the card has no zone to compare against
  // (empty circle, or a station selected outside it) — then no chip at all,
  // « +1.67 €/L » against a nonexistent floor is just the price again
  const zoneDelta = selectZoneDelta(app, shown);
  const shownStatus = shown ? stationOpenStatus(shown) : null;
  // No trip origin — the searched area is beyond any drive from the user, or
  // no position was ever known: no trip figure is honest, so the card shows
  // none — no distance in the meta line, no ETA on « Go there ». Their
  // absence (with the greyed « Distance » chip in the list) IS the signal
  // that the figures no longer start from the user.
  const tripOrigin = selectTripOriginKnown(app);

  const cardHeading = recoIsCheapest
    ? app.searchedAway
      ? m.sheet_cheapest_in_area()
      : m.sheet_cheapest_nearby()
    : app.searchedAway
      ? m.sheet_best_choice_in_area()
      : m.sheet_best_choice_nearby();

  const stateKey = shown ? 'card' : selectZoneLoading(app) ? 'loading' : 'empty';
  const { lastError } = app.stations;

  return (
    <div data-stations-status={app.stations.status} data-stations-error={lastError}>
      {shown && (
        // The handle carries the top padding when there is one (the phone
        // sheet); without it the kicker would sit flush against the edge.
        <div
          className="sheet-swap"
          style={{ padding: handle ? '0 20px 18px' : '16px 20px 18px' }}
        >
          {handle}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ ...kicker(C.accent), flex: 1 }}>
              {/* Four whole sentences, never two glued fragments: word
                  order and adjective agreement differ per language, and
                  « La moins chère » + « près de vous » only happens to
                  concatenate in French. */}
              {focused ? m.sheet_selected_station() : cardHeading}
            </span>
            <ActionPills>
              {focused && (
                <ActionPill
                  tone="neutral"
                  onClick={() => app.setFocusStation(null)}
                  aria-label={m.sheet_deselect_aria()}
                  icon={<CrossIcon color={actionPillInk('neutral')} />}
                />
              )}
              <ActionPill
                tone="neutral"
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
                icon={
                  <Star
                    filled={app.isFavorite(shown.id)}
                    color={app.isFavorite(shown.id) ? C.accent : actionPillInk('neutral')}
                    size={16}
                  />
                }
              />
            </ActionPills>
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
                  tripOrigin ? distLabel(shown.distKm) : undefined,
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
              {/* Fuel of the SHOWN price — Unleaded 95 when E10 fell back on it */}
              <div style={{ color: C.mut, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                {m.sheet_per_litre({ fuel: fuelLabel(effectiveFuel(shown, app.fuel) ?? app.fuel) })}
              </div>
            </div>
          </button>

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              className="press"
              onClick={() => app.openInMaps(shown)}
              style={{ ...accentPill(15, '13px 0'), flex: 1 }}
            >
              {tripOrigin
                ? m.sheet_go_there({ duration: durationLabel(shown.driveMin) })
                : m.sheet_go_there_no_eta()}
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
                  // Matches its neighbour, the accentPill « Go there »
                  borderRadius: 22,
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
      )}
      {/* One polite live region for everything the zone says when it has no
          station to lead with. It stays mounted — empty while a card shows —
          and sits ABOVE the keyed node that swaps: the loading line, then
          « no station matches » or the network failure, are text changes
          inside a region the screen reader already knows, which is the case
          it announces. The card stays outside it, or every price change
          would be read out. */}
      <div role="status">
        {!shown && (
          // No station to lead with — the zone is the empty state, whole
          <div key={stateKey} className="sheet-swap">
            <ZoneEmpty />
          </div>
        )}
      </div>
    </div>
  );
}
