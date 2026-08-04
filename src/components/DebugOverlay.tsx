// Developer/tester overlay — a window on the state the app already holds
// (src/lib/debugSnapshot.ts), togglable from Settings › Developer or
// `?debug=1`, for the phone in the field where DevTools don't exist.
//
// Deliberately English-only: debug chrome, not user UI (see CLAUDE.md,
// Language). Loaded lazily from App.tsx, so none of this reaches the bundle
// a normal session parses.
//
// Shell rules it must respect:
// – portalled to <body>: the bottom sheet and the full-screen search open
//   stacking contexts that would otherwise win over anything in the tree;
// – `data-sheet-no-drag` on every surface, so a drag on the chip or a scroll
//   in the panel never fights the sheet's gesture engine;
// – snapshots refresh on a short tick while the panel is OPEN — live numbers
//   are the point of watching it — and never behind a closed chip: cache
//   enumeration is async IO with no one looking.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C, FONT } from '../theme';
import { useIsDesktop } from '../lib/layout';
import { useConsoleErrorCount } from '../lib/debugMode';
import {
  collectDebugSnapshot,
  type AppDebugInput,
  type DebugSnapshot,
} from '../lib/debugSnapshot';
import { selectVisible, useApp } from '../state/store';

const Z_OVERLAY = 5000;
/** Under this movement a pointer sequence is a tap, above it a drag */
const DRAG_SLOP_PX = 6;
const CHIP = 46;
/** Refresh cadence while the panel is open */
const LIVE_REFRESH_MS = 2000;

const MONO_11 = `500 11px ${FONT.mono}`;

function sectionTitleStyle(): React.CSSProperties {
  return {
    font: `700 10px ${FONT.mono}`,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    color: C.accent,
    margin: '14px 0 6px',
  };
}

/**
 * Generic key/value renderer: scalars as label–value rows, arrays one JSON
 * line per item, nested objects as an indented block. The snapshot is data —
 * rendering it generically keeps the panel and the copied JSON one thing.
 */
