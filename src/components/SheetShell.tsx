// The bottom-sheet SHELL — the phone's gesture engine, extracted so the map's
// zone sheet and the route's form/timeline sheet share one drag, one pair of
// snap points, one collapsed-height report. Content is the caller's: a
// collapsed `header` (always visible, draggable), an expanded `body` (a
// scrollable region revealed by pulling up) and an optional `footer` pinned
// to the sheet's bottom edge (the route's CTA), which counts into the
// collapsed height so it is always reachable.
//
// Gestures: the whole header drags, and the body closes by dragging down from
// its scroll top (native scroll otherwise). During a drag the height is
// written straight to the DOM (no React re-render per frame) and the release
// snaps in the fling direction when the gesture is fast. Anything marked
// `data-sheet-no-drag` (a horizontal slider…) keeps its own gesture.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { C } from '../theme';

/** Share of the map stage the expanded sheet covers by default */
const EXPAND_RATIO = 0.75;
/** Whatever the ratio, this strip of map always stays visible on top */
const MIN_MAP_PEEK_PX = 64;
/** Pointer must travel this far before a tap becomes a drag */
const DRAG_SLOP_PX = 6;
/** Release speed (px/ms) above which the sheet snaps in the fling direction */
const FLING_VPS = 0.45;
/** Fling speed is averaged over the samples of this trailing window */
const FLING_WINDOW_MS = 100;
/** Pointer parked longer than this before release → the fling is cancelled */
const FLING_HOLD_MS = 150;
const TRANSITION = 'height .3s cubic-bezier(.4,0,.2,1)';

/** Pointer/touch handlers the body's scroll container must carry so a pull
    from its top drags the sheet closed */
