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
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
const CHIP = 40;
/** Refresh cadence while the panel is open */
const LIVE_REFRESH_MS = 2000;

/**
 * One column, ordered by how much a debugging eye needs each section: what
 * MOVES while reproducing a bug first — errors, then the data on screen and
 * where it came from — the session's standing facts (build, SW, storage)
 * last. Compact on purpose: a section is one dense line of pairs plus one
 * line per record, so the whole state fits a phone screen without tabs.
 */
const SECTION_ORDER: (keyof DebugSnapshot)[] = [
  'errors',
  'stationsOnScreen',
  'areaCache',
  'tiles',
  'position',
  'connectivity',
  'build',
  'sw',
  'app',
  'storage',
];

const MONO_11 = `500 11px ${FONT.mono}`;

/**
 * Panel-only noise filter: epoch-millisecond fields say nothing a human
 * reads (their `age` twin does), so the PANEL hides them — the copied JSON
 * keeps every field.
 */
const HIDDEN_KEYS = new Set(['fetchedAt', 'at', 'collectedAt']);

/** A lat/lng pair — the one nested shape worth its own compact form */
function isPoint(v: unknown): v is { lat: number; lng: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { lat?: unknown }).lat === 'number' &&
    typeof (v as { lng?: unknown }).lng === 'number'
  );
}

function fmtValue(v: unknown): string {
  if (v == null) return '—';
  if (isPoint(v)) return `${v.lat},${v.lng}`;
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.map(fmtValue).join(' | ');
  if (typeof v === 'object') return inlinePairs(v as Record<string, unknown>);
  return String(v);
}

/** `key:value · key:value` — the panel's whole grammar */
function inlinePairs(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([k]) => !HIDDEN_KEYS.has(k))
    .map(([k, v]) => `${k}:${fmtValue(v)}`)
    .join(' · ');
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const SECTION_TITLE: React.CSSProperties = {
  color: C.accent,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
};

/**
 * The area cache deserves better than the generic pair soup: one aligned
 * row per cached area — source, center, radius, stations, size, age+tier,
 * a `mem` marker when its payload sits in memory. The `key` and the epoch
 * timestamps stay in the copied JSON; here they only repeated the columns.
 */
function AreaCacheSection({ value }: { value: DebugSnapshot['areaCache'] }) {
  const tierColor = (tier: string) =>
    tier === 'fresh' ? C.faint : tier === 'revalidate' ? C.body : C.warn;
  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{ wordBreak: 'break-word' }}>
        <span style={SECTION_TITLE}>areaCache</span>{' '}
        <span style={{ color: C.body }}>
          {`hydrated:${value.hydrated} · pending:${value.pendingPuts}+${value.pendingDeletes}`}
          {value.lastLoad ? ` · lastLoad:${value.lastLoad.path} ${value.lastLoad.age} ago` : ''}
        </span>
      </div>
      {value.areas.length === 0 ? (
        <div style={{ color: C.faint, paddingLeft: 8 }}>no cached areas</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, max-content)',
            columnGap: 10,
            rowGap: 2,
            paddingLeft: 8,
            overflowX: 'auto',
          }}
        >
          {value.areas.map((a) => (
            <Fragment key={a.key}>
              <span style={{ color: C.mut }}>{a.source}</span>
              <span style={{ color: C.body }}>
                {a.center.lat},{a.center.lng}
              </span>
              <span style={{ color: C.faint }}>r{a.fetchRadiusKm}</span>
              <span style={{ color: C.ink, textAlign: 'right' }}>{a.stationCount} st</span>
              <span style={{ color: C.faint, textAlign: 'right' }}>{fmtBytes(a.bytes)}</span>
              <span style={{ color: tierColor(a.tier) }}>
                {a.age} {a.tier}
                {a.payloadInMemory ? ' · mem' : ''}
              </span>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One section: its scalars share the title's line, each record of an array
 * (a cached area, a SW cache, an error) gets one dense line, nested objects
 * one line of pairs. Compact and generic — the panel and the copied JSON
 * stay one thing.
 */
function CompactSection({ title, value }: { title: string; value: Record<string, unknown> }) {
  const scalars: string[] = [];
  const blocks: React.ReactNode[] = [];
  const recordLine: React.CSSProperties = {
    color: C.body,
    paddingLeft: 8,
    wordBreak: 'break-word',
  };
  for (const [key, v] of Object.entries(value)) {
    if (HIDDEN_KEYS.has(key)) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) scalars.push(`${key}:—`);
      else
        blocks.push(
          ...v.map((item, i) => (
            <div key={`${key}${i}`} style={recordLine}>
              {typeof item === 'object' && item !== null
                ? inlinePairs(item as Record<string, unknown>)
                : String(item)}
            </div>
          )),
        );
    } else if (v !== null && typeof v === 'object' && !isPoint(v)) {
      blocks.push(
        <div key={key} style={recordLine}>
          <span style={{ color: C.mut }}>{key}</span> {inlinePairs(v as Record<string, unknown>)}
        </div>,
      );
    } else {
      scalars.push(`${key}:${fmtValue(v)}`);
    }
  }
  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{ wordBreak: 'break-word' }}>
        <span style={SECTION_TITLE}>{title}</span>{' '}
        <span style={{ color: C.body }}>{scalars.join(' · ')}</span>
      </div>
      {blocks}
    </div>
  );
}

export default function DebugOverlay() {
  const app = useApp();
  const desktop = useIsDesktop();
  const errorCount = useConsoleErrorCount();

  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);
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
      setSnapshot(await collectDebugSnapshot(input));
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
  }, [expanded, collect]);

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
      <div style={{ overflow: 'auto', padding: '4px 12px 10px', minHeight: 0 }}>
        {snapshot == null ? (
          <div style={{ color: C.faint, padding: '12px 0' }}>Collecting…</div>
        ) : (
          SECTION_ORDER.map((section) => {
            if (section === 'areaCache') {
              return <AreaCacheSection key={section} value={snapshot.areaCache} />;
            }
            const value = snapshot[section];
            if (value === null || typeof value !== 'object') return null;
            return (
              <CompactSection
                key={section}
                title={section}
                value={value as unknown as Record<string, unknown>}
              />
            );
          })
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
      // The look of the map's floating controls (share, recenter): a small
      // glass pill, not a solid disc shouting over the basemap
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: CHIP,
        height: CHIP,
        zIndex: Z_OVERLAY,
        borderRadius: '50%',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: C.glassBgSoft,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${C.glassBorder}`,
        boxShadow: `0 6px 18px ${C.shadow45}`,
        color: C.accent,
        font: `700 10px ${FONT.mono}`,
        letterSpacing: '.06em',
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