function Rows({ obj, depth = 0 }: { obj: Record<string, unknown>; depth?: number }) {
  return (
    <div style={{ paddingLeft: depth ? 10 : 0 }}>
      {Object.entries(obj).map(([key, value]) => {
        if (Array.isArray(value)) {
          return (
            <div key={key} style={{ margin: '2px 0' }}>
              <span style={{ color: C.mut }}>{key}</span>
              {value.length === 0 ? (
                <span style={{ color: C.faint }}> —</span>
              ) : (
                value.map((item, i) => (
                  <div
                    key={i}
                    style={{ color: C.body, paddingLeft: 10, wordBreak: 'break-all' }}
                  >
                    {typeof item === 'object' && item !== null
                      ? JSON.stringify(item)
                      : String(item)}
                  </div>
                ))
              )}
            </div>
          );
        }
        if (value !== null && typeof value === 'object') {
          return (
            <div key={key} style={{ margin: '2px 0' }}>
              <span style={{ color: C.mut }}>{key}</span>
              <Rows obj={value as Record<string, unknown>} depth={depth + 1} />
            </div>
          );
        }
        return (
          <div
            key={key}
            style={{ display: 'flex', gap: 8, justifyContent: 'space-between', margin: '2px 0' }}
          >
            <span style={{ color: C.mut, flexShrink: 0 }}>{key}</span>
            <span style={{ color: C.body, textAlign: 'right', wordBreak: 'break-all' }}>
              {value == null ? '—' : String(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function DebugOverlay() {
  const app = useApp();
  const desktop = useIsDesktop();
  const errorCount = useConsoleErrorCount();

  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);
  const [roundCoords, setRoundCoords] = useState(true);
  const [copied, setCopied] = useState(false);
  const [collecting, setCollecting] = useState(false);

  // Chip position — draggable, kept on screen, starting near the bottom
  // right where neither the sheet handle nor the map controls live.
  const [pos, setPos] = useState(() => ({
    x: Math.max(8, window.innerWidth - CHIP - 12),
    y: Math.max(8, window.innerHeight * 0.42),
  }));
  const drag = useRef<{ id: number; dx: number; dy: number; moved: boolean } | null>(null);

  // Panel position — null means the default bottom-right anchor; dragging its
  // header (only surface without buttons' own meaning) detaches it to x/y.
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelDrag = useRef<{ id: number; dx: number; dy: number; w: number; h: number } | null>(
    null,
  );

  // The overlay reads the store lazily at collect time (not per render):
  // a ref keeps the latest app without re-collecting on every store change.
  const appRef = useRef(app);
  appRef.current = app;
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;
  const roundRef = useRef(roundCoords);
  roundRef.current = roundCoords;

  const collect = useCallback(async () => {
    setCollecting(true);
    const cur = appRef.current;
    const input: AppDebugInput = {
      screen: cur.screen,
      sourceId: cur.sourceId,
      locale: cur.locale,
      theme: cur.theme,
      arrangement: desktopRef.current ? 'desktop' : 'phone',
      stations: {
        status: cur.stations.status,
        activeSource: cur.stations.activeSource,
        rawCount: cur.stations.data.length,
        visibleCount: selectVisible(cur).length,
        fetchedAt: cur.stations.fetchedAt,
        refreshing: cur.stations.refreshing,
        lastError: cur.stations.lastError,
      },
      geoStatus: cur.geoStatus,
      hasKnownPos: cur.hasKnownPos,
      lastPos: cur.userPos,
      searchPos: cur.searchPos,
      searchedAway: cur.searchedAway,
      mapZoom: cur.mapZoom,
      radiusKm: cur.radius,
      fuel: cur.fuel,
    };
    try {
      setSnapshot(await collectDebugSnapshot(input, { roundCoords: roundRef.current }));
    } finally {
      setCollecting(false);
    }
  }, []);

  // Live while open: collect at once, then keep refreshing on a short tick
  // (skipping a tick whose predecessor is still collecting). Nothing runs
  // while the chip is collapsed.
  const collectingRef = useRef(false);
  collectingRef.current = collecting;
  useEffect(() => {
    if (!expanded) return;
    void collect();
    const timer = setInterval(() => {
      if (!collectingRef.current) void collect();
    }, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [expanded, roundCoords, collect]);

  const copy = async () => {
    if (!snapshot) return;
    const text = JSON.stringify(snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard API denied (http, permissions): legacy path
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
      } finally {
        ta.remove();
      }
    }
    setTimeout(() => setCopied(false), 1500);
  };

  // Dragging the open panel by its header. Buttons in the header keep their
  // taps; anywhere else on it grabs the panel.
  const onPanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panelDrag.current = {
      id: e.pointerId,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
  };
  const onPanelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = panelDrag.current;
    if (!d || d.id !== e.pointerId) return;
    setPanelPos({
      x: Math.min(Math.max(4, e.clientX - d.dx), window.innerWidth - d.w - 4),
      // The header must stay reachable — clamp on the header's own height
      y: Math.min(Math.max(4, e.clientY - d.dy), window.innerHeight - 44),
    });
  };
  const onPanelPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panelDrag.current?.id === e.pointerId) panelDrag.current = null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const x = e.clientX - d.dx;
    const y = e.clientY - d.dy;
    if (!d.moved && Math.hypot(x - pos.x, y - pos.y) < DRAG_SLOP_PX) return;
    d.moved = true;
    setPos({
      x: Math.min(Math.max(4, x), window.innerWidth - CHIP - 4),
      y: Math.min(Math.max(4, y), window.innerHeight - CHIP - 4),
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && d.id === e.pointerId && !d.moved) setExpanded(true);
  };

  const buttonStyle: React.CSSProperties = {
    font: `600 11px ${FONT.mono}`,
    color: C.body,
    background: C.surface2,
    border: `1px solid ${C.border12}`,
    borderRadius: 12,
    padding: '6px 10px',
    cursor: 'pointer',
  };

  const node = expanded ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Debug overlay"
      data-testid="debug-panel"
      data-sheet-no-drag=""
      style={{
        position: 'fixed',
        ...(panelPos
          ? { left: panelPos.x, top: panelPos.y }
          : {
              right: 'max(10px, env(safe-area-inset-right, 0px))',
              bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
            }),
        width: 'min(380px, calc(100vw - 20px))',
        maxHeight: 'min(72dvh, 680px)',
        zIndex: Z_OVERLAY,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 14,
        overflow: 'hidden',
        background: C.glassBgStrong,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: `1px solid ${C.glassBorder}`,
        boxShadow: `0 18px 50px ${C.shadow50}`,
        font: MONO_11,
        lineHeight: 1.5,
      }}
    >
      <div
        onPointerDown={onPanelPointerDown}
        onPointerMove={onPanelPointerMove}
        onPointerUp={onPanelPointerUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: `1px solid ${C.divider}`,
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <span
          style={{
            font: `700 12px ${FONT.mono}`,
            color: C.ink,
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Plein debug
          {/* Live indicator — the snapshot refreshes itself while open */}
          <span
            aria-label="live"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: C.accent,
              opacity: collecting ? 1 : 0.45,
            }}
          />
        </span>
        <button onClick={() => void copy()} disabled={!snapshot} style={buttonStyle}>
          {copied ? 'Copied ✓' : 'Copy JSON'}
        </button>
        <button
          onClick={() => setExpanded(false)}
          aria-label="Collapse debug overlay"
          style={{ ...buttonStyle, padding: '6px 9px' }}
        >
          ✕
        </button>
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: `1px solid ${C.divider}`,
          color: C.mut,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={roundCoords}
          onChange={(e) => setRoundCoords(e.target.checked)}
        />
        Round coordinates (~1 km) — keeps screenshots from leaking home
      </label>
      <div style={{ overflow: 'auto', padding: '2px 12px 12px', minHeight: 0 }}>
        {snapshot == null ? (
          <div style={{ color: C.faint, padding: '12px 0' }}>Collecting…</div>
        ) : (
          Object.entries(snapshot).map(([section, value]) =>
            value !== null && typeof value === 'object' ? (
              <div key={section}>
                <div style={sectionTitleStyle()}>{section}</div>
                <Rows obj={value as Record<string, unknown>} />
              </div>
            ) : (
              <div key={section} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ color: C.mut }}>{section}</span>
                <span style={{ color: C.body }}>{String(value)}</span>
              </div>
            ),
          )
        )}
      </div>
    </div>
  ) : (
    <button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label="Open debug overlay"
      data-testid="debug-chip"
      data-sheet-no-drag=""
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: CHIP,
        height: CHIP,
        zIndex: Z_OVERLAY,
        borderRadius: '50%',
        background: C.surface2,
        border: `1px solid ${C.accentBorder40}`,
        boxShadow: `0 6px 18px ${C.shadow45}`,
        color: C.accent,
        font: `800 12px ${FONT.mono}`,
        cursor: 'grab',
        touchAction: 'none',
      }}
    >
      DBG
      {errorCount > 0 && (
        <span
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            background: C.warn,
            color: C.onAccent,
            font: `700 10px ${FONT.mono}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            boxSizing: 'border-box',
          }}
        >
          {errorCount}
        </span>
      )}
    </button>
  );

  return createPortal(node, document.body);
}
