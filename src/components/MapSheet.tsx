import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { C, mono } from '../theme';
import { FUEL_LABELS } from '../data/types';
import {
  useApp,
  selectSorted,
  selectCheapest,
  selectRecommended,
  selectPriceRange,
  selectPriceStats,
  selectDeals,
  selectFocusStation,
  selectZoneFuels,
  effectiveFuel,
  effectivePrice,
  priceTier,
  priceCents,
} from '../state/store';
import { fmtPrice, distLabel, agoLabel, durationLabel, plural } from '../lib/format';
import { openStatus } from '../lib/hours';
import BrandAvatar from './BrandAvatar';
import Freshness from './Freshness';
import Star from './Star';

/** Share of the map stage the expanded sheet covers */
const EXPAND_RATIO = 0.75;
/** Pointer must travel this far before a tap becomes a drag */
const DRAG_SLOP_PX = 6;
/** Release speed (px/ms) above which the sheet snaps in the fling direction */
const FLING_VPS = 0.45;
/** Fling speed is averaged over the samples of this trailing window */
const FLING_WINDOW_MS = 100;
/** Pointer parked longer than this before release → the fling is cancelled */
const FLING_HOLD_MS = 150;
const TRANSITION = 'height .3s cubic-bezier(.4,0,.2,1)';

/**
 * Bottom sheet over the map. Collapsed: the cheapest (or map-selected)
 * station card. Pulling it up reveals the list of the stations in the
 * radius; tapping a row selects the station on the map (highlighted pin,
 * map pans onto it) — the map ↔ list link.
 *
 * Gestures: the whole sheet drags, not just the handle — swipe up/down
 * anywhere on the station card, and swipe down on the list itself when it
 * is scrolled to the top (native scroll otherwise). During a drag the
 * height is written straight to the DOM (no React re-render per frame) and
 * the release snaps in the fling direction when the gesture is fast, so a
 * short flick opens or closes.
 */
