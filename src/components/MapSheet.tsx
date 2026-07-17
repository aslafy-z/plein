import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { C, mono } from '../theme';
import { FUEL_LABELS } from '../data/types';
import {
  useApp,
  selectSorted,
  selectCheapest,
  selectPriceRange,
  selectFocusStation,
} from '../state/store';
import { fmtPrice, distLabel, agoLabel, plural } from '../lib/format';
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
const TRANSITION = 'height .3s cubic-bezier(.4,0,.2,1)';
/** Dense zones: the list opens on the N best rows, the rest behind a button */
const LIST_CAP = 15;

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
  const focused = selectFocusStation(app);
  const shown = focused ?? cheapest;
  const rows = selectSorted(app);
  const range = selectPriceRange(app);
  const min = range?.min ?? 0;
  const max = range?.max ?? 0;
  const loading = app.stations.status === 'loading' || app.stations.status === 'idle';

  const hasCard = shown != null;

  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [collapsedH, setCollapsedH] = useState<number | null>(null);

  // Dense zones: only the LIST_CAP best rows (cheapest or nearest, per the
  // active sort) until « Afficher les N autres » is tapped. Back to the capped
  // view whenever the zone changes or the sheet closes — a fresh look at a
  // zone should always lead with the best picks.
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setShowAll(false);
  }, [app.searchPos, app.radius, app.fuel]);
  useEffect(() => {
    if (!expanded) setShowAll(false);
  }, [expanded]);

  const capped = !showAll && rows.length > LIST_CAP;
  const shownRows = capped ? rows.slice(0, LIST_CAP) : rows;
  const hiddenCount = rows.length - shownRows.length;

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
    startY: 0,
    startH: 0,
    lastY: 0,
    lastT: 0,
    v: 0,
    raf: 0,
    pendingH: 0,
  });

  const dragEnd = useCallback((cancelled = false) => {
    const el = rootRef.current;
    const s = g.current;
    if (!el || !s.active) return;
    s.active = false;
    if (s.raf) {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    }
    const d = dims.current;
    const h = el.getBoundingClientRect().height;
    let open: boolean;
    if (!cancelled && s.moved && Math.abs(s.v) > FLING_VPS) {
      open = s.v > 0; // fling: follow the gesture direction, whatever the travel
    } else {
      open = h > (d.min + d.max) / 2;
    }
    el.style.transition = TRANSITION;
    el.style.height = `${open ? d.max : d.min}px`;
    openRef.current(open);
    // keep `moved` up until the trailing click has been swallowed
    setTimeout(() => {
      g.current.moved = false;
    }, 0);
  }, []);

  const dragBegin = useCallback(
    (y: number) => {
      const el = rootRef.current;
      if (!el || !dims.current.canDrag || g.current.active) return;
      g.current = {
        ...g.current,
        active: true,
        moved: false,
        startY: y,
        startH: el.getBoundingClientRect().height,
        lastY: y,
        lastT: performance.now(),
        v: 0,
        pendingH: 0,
      };
      el.style.transition = 'none';
      // The pointer may be released outside the sheet before any capture
      const done = () => {
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', done);
        dragEnd();
      };
      window.addEventListener('pointerup', done);
      window.addEventListener('pointercancel', done);
    },
    [dragEnd],
  );

  const dragMove = useCallback((y: number) => {
    const el = rootRef.current;
    const s = g.current;
    if (!el || !s.active) return;
    if (!s.moved && Math.abs(y - s.startY) < DRAG_SLOP_PX) return;
    s.moved = true;
    const now = performance.now();
    const dt = now - s.lastT;
    if (dt > 0) {
      const inst = (s.lastY - y) / dt; // > 0 = finger moving up (opening)
      s.v = 0.7 * inst + 0.3 * s.v;
    }
    s.lastY = y;
    s.lastT = now;
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
  const cardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragBegin(e.clientY);
  };
  const cardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!g.current.active) return;
    const wasMoved = g.current.moved;
    dragMove(e.clientY);
    if (!wasMoved && g.current.moved) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const cardPointerUp = () => dragEnd();
  const cardPointerCancel = () => dragEnd(true);
  // A drag must not leak a click into the card's buttons on release
  const swallowClickAfterDrag = (e: React.MouseEvent) => {
    if (g.current.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ── List zone (mouse): drag down from the top of the list closes ──
  const listArm = useRef<{ y: number; top: number } | null>(null);
  const listPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return; // touch has its own path below
    listArm.current = { y: e.clientY, top: listRef.current?.scrollTop ?? 0 };
  };
  const listPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (g.current.active) {
      const wasMoved = g.current.moved;
      dragMove(e.clientY);
      if (!wasMoved && g.current.moved) e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const arm = listArm.current;
    if (!arm) return;
    const dy = e.clientY - arm.y;
    if (dy > DRAG_SLOP_PX && arm.top <= 0) {
      dragBegin(arm.y);
      dragMove(e.clientY);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (Math.abs(dy) > DRAG_SLOP_PX) {
      listArm.current = null; // upward or scrolled: not a sheet gesture
    }
  };
  const listPointerUp = () => {
    if (g.current.active) dragEnd();
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
    let armTop = 0;
    let armed = false;
    const start = (e: TouchEvent) => {
      armY = e.touches[0].clientY;
      armTop = el.scrollTop;
      armed = true;
    };
    const move = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      if (g.current.active) {
        e.preventDefault();
        dragMove(y);
        return;
      }
      if (!armed) return;
      const dy = y - armY;
      if (dy > DRAG_SLOP_PX && armTop <= 0 && el.scrollTop <= 0) {
        dragBegin(armY);
        dragMove(y);
        e.preventDefault();
      } else if (Math.abs(dy) > DRAG_SLOP_PX) {
        armed = false;
      }
    };
    const end = () => {
      if (g.current.active) dragEnd();
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
  const shownPrice = shown?.prices[app.fuel]?.value ?? 0;
  const shownDelta = shownPrice - min;

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
              {/* Drag handle — kept as the visible affordance + a11y toggle */}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? 'Réduire la liste des stations'
                    : 'Voir la liste des stations de la zone'
                }
                onClick={() => onExpandedChange(!expanded)}
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
                    : app.searchedAway
                      ? 'La moins chère dans cette zone'
                      : 'La moins chère près de vous'}
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
                      `MàJ ${agoLabel(shown.prices[app.fuel]?.updatedAt)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ font: mono(700, 22), color: C.accent, whiteSpace: 'nowrap' }}>
                    {fmtPrice(shown.prices[app.fuel]?.value)} €
                  </div>
                  <div style={{ color: C.mut, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                    {FUEL_LABELS[app.fuel]} / L
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
                  Y aller · {shown.driveMin} min
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
                    ? `−${fmtPrice(max - min)} €/L`
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
            {shownRows.map((s) => {
              const best = cheapest?.id === s.id;
              const isFocus = app.focusStationId === s.id;
              const price = s.prices[app.fuel]!.value;
              const delta = price - min;
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
                    background: C.surface2,
                    borderRadius: 14,
                    padding: '11px 14px',
                    flexShrink: 0,
                    border: isFocus
                      ? `1.5px solid ${C.accent}`
                      : `1px solid ${best ? C.accentBorder : C.border}`,
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
                    <div style={{ font: mono(700, 17), color: best ? C.accent : C.ink, whiteSpace: 'nowrap' }}>
                      {fmtPrice(price)} €
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: best ? C.accent : delta > 0.12 ? C.warn : C.mut,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {best ? 'meilleur prix' : `+${fmtPrice(delta)}`}
                    </div>
                  </div>
                </button>
              );
            })}
            {capped && (
              <button
                data-testid="zone-list-more"
                onClick={() => setShowAll(true)}
                aria-label={`Afficher ${plural(hiddenCount, 'autre station', 'autres stations')}`}
                style={{
                  width: '100%',
                  background: 'transparent',
                  borderRadius: 14,
                  padding: '12px 14px',
                  flexShrink: 0,
                  border: `1px dashed ${C.border09}`,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.accent }}>
                  Afficher {plural(hiddenCount, 'autre station', 'autres stations')}
                </div>
                <div style={{ fontSize: 11.5, color: C.mut, marginTop: 3 }}>
                  {app.sort === 'prix'
                    ? `Les ${LIST_CAP} moins chères de la zone sont affichées`
                    : `Les ${LIST_CAP} plus proches de la zone sont affichées`}
                </div>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