export interface SheetBodyGestures {
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerMove(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerUp(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerCancel(e: React.PointerEvent<HTMLDivElement>): void;
  onClickCapture(e: React.MouseEvent): void;
}

/** A control opting out of the sheet drag (horizontal sliders fight it) */
function insideNoDrag(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-sheet-no-drag]') != null;
}

export default function SheetShell({
  stageH,
  onCollapsedHeight,
  expanded,
  onExpandedChange,
  hasBody,
  header,
  body,
  footer,
  expandAria,
  collapseAria,
  hint = false,
  onHintConsumed,
  expandRatio = EXPAND_RATIO,
}: {
  /** Height of the map stage the sheet lives in (drives the expanded size) */
  stageH: number;
  /** Reports the collapsed height so the map keeps that strip free */
  onCollapsedHeight: (h: number) => void;
  /** Open state lives with the screen (the map overlay needs it too) */
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  /** false → nothing to expand to (empty zone): the drag disarms */
  hasBody: boolean;
  /** Collapsed part — always visible, carries the drag. The shell hands the
      render prop its drag handle (ref + tap/a11y wiring belong to the
      gesture engine) and the caller decides where it sits. */
  header: (handle: ReactNode) => ReactNode;
  /** Expanded part — the render prop owns the scroll container and must
      attach the ref and gestures to it */
  body?: (scrollerRef: RefObject<HTMLDivElement>, gestures: SheetBodyGestures) => ReactNode;
  /** Pinned to the sheet's bottom edge, inside the collapsed height */
  footer?: ReactNode;
  /** What the drag handle announces — names the caller's content, since the
      shell has no idea whether it hides a list or a form */
  expandAria: string;
  collapseAria: string;
  /** Arm the one-time « you can pull me up » bounce */
  hint?: boolean;
  onHintConsumed?: () => void;
  /** Share of the stage the expanded sheet may cover (a 64px strip of map
      always stays). The zone sheet keeps the default; the route sheet opens
      full — its timeline is longer than a screen. */
  expandRatio?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [collapsedH, setCollapsedH] = useState<number | null>(null);

  // Measure the always-visible parts (header + footer); the map keeps that
  // strip free below the sheet
  useLayoutEffect(() => {
    const headerEl = headerRef.current;
    if (!headerEl) return;
    const measure = () => {
      const h = headerEl.offsetHeight + (footerRef.current?.offsetHeight ?? 0);
      setCollapsedH(h);
      onCollapsedHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(headerEl);
    if (footerRef.current) ro.observe(footerRef.current);
    return () => ro.disconnect();
  }, [onCollapsedHeight, footer != null]);

  // Nothing to expand to → close
  useEffect(() => {
    if (!hasBody && expanded) onExpandedChange(false);
  }, [hasBody, expanded, onExpandedChange]);

  const expandedH = Math.max(
    collapsedH ?? 0,
    Math.min(Math.round(stageH * expandRatio), stageH - MIN_MAP_PEEK_PX),
  );

  // ── First-run pull-up hint ────────────────────────────────────────────────
  // Nothing says the header sits on top of more. So the very first time the
  // caller arms it, the collapsed sheet bounces up and settles: the gesture
  // is shown rather than explained. Once only — the caller spends the flag
  // as soon as it plays.
  const [hinting, setHinting] = useState(false);
  const hintPlayed = useRef(false);
  const armHint = hint && !expanded && hasBody && collapsedH != null;
  useEffect(() => {
    if (!armHint || hintPlayed.current) return;
    hintPlayed.current = true;
    setHinting(true);
    onHintConsumed?.();
  }, [armHint, onHintConsumed]);
  // A keyboard/AT toggle takes the pointer path's shortcut: the bounce must
  // not keep overriding the height of a sheet that is opening for real
  useEffect(() => {
    if (expanded) setHinting(false);
  }, [expanded]);

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
    canDrag: hasBody && collapsedH != null && stageH > 0,
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
      // The hint animation overrides the inline height — a drag starting mid
      // bounce would look stuck, so the hand always wins over the demo
      setHinting(false);
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

  // ── Header zone: drag from anywhere on the collapsed part ──
  const handleRef = useRef<HTMLDivElement>(null);
  const cardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (insideNoDrag(e.target)) return;
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
  // A drag must not leak a click into the header's buttons on release
  const swallowClickAfterDrag = (e: React.MouseEvent) => {
    if (g.current.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ── Body zone (mouse): drag down from the top of the scroller closes ──
  const listArm = useRef<{ y: number; t: number; top: number } | null>(null);
  const listPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return; // touch has its own path below
    if (insideNoDrag(e.target)) return;
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

  // ── Body zone (touch): native scroll physics, but a downward pull while
  // already at the top takes the sheet with it (Google-Maps behaviour).
  // touchmove must be non-passive to preventDefault, hence the listener.
  const listAttached = hasBody && collapsedH != null;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !listAttached) return;
    let armY = 0;
    let armT = 0;
    let armTop = 0;
    let armed = false;
    const start = (e: TouchEvent) => {
      if (insideNoDrag(e.target)) return;
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

  const height = expanded && hasBody ? expandedH : (collapsedH ?? undefined);

  // Content-driven height changes apply INSTANTLY. While the route pipeline
  // loads, the collapsed header changes several times in a row (the CTA
  // footer leaves at submit, the lead swaps branches as each stage commits);
  // gliding each one for 300 ms turns the flap into a moving target exactly
  // when the user reaches for it — the grab lands on the map behind and
  // reads as « the sheet is stuck ». Only the expand/collapse toggle glides.
  const lastExpandedRef = useRef(expanded);
  useLayoutEffect(() => {
    const el = rootRef.current;
    const toggled = lastExpandedRef.current !== expanded;
    lastExpandedRef.current = expanded;
    if (!el || toggled || g.current.active) return;
    el.style.transition = 'none';
    const raf = requestAnimationFrame(() => {
      if (rootRef.current && !g.current.active) rootRef.current.style.transition = TRANSITION;
    });
    return () => cancelAnimationFrame(raf);
  }, [height, expanded]);

  const bodyGestures: SheetBodyGestures = {
    onPointerDown: listPointerDown,
    onPointerMove: listPointerMove,
    onPointerUp: listPointerUp,
    onPointerCancel: listPointerUp,
    onClickCapture: swallowClickAfterDrag,
  };

  // The drag handle — the visible affordance + a11y toggle. Pointer taps
  // toggle in cardPointerUp; onClick only serves keyboard/AT synthetic
  // clicks (no pointerup precedes them).
  const handle = (
    <div
      ref={handleRef}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? collapseAria : expandAria}
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
  );

  return (
    <div
      ref={rootRef}
      className={hinting ? 'sheet-hint' : undefined}
      // Bubbled ends belong to the swapping content, not to the bounce
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setHinting(false);
      }}
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
        // The hint keyframes bounce off this, the height they override
        ...(hinting ? { ['--sheet-h' as string]: `${height ?? 0}px` } : null),
        transition: TRANSITION,
      }}
    >
      {/* ── Collapsed part (measured — the map stops above it) ── */}
      <div
        ref={headerRef}
        style={{ flexShrink: 0, touchAction: 'none', cursor: hasBody ? 'grab' : undefined }}
        onPointerDown={cardPointerDown}
        onPointerMove={cardPointerMove}
        onPointerUp={cardPointerUp}
        onPointerCancel={cardPointerCancel}
        onClickCapture={swallowClickAfterDrag}
      >
        {header(handle)}
      </div>

      {/* ── Body revealed by pulling the sheet up ── */}
      {listAttached && body?.(listRef, bodyGestures)}

      {/* ── Footer pinned to the bottom edge, always visible ── */}
      {footer && <div ref={footerRef} style={{ flexShrink: 0, marginTop: 'auto' }}>{footer}</div>}
    </div>
  );
}