export default function MapSheet({
  stageH,
  onCollapsedHeight,
  expanded,
  onExpandedChange,
}: {
  /** Height of the map stage the sheet lives in (drives the expanded size) */
  stageH: number;
  /** Reports the collapsed height so the map keeps that strip free */
  onCollapsedHeight: (h: number) => void;
  /** Open state lives in MapScreen (the map overlay needs it too) */
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
}) {
  const app = useApp();
  const cheapest = selectCheapest(app);
  // The card crowns the best DEAL (effective price, round-trip fuel counted)
  // — not always the lowest sticker price when a closer pump beats it
  const reco = selectRecommended(app);
  const recoIsCheapest = reco == null || cheapest == null || reco.id === cheapest.id;
  const focused = selectFocusStation(app);
  const shown = focused ?? reco;
  const rows = selectSorted(app);
  const range = selectPriceRange(app);
  // « Bons plans » (near-identical low prices): the collapsed card still
  // preselects a single station, but the expanded list highlights all of them
  const stats = selectPriceStats(app);
  const dealCount = selectDeals(app).length;
  const min = range?.min ?? 0;
  const max = range?.max ?? 0;
  const loading = app.stations.status === 'loading' || app.stations.status === 'idle';

  const hasCard = shown != null;
  // Zone empty for the SELECTED fuel: which fuels are actually sold around?
  const soldFuels = !loading && !hasCard ? selectZoneFuels(app).filter((f) => f !== app.fuel) : [];

  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [collapsedH, setCollapsedH] = useState<number | null>(null);

  // Measure the always-visible part; the map keeps that strip free below it
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      setCollapsedH(el.offsetHeight);
      onCollapsedHeight(el.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onCollapsedHeight]);

  // No station card → nothing to expand to
  useEffect(() => {
    if (!hasCard && expanded) onExpandedChange(false);
  }, [hasCard, expanded, onExpandedChange]);

  const expandedH = Math.max(
    collapsedH ?? 0,
    Math.min(Math.round(stageH * EXPAND_RATIO), stageH - 64),
  );

  // ── Gesture engine ─────────────────────────────────────────────────────────
  // During a drag the height is written straight onto the DOM node inside a
  // rAF (no React state per pointermove — a re-rendering list makes the drag
  // stutter, which reads as "resistance"). React state only commits on
  // release. `dims` mirrors the current render so the stable callbacks and
  // the native touch listeners never see stale values.
  const dims = useRef({ min: 0, max: 0, expanded: false, canDrag: false });
  dims.current = {
    min: collapsedH ?? 0,
    max: expandedH,
    expanded,
    canDrag: hasCard && collapsedH != null && stageH > 0,
  };
  const openRef = useRef(onExpandedChange);
  openRef.current = onExpandedChange;

  const g = useRef({
    active: false,
    moved: false,
    fromHandle: false,
    toggled: false,
    startY: 0,
    startH: 0,
    samples: [] as { y: number; t: number }[],
    raf: 0,
    pendingH: 0,
  });

  const dragEnd = useCallback((cancelled = false, t = performance.now()) => {
    const el = rootRef.current;
    const s = g.current;
    if (!el || !s.active) return;
    s.active = false;
    if (s.raf) {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    }
    el.style.transition = TRANSITION;
    // A motionless press is a tap, not a gesture: the height was never
    // touched and the open/close decision belongs to the tap handlers —
    // voting from the current height here would race the handle's toggle.
    if (!s.moved) return;
    // Fling velocity: displacement over the trailing samples, measured on
    // event timestamps — a busy main thread delivers moves late and
    // coalesced, and that must not turn a real flick into a slow gesture.
    // The trailing span is the fixed window widened backwards across gaps
    // that carry fast displacement (motion delivered late), and it stops at
    // still gaps (a genuine pause: what precedes it must not lend the
    // release any speed). A pointer parked before releasing has no speed.
    const last = s.samples[s.samples.length - 1];
    let v = 0; // > 0 = upward
    if (t - last.t <= FLING_HOLD_MS) {
      let i = s.samples.length - 1;
      while (i > 0) {
        const prev = s.samples[i - 1];
        const gap = s.samples[i].t - prev.t;
        const fastGap = gap > 0 && Math.abs(s.samples[i].y - prev.y) / gap > FLING_VPS / 2;
        if (last.t - prev.t > FLING_WINDOW_MS && !fastGap) break;
        i--;
      }
      const from = s.samples[i];
      if (last.t > from.t) v = (from.y - last.y) / (last.t - from.t);
    }
    const d = dims.current;
    const h = el.getBoundingClientRect().height;
    let open: boolean;
    if (!cancelled && Math.abs(v) > FLING_VPS) {
      open = v > 0; // fling: follow the gesture direction, whatever the travel
    } else {
      open = h > (d.min + d.max) / 2;
    }
    el.style.height = `${open ? d.max : d.min}px`;
    openRef.current(open);
    // keep `moved` up until the trailing click has been swallowed
    setTimeout(() => {
      g.current.moved = false;
    }, 0);
  }, []);

  const dragBegin = useCallback(
    (y: number, t: number) => {
      const el = rootRef.current;
      if (!el || !dims.current.canDrag || g.current.active) return;
      g.current = {
        ...g.current,
        active: true,
        moved: false,
        startY: y,
        startH: el.getBoundingClientRect().height,
        samples: [{ y, t }],
        pendingH: 0,
      };
      el.style.transition = 'none';
      // The pointer may be released outside the sheet before any capture
      const done = (e: PointerEvent) => {
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', done);
        dragEnd(e.type === 'pointercancel', e.timeStamp);
      };
      window.addEventListener('pointerup', done);
      window.addEventListener('pointercancel', done);
    },
    [dragEnd],
  );

  const dragMove = useCallback((y: number, t: number) => {
    const el = rootRef.current;
    const s = g.current;
    if (!el || !s.active) return;
    if (!s.moved && Math.abs(y - s.startY) < DRAG_SLOP_PX) return;
    s.moved = true;
    s.samples.push({ y, t });
    while (s.samples.length > 1 && t - s.samples[0].t > FLING_WINDOW_MS + FLING_HOLD_MS) {
      s.samples.shift();
    }
    const d = dims.current;
    s.pendingH = Math.min(d.max, Math.max(d.min, s.startH + (s.startY - y)));
    if (!s.raf) {
      s.raf = requestAnimationFrame(() => {
        s.raf = 0;
        if (s.active && rootRef.current) rootRef.current.style.height = `${s.pendingH}px`;
      });
    }
  }, []);

  // If React re-renders mid-drag (background refresh…), re-assert the
  // gesture height it would otherwise overwrite.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el && g.current.active && g.current.pendingH) {
      el.style.transition = 'none';
      el.style.height = `${g.current.pendingH}px`;
    }
  });

  // ── Card zone: drag from anywhere on the collapsed card ──
  const handleRef = useRef<HTMLDivElement>(null);
  const cardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    g.current.fromHandle = !!handleRef.current?.contains(e.target as Node);
    g.current.toggled = false;
    dragBegin(e.clientY, e.timeStamp);
  };
  const cardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!g.current.active) return;
    const wasMoved = g.current.moved;
    dragMove(e.clientY, e.timeStamp);
    if (!wasMoved && g.current.moved) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const cardPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // A tap on the handle toggles here, on pointerup, from this stable
    // ancestor: the browser `click` that used to carry the toggle is lost
    // whenever the pressed node is swapped by a re-render mid-press (the
    // click retargets to an ancestor without a click handler) — seen as
    // taps that silently do nothing on slow machines.
    const tap = g.current.active && !g.current.moved && g.current.fromHandle;
    dragEnd(false, e.timeStamp);
    if (tap) {
      g.current.toggled = true;
      onExpandedChange(!expanded);
    }
  };
  const cardPointerCancel = () => dragEnd(true);
  // A drag must not leak a click into the card's buttons on release
  const swallowClickAfterDrag = (e: React.MouseEvent) => {
    if (g.current.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ── List zone (mouse): drag down from the top of the list closes ──
  const listArm = useRef<{ y: number; t: number; top: number } | null>(null);
  const listPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return; // touch has its own path below
    listArm.current = { y: e.clientY, t: e.timeStamp, top: listRef.current?.scrollTop ?? 0 };
  };
  const listPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (g.current.active) {
      const wasMoved = g.current.moved;
      dragMove(e.clientY, e.timeStamp);
      if (!wasMoved && g.current.moved) e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const arm = listArm.current;
    if (!arm) return;
    const dy = e.clientY - arm.y;
    if (dy > DRAG_SLOP_PX && arm.top <= 0) {
      dragBegin(arm.y, arm.t);
      dragMove(e.clientY, e.timeStamp);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (Math.abs(dy) > DRAG_SLOP_PX) {
      listArm.current = null; // upward or scrolled: not a sheet gesture
    }
  };
  const listPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (g.current.active) dragEnd(false, e.timeStamp);
    listArm.current = null;
  };

  // ── List zone (touch): native scroll physics, but a downward pull while
  // already at the top takes the sheet with it (Google-Maps behaviour).
  // touchmove must be non-passive to preventDefault, hence the listener.
  const listAttached = hasCard && collapsedH != null;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !listAttached) return;
    let armY = 0;
    let armT = 0;
    let armTop = 0;
    let armed = false;
    const start = (e: TouchEvent) => {
      armY = e.touches[0].clientY;
      armT = e.timeStamp;
      armTop = el.scrollTop;
      armed = true;
    };
    const move = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      if (g.current.active) {
        e.preventDefault();
        dragMove(y, e.timeStamp);
        return;
      }
      if (!armed) return;
      const dy = y - armY;
      if (dy > DRAG_SLOP_PX && armTop <= 0 && el.scrollTop <= 0) {
        dragBegin(armY, armT);
        dragMove(y, e.timeStamp);
        e.preventDefault();
      } else if (Math.abs(dy) > DRAG_SLOP_PX) {
        armed = false;
      }
    };
    const end = (e: TouchEvent) => {
      if (g.current.active) dragEnd(false, e.timeStamp);
      armed = false;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [listAttached, dragBegin, dragMove, dragEnd]);

  const stateKey = hasCard ? 'card' : loading ? 'loading' : 'empty';
  const height = expanded && hasCard ? expandedH : (collapsedH ?? undefined);

  const isBest = shown != null && cheapest?.id === shown.id;
  const shownPrice = (shown && effectivePrice(shown, app.fuel)?.value) || 0;
  // Deltas at DISPLAYED precision: what the user reads is (price shown) −
  // (min shown), never a tenth-of-a-cent artifact off by one
  const shownDelta = (priceCents(shownPrice) - priceCents(min)) / 100;

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: C.surface,
        borderRadius: '24px 24px 0 0',
        boxShadow: '0 -10px 30px rgba(0,0,0,.45)',
        height,
        transition: TRANSITION,
      }}
    >
      {/* ── Collapsed part (measured — the map stops above it) ── */}
      <div
        ref={headerRef}
        style={{ flexShrink: 0, touchAction: 'none', cursor: hasCard ? 'grab' : undefined }}
        onPointerDown={cardPointerDown}
        onPointerMove={cardPointerMove}
        onPointerUp={cardPointerUp}
        onPointerCancel={cardPointerCancel}
        onClickCapture={swallowClickAfterDrag}
      >
        <div key={stateKey} className="sheet-swap">
          {shown ? (
            <div style={{ padding: '0 20px 18px' }}>
              {/* Drag handle — kept as the visible affordance + a11y toggle.
                  Pointer taps toggle in cardPointerUp; onClick only serves
                  keyboard/AT synthetic clicks (no pointerup precedes them). */}
              <div
                ref={handleRef}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? 'Réduire la liste des stations'
                    : 'Voir la liste des stations de la zone'
                }
                onClick={() => {
                  if (g.current.toggled) {
                    g.current.toggled = false;
                    return;
                  }
                  onExpandedChange(!expanded);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onExpandedChange(!expanded);
                  }
                }}
                style={{ padding: '10px 0 8px', margin: '0 -20px' }}
              >
                <div
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: 2,
                    background: 'rgba(255,255,255,.18)',
                    margin: '0 auto',
                  }}
                />
              </div>

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
                  {focused
                    ? 'Station sélectionnée'
                    : (recoIsCheapest ? 'La moins chère' : 'Le meilleur choix') +
                      (app.searchedAway ? ' dans cette zone' : ' près de vous')}
                </span>
                {focused && (
                  <button
                    onClick={() => app.setFocusStation(null)}
                    aria-label="Désélectionner la station"
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
                      ? `Retirer ${shown.name} des favoris`
                      : `Ajouter ${shown.name} aux favoris`
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
                      openStatus(shown.hours)?.short,
                      `MàJ ${agoLabel(effectivePrice(shown, app.fuel)?.updatedAt)}`,
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
                    {FUEL_LABELS[effectiveFuel(shown, app.fuel) ?? app.fuel]} / L
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
                  Y aller · {durationLabel(shown.driveMin)}
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
                  {isBest
                    ? `−${fmtPrice((priceCents(max) - priceCents(min)) / 100)} €/L`
                    : `${shownDelta >= 0 ? '+' : '−'}${fmtPrice(Math.abs(shownDelta))} €/L`}
                </div>
              </div>
            </div>
          ) : loading ? (
            <div
              style={{ padding: '18px 20px', textAlign: 'center', color: C.mut, fontSize: 13.5 }}
            >
              Recherche des stations autour de vous…
            </div>
          ) : soldFuels.length > 0 ? (
            // Stations around, but none sells the selected fuel (no E10/E85
            // outside France…) — name the culprit and offer what IS sold
            <div
              style={{ padding: '16px 20px 18px', textAlign: 'center', color: C.mut, fontSize: 13.5 }}
            >
              Aucune station ne vend du {FUEL_LABELS[app.fuel]} dans cette zone.
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <span style={{ alignSelf: 'center' }}>Vendus ici :</span>
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
                    {FUEL_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
              style={{ padding: '18px 20px', textAlign: 'center', color: C.mut, fontSize: 13.5 }}
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
      </div>

      {/* ── Station list revealed by pulling the sheet up ── */}
      {listAttached && (
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
              {plural(rows.length, 'station')} dans la zone
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
                {dealCount} bons plans
              </span>
            )}
            {([['prix', 'Prix'], ['dist', 'Distance']] as const).map(([k, label]) => {
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
            ref={listRef}
            data-testid="zone-list"
            onPointerDown={listPointerDown}
            onPointerMove={listPointerMove}
            onPointerUp={listPointerUp}
            onPointerCancel={listPointerUp}
            onClickCapture={swallowClickAfterDrag}
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
                Aucune station dans le rayon.
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
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    // Locate on the map: highlighted pin + pan, card in the sheet
                    app.setFocusStation(s.id);
                    onExpandedChange(false);
                  }}
                  aria-label={`Voir ${s.name} sur la carte`}
                  style={{
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
                  }}
                >
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
                      {[distLabel(s.distKm), openStatus(s.hours)?.short].filter(Boolean).join(' · ')}
                    </div>
                  </div>
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
                        ? 'meilleur prix'
                        : recoRow
                          ? `recommandée · +${fmtPrice(delta)}`
                          : deal
                            ? `bon plan${Math.abs(delta) >= 0.005 ? ` · +${fmtPrice(delta)}` : ''}`
                            : `+${fmtPrice(delta)}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
