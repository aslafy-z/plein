import { useEffect, useRef, type DOMAttributes, type MutableRefObject, type Ref } from 'react';
import { C, mono } from '../theme';
import type { SheetGestures } from './SheetShell';
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
 * Every station of the zone, sorted by effective price (« Recommandé », the
 * default), sticker price or distance, deals highlighted.
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
  staticBarGestures,
  onRowPick,
}: {
  /** The phone sheet reads the scroll offset to arm its drag-to-close */
  scrollerRef?: Ref<HTMLDivElement>;
  /** Pointer handlers the phone sheet puts on the scroller */
  gestures?: DOMAttributes<HTMLDivElement>;
  /** Pointer handlers the phone sheet puts on the count/sort row — it sits
      above the scroller and scrolls nothing, so it drags the sheet like the
      card does; the panel doesn't drag and passes none */
  staticBarGestures?: SheetGestures;
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

  // The list follows the map: selecting a pin scrolls its row into view —
  // the sheet (phone) already hands us a scroller ref, so tee into it
  const listRef = useRef<HTMLDivElement | null>(null);
  const setScroller = (el: HTMLDivElement | null) => {
    listRef.current = el;
    if (typeof scrollerRef === 'function') scrollerRef(el);
    else if (scrollerRef) (scrollerRef as MutableRefObject<HTMLDivElement | null>).current = el;
  };
  const focusId = app.focusStationId;
  useEffect(() => {
    const scroller = listRef.current;
    if (!focusId || !scroller) return;
    // Scroll THE LIST only — scrollIntoView also scrolls every scrollable
    // ancestor, and on the phone that dragged the absolutely-positioned map
    // stage along and cut it at the bottom. Under the collapsed sheet the
    // scroller has no height yet, so the attempt re-runs when it gets one
    // (the sheet expanding) and stops after the first success.
    let pending = true;
    const ro = new ResizeObserver(() => attempt());
    const attempt = () => {
      if (!pending) return;
      const row = scroller.querySelector(`[data-station-id="${CSS.escape(focusId)}"]`);
      if (!row || scroller.clientHeight < 60) return;
      const s = scroller.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      if (r.top < s.top) scroller.scrollBy({ top: r.top - s.top - 8, behavior: 'smooth' });
      else if (r.bottom > s.bottom)
        scroller.scrollBy({ top: r.bottom - s.bottom + 8, behavior: 'smooth' });
      pending = false;
      ro.disconnect();
    };
    attempt();
    if (pending) ro.observe(scroller);
    return () => ro.disconnect();
  }, [focusId]);

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
      {/* One line, whatever the width: the compact count, the deals beside
          it, the sort at the right edge. The panel floor (PANEL_WIDTH) is
          exactly what this row needs — « {n} stations dans la zone » wrapped
          onto three lines there, so the count dropped the zone suffix the
          list already IS. */}
      <div
        {...staticBarGestures}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 20px 10px',
          ...(staticBarGestures ? { touchAction: 'none', cursor: 'grab' } : null),
        }}
      >
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: C.mut,
            whiteSpace: 'nowrap',
          }}
        >
          {m.sheet_zone_count_compact({ count: rows.length })}
        </span>
        {dealCount > 1 && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: C.accent,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {m.sheet_deal_count({ count: dealCount })}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {(
          [
            ['recommended', m.sheet_sort_recommended()],
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
                fontSize: 12,
                fontWeight: 700,
                color: active ? C.onAccent : C.mut,
                background: active ? C.accent : C.surface2,
                padding: '5px 11px',
                borderRadius: 14,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        ref={setScroller}
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
              {priceBlock}
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
          // is now showing it. A window skips that intermediate step: one
          // click opens the fiche right under the list (which stays put, so
          // the next station is one click too) and the fiche itself selects
          // the station on the live map.
          if (!desktop) {
            return (
              <div key={s.id} data-station-id={s.id} data-testid="zone-row" style={rowStyle}>
                {locate}
              </div>
            );
          }

          return (
            <div key={s.id} data-station-id={s.id} data-testid="zone-row" style={rowStyle}>
              <button
                onClick={() => app.openStation(s.id)}
                aria-label={m.sheet_open_station_aria({ station: s.name })}
                title={m.sheet_open_station_aria({ station: s.name })}
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
                {priceBlock}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
