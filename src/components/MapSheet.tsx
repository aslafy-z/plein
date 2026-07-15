import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import Freshness from './Freshness';
import Star from './Star';

/** Share of the map stage the expanded sheet covers */
const EXPAND_RATIO = 0.75;
/** Pointer must travel this far before a tap becomes a drag */
const DRAG_SLOP_PX = 6;

/**
 * Bottom sheet over the map. Collapsed: the cheapest (or map-selected)
 * station card. Pulling the handle up reveals the list of the stations in
 * the radius; tapping a row selects the station on the map (highlighted pin,
 * map pans onto it) — the map ↔ list link.
 *
 * Height changes are animated and the content cross-fades between the
 * card / loading / empty states, so panning over a station-less area
 * doesn't blink.
 */
export default function MapSheet({
  stageH,
  onCollapsedHeight,
}: {
  /** Height of the map stage the sheet lives in (drives the expanded size) */
  stageH: number;
  /** Reports the collapsed height so the map keeps that strip free */
  onCollapsedHeight: (h: number) => void;
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

  const [expanded, setExpanded] = useState(false);
  const [dragH, setDragH] = useState<number | null>(null);
  const [collapsedH, setCollapsedH] = useState<number | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ startY: 0, startH: 0, moved: false });

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
    if (!hasCard) {
      setExpanded(false);
      setDragH(null);
    }
  }, [hasCard]);

  const expandedH = Math.max(
    collapsedH ?? 0,
    Math.min(Math.round(stageH * EXPAND_RATIO), stageH - 64),
  );

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasCard || collapsedH == null || stageH <= 0) return;
    drag.current = { startY: e.clientY, startH: expanded ? expandedH : collapsedH, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dy = drag.current.startY - e.clientY;
    if (!drag.current.moved && Math.abs(dy) < DRAG_SLOP_PX) return;
    drag.current.moved = true;
    setDragH(Math.min(expandedH, Math.max(collapsedH ?? 0, drag.current.startH + dy)));
  };
  const settle = (toggleOnTap: boolean) => {
    if (!drag.current.moved) {
      if (toggleOnTap) setExpanded((v) => !v);
    } else {
      const h = dragH ?? collapsedH ?? 0;
      setExpanded(h > ((collapsedH ?? 0) + expandedH) / 2);
    }
    setDragH(null);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    settle(true);
  };
  const cancelDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    settle(false);
  };

  const stateKey = hasCard ? 'card' : loading ? 'loading' : 'empty';
  const height = dragH ?? (expanded && hasCard ? expandedH : (collapsedH ?? undefined));

  const isBest = shown != null && cheapest?.id === shown.id;
  const shownPrice = shown?.prices[app.fuel]?.value ?? 0;
  const shownDelta = shownPrice - min;

  return (
    <div
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
        transition: dragH != null ? undefined : 'height .3s cubic-bezier(.4,0,.2,1)',
      }}
    >
      {/* ── Collapsed part (measured — the map stops above it) ── */}
      <div ref={headerRef} style={{ flexShrink: 0 }}>
        <div key={stateKey} className="sheet-swap">
          {shown ? (
            <div style={{ padding: '0 20px 18px' }}>
              {/* Drag handle — pull up for the list, tap to toggle */}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? 'Réduire la liste des stations'
                    : 'Voir la liste des stations de la zone'
                }
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpanded((v) => !v);
                  }
                }}
                style={{
                  padding: '10px 0 8px',
                  margin: '0 -20px',
                  cursor: 'grab',
                  touchAction: 'none',
                }}
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
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 12,
                    background: C.surface3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: C.mut,
                    fontWeight: 800,
                    fontSize: 15,
                    flexShrink: 0,
                  }}
                >
                  {shown.init}
                </div>
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

      {/* ── Station list revealed by pulling the handle up ── */}
      {hasCard && collapsedH != null && (
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
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
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
              const isFocus = app.focusStationId === s.id;
              const price = s.prices[app.fuel]!.value;
              const delta = price - min;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    // Locate on the map: highlighted pin + pan, card in the sheet
                    app.setFocusStation(s.id);
                    setExpanded(false);
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
                    border: isFocus
                      ? `1.5px solid ${C.accent}`
                      : `1px solid ${best ? C.accentBorder : C.border}`,
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 11,
                      background: C.surface3,
                      color: C.mut,
                      fontWeight: 800,
                      fontSize: 12.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {s.init}
                  </div>
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
          </div>
        </div>
      )}
    </div>
  );
}
