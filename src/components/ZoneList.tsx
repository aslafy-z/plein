import type { DOMAttributes, Ref } from 'react';
import { C, mono } from '../theme';
import {
  useApp,
  selectSorted,
  selectCheapest,
  selectRecommended,
  selectPriceRange,
  selectPriceStats,
  selectDeals,
  effectivePrice,
  priceTier,
  priceCents,
} from '../state/store';
import { fmtPrice, distLabel } from '../lib/format';
import { openStatusShort } from '../lib/labels';
import { useIsDesktop } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import { openStatus } from '../lib/hours';
import BrandAvatar from './BrandAvatar';

/**
 * Every station of the zone, sorted by price or distance, deals highlighted.
 * A row selects its station on the map (highlighted pin, map pans onto it) —
 * the map ↔ list link.
 *
 * Shared by the two arrangements of the zone: what the phone's bottom sheet
 * expands into, and the body of the panel docked beside the map on desktop.
 * The phone hands its scroller the pointer handlers that let a downward pull
 * from the top of the list take the sheet with it; the panel doesn't drag,
 * so it passes none.
 */
export default function ZoneList({
  scrollerRef,
  gestures,
  onRowPick,
}: {
  /** The phone sheet reads the scroll offset to arm its drag-to-close */
  scrollerRef?: Ref<HTMLDivElement>;
  /** Pointer handlers the phone sheet puts on the scroller */
  gestures?: DOMAttributes<HTMLDivElement>;
  /** Called after a row is picked — the phone sheet collapses onto the map */
  onRowPick?: () => void;
}) {
  const app = useApp();
  const desktop = useIsDesktop();
  const rows = selectSorted(app);
  const cheapest = selectCheapest(app);
  const reco = selectRecommended(app);
  const range = selectPriceRange(app);
  // « Bons plans » (near-identical low prices): the card still preselects a
  // single station, but the list highlights all of them
  const stats = selectPriceStats(app);
  const dealCount = selectDeals(app).length;
  const min = range?.min ?? 0;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderTop: `1px solid ${C.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px 10px' }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: C.mut,
            flex: 1,
          }}
        >
          {m.sheet_zone_count({ count: rows.length })}
        </span>
        {dealCount > 1 && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: C.accent,
              whiteSpace: 'nowrap',
            }}
          >
            {m.sheet_deal_count({ count: dealCount })}
          </span>
        )}
        {(
          [
            ['price', m.sheet_sort_price()],
            ['distance', m.sheet_sort_distance()],
          ] as const
        ).map(([k, label]) => {
          const active = app.sort === k;
          return (
            <button
              key={k}
              onClick={() => app.setSort(k)}
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: active ? C.onAccent : C.mut,
                background: active ? C.accent : C.surface2,
                padding: '6px 12px',
                borderRadius: 14,
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        ref={scrollerRef}
        data-testid="zone-list"
        {...gestures}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
          padding: '0 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {rows.length === 0 && (
          <div style={{ textAlign: 'center', color: C.mut, fontSize: 13, padding: '18px 0' }}>
            {m.sheet_empty_radius()}
          </div>
        )}
        {rows.map((s) => {
          const best = cheapest?.id === s.id;
          // Recommended over the sticker-cheapest (closer, better
          // effective price) — flagged so its row explains the card
          const recoRow = !best && reco?.id === s.id;
          const isFocus = app.focusStationId === s.id;
          const price = effectivePrice(s, app.fuel)!.value;
          // Rows are zone stations — the zone floor applies (the cheapest
          // of the circle is a bon plan even when the area has cheaper).
          // The recommended row is highlighted like a deal whatever its
          // tier, so it matches its card — without moving the tier bounds.
          const deal = priceTier(price, stats, true) === 'deal' || recoRow;
          const delta = (priceCents(price) - priceCents(min)) / 100;
          const rowStatus = openStatus(s.hours);

          const identity = (
            <>
              <BrandAvatar label={s.brand ?? s.name} init={s.init} size={38} fontSize={12.5} />
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 700,
                    color: C.ink,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.name}
                </div>
                <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>
                  {[distLabel(s.distKm), rowStatus ? openStatusShort(rowStatus) : undefined]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </>
          );

          const priceBlock = (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ font: mono(700, 17), color: deal ? C.accent : C.ink, whiteSpace: 'nowrap' }}>
                {fmtPrice(price)} €
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: deal ? C.accent : delta > 0.12 ? C.warn : C.mut,
                  whiteSpace: 'nowrap',
                }}
              >
                {/* Sub-cent deltas read « +0,00 » — at the displayed
                    precision these prices are simply equal, say nothing */}
                {best
                  ? m.sheet_row_best_price()
                  : recoRow
                    ? m.sheet_row_recommended({ delta: fmtPrice(delta) })
                    : deal
                      ? Math.abs(delta) >= 0.005
                        ? m.sheet_row_deal_delta({ delta: fmtPrice(delta) })
                        : m.sheet_row_deal()
                      : m.sheet_row_delta({ delta: fmtPrice(delta) })}
              </div>
            </div>
          );

          /** Locate on the map: highlighted pin + pan, card at the top */
          const locate = (
            <button
              onClick={() => {
                app.setFocusStation(s.id);
                onRowPick?.();
              }}
              aria-label={m.sheet_locate_aria({ station: s.name })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flex: 1,
                minWidth: 0,
                alignSelf: 'stretch',
              }}
            >
              {identity}
              {/* On a phone the row is one target, so the price rides with it */}
              {!desktop && priceBlock}
            </button>
          );

          const rowStyle = {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            background: deal ? C.accentSoft09 : C.surface2,
            borderRadius: 14,
            padding: '11px 14px',
            flexShrink: 0,
            border: isFocus
              ? `1.5px solid ${C.accent}`
              : `1px solid ${deal ? C.accentBorderStrong : C.border}`,
          };

          // A phone row does one thing: it locates the station, and the sheet
          // collapses onto the map where the card — the way into the fiche —
          // is now showing it. Nothing collapses on a window: the list stays
          // put, so a row that only re-highlights a pin reads as dead and the
          // fiche needs a door of its own here.
          if (!desktop) {
            return (
              <div key={s.id} data-testid="zone-row" style={rowStyle}>
                {locate}
              </div>
            );
          }

          // That door is the whole right-hand side — price, gap and chevron
          // together. A bare chevron is a 15px target asking to be missed.
          return (
            <div key={s.id} data-testid="zone-row" style={rowStyle}>
              {locate}
              <button
                onClick={() => app.openStation(s.id)}
                aria-label={m.sheet_open_station_aria({ station: s.name })}
                title={m.sheet_open_station_aria({ station: s.name })}
                style={{
                  flexShrink: 0,
                  alignSelf: 'stretch',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  paddingLeft: 12,
                  borderLeft: `1px solid ${deal ? C.accentBorder : C.border}`,
                }}
              >
                {priceBlock}
                <span aria-hidden style={{ color: C.mut, fontSize: 15, fontWeight: 700 }}>
                  ›
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
