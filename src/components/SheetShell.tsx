// The bottom-sheet SHELL — the phone's gesture engine, extracted so the map's
// zone sheet and the route's form/timeline sheet share one drag, one pair of
// snap points, one collapsed-height report. Content is the caller's: a
// collapsed `header` (always visible, draggable), an expanded `body` (a
// scrollable region revealed by pulling up) and an optional `footer` pinned
// to the sheet's bottom edge (the route's CTA), which counts into the
// collapsed height so it is always reachable.
//
// Gestures: the whole header drags, and the body closes by dragging down from
// its scroll top (native scroll otherwise). During a drag the transform is
// written straight to the DOM (no React re-render per frame) and the release
// snaps in the fling direction when the gesture is fast. Anything marked
// `data-sheet-no-drag` (a horizontal slider…) keeps its own gesture.
//
// The sheet is revealed by transform, never by height: whenever it has a
// body the element keeps the EXPANDED height, and collapsed is a translateY
// that parks the surplus below the stage (whose overflow clips it). Open,
// close, the release snap and the drag itself all move that one transform —
// compositor-only, where an animated `height` re-lays-out and repaints the
// whole sheet subtree on every frame. That per-frame cost is what made
// opening the sheet stutter on Firefox (Gecko repaints it far slower than
// Blink, which never showed it). The footer counter-translates so it stays
// glued to the stage's bottom edge, and is opaque because the body is laid
// out underneath it in this model.
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
/** Further than this from the rest height → the sheet is mid-glide, and a
    press anywhere on it catches it (subpixel transforms stay a rest) */
const GLIDE_CATCH_PX = 4;
// The release snap rides the app's primary curve (styles.css --ease-out):
// where the browser supports linear() springs the sheet lands with a
// hair of overshoot and settle — an object with weight, not a cursor.
const TRANSITION = 'transform .38s var(--ease-out)';

/** Pointer handlers a body region carries so it can drag the sheet. Two
    contracts share this shape: the body's SCROLL CONTAINER gets the
    scroll-arbitrating set (native scroll, except a pull down from scroll-top
    closes the sheet), and any STATIC BAR outside the scroller (the zone
    list's count/sort row) gets the header's unconditional set — it must set
    `touchAction: 'none'` or the browser claims the touch gesture first. */
export interface SheetGestures {
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
  instantContentResize = false,
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
      attach the ref and gestures to it. `staticBarGestures` goes on any
      non-scrolling bar the body keeps outside the scroller, so it drags
      too. */
  body?: (
    scrollerRef: RefObject<HTMLDivElement>,
    gestures: SheetGestures,
    staticBarGestures: SheetGestures,
  ) => ReactNode;
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
  /** Content-driven collapsed-height changes apply without the glide. The route sheet
      needs it: its collapsed header changes several times in a row while the
      pipeline loads, and gliding each change turns the flap into a moving
      target right when the user reaches for it. The zone sheet keeps the
      glide — its card resizes rarely, and an instant snap under a landing
      finger costs more than the glide there. */
  instantContentResize?: boolean;
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

  // The translate model (see the header comment): measured and with a body,
  // the element is always `expandedH` tall and `restTy` parks the surplus
  // below the stage when collapsed. Both the root's transform and the
  // footer's counter-translation derive from it.
  const layoutH = hasBody && collapsedH != null ? expandedH : (collapsedH ?? undefined);
  const restTy = hasBody && collapsedH != null && !expanded ? expandedH - collapsedH : 0;

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
  // During a drag the transform pair is written straight onto the DOM nodes
  // inside a rAF (no React state per pointermove — a re-rendering list makes
  // the drag stutter, which reads as "resistance"). React state only commits
  // on release. `dims` mirrors the current render so the stable callbacks and
  // the native touch listeners never see stale values; min/max are VISIBLE
  // heights, which the transforms are derived from.
  const dims = useRef({ min: 0, max: 0, expanded: false, canDrag: false });
  dims.current = {
    min: collapsedH ?? 0,
    max: expandedH,
    expanded,
    canDrag: hasBody && collapsedH != null && stageH > 0,
  };
  const openRef = useRef(onExpandedChange);
  openRef.current = onExpandedChange;

  /** Current VISIBLE height, transform included — a grab mid-glide starts
      from where the sheet is, not where it was headed. The untranslated
      bottom edge is the stage's (the root is `bottom: 0` in it). */
  const visibleNow = useCallback((el: HTMLDivElement) => {
    const stage = el.parentElement;
    const rect = el.getBoundingClientRect();
    return stage ? stage.getBoundingClientRect().bottom - rect.top : rect.height;
  }, []);

  /** The one writer of the transform pair a visible height means */
  const applyVisible = useCallback((el: HTMLDivElement, visible: number) => {
    const ty = dims.current.max - visible;
    el.style.transform = `translateY(${ty}px)`;
    if (footerRef.current) footerRef.current.style.transform = `translateY(${-ty}px)`;
  }, []);

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
    if (footerRef.current) footerRef.current.style.transition = TRANSITION;
    // A motionless press is a tap, not a gesture: the transform was never
    // dragged and the open/close decision belongs to the tap handlers —
    // voting from the current height here would race the handle's toggle.
    // But a press that CAUGHT a gliding sheet did freeze it (dragBegin), so
    // an off-rest sheet resumes its snap instead of hanging mid-air.
    if (!s.moved) {
      const d = dims.current;
      const rest = d.expanded ? d.max : d.min;
      if (Math.abs(visibleNow(el) - rest) > 1) applyVisible(el, rest);
      return;
    }
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
    const h = visibleNow(el);
    let open: boolean;
    if (!cancelled && Math.abs(v) > FLING_VPS) {
      open = v > 0; // fling: follow the gesture direction, whatever the travel
    } else {
      open = h > (d.min + d.max) / 2;
    }
    applyVisible(el, open ? d.max : d.min);
    openRef.current(open);
    // keep `moved` up until the trailing click has been swallowed
    setTimeout(() => {
      g.current.moved = false;
    }, 0);
  }, [visibleNow, applyVisible]);

  const dragMove = useCallback((y: number, t: number) => {
    const el = rootRef.current;
    const s = g.current;
    if (!el || !s.active) return;
    if (!s.moved && Math.abs(y - s.startY) < DRAG_SLOP_PX) return;
    s.moved = true;
    // A mouse drag is tracked on the window AND on whatever element the
    // pointer still covers — the same native event must not count twice
    const prev = s.samples[s.samples.length - 1];
    if (prev && prev.t === t && prev.y === y) return;
    s.samples.push({ y, t });
    while (s.samples.length > 1 && t - s.samples[0].t > FLING_WINDOW_MS + FLING_HOLD_MS) {
      s.samples.shift();
    }
    const d = dims.current;
    s.pendingH = Math.min(d.max, Math.max(d.min, s.startH + (s.startY - y)));
    if (!s.raf) {
      s.raf = requestAnimationFrame(() => {
        s.raf = 0;
        if (s.active && rootRef.current) applyVisible(rootRef.current, s.pendingH);
      });
    }
  }, [applyVisible]);

  const dragBegin = useCallback(
    (y: number, t: number, pointerType = 'touch') => {
      const el = rootRef.current;
      if (!el || !dims.current.canDrag || g.current.active) return;
      // The hint animation overrides the inline transform — a drag starting
      // mid bounce would look stuck, so the hand always wins over the demo
      setHinting(false);
      const startH = visibleNow(el);
      g.current = {
        ...g.current,
        active: true,
        moved: false,
        startY: y,
        startH,
        samples: [{ y, t }],
        pendingH: 0,
      };
      el.style.transition = 'none';
      if (footerRef.current) footerRef.current.style.transition = 'none';
      // A grab CATCHES the sheet: with the transition killed, the element
      // would otherwise snap to its inline rest transform — the hand must
      // hold the sheet where it grabbed it, mid-glide included.
      applyVisible(el, startH);
      // Only touch pointers get implicit capture. A mouse pressed on the
      // handle leaves the sheet on its very first upward move (the handle
      // sits at the top edge), the element under it never sees a pointermove,
      // and the element handlers only request capture once the slop trips —
      // so until release the gesture has to be fed from the window.
      const track =
        pointerType !== 'touch'
          ? (e: PointerEvent) => dragMove(e.clientY, e.timeStamp)
          : null;
      if (track) window.addEventListener('pointermove', track);
      // A touch drag is fed from the RAW touchmove stream instead: Firefox
      // Android starves pointermove down to ~5-8 events/s during a claimed
      // drag while touchmove keeps flowing at input rate — a sheet tracking
      // pointermove there staircases however fast the compositor is.
      // Pointer events keep down/up (and the whole mouse path). Duplicate
      // deliveries of the same native event are dropped by dragMove's
      // (t, y) dedup, so the element-level touch listeners can coexist.
      const touchTrack =
        pointerType === 'touch'
          ? (e: TouchEvent) => {
              if (!g.current.active) return;
              e.preventDefault();
              dragMove(e.touches[0].clientY, e.timeStamp);
            }
          : null;
      if (touchTrack) window.addEventListener('touchmove', touchTrack, { passive: false });
      // The pointer may be released outside the sheet before any capture
      const done = (e: PointerEvent) => {
        if (track) window.removeEventListener('pointermove', track);
        if (touchTrack) window.removeEventListener('touchmove', touchTrack);
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', done);
        dragEnd(e.type === 'pointercancel', e.timeStamp);
      };
      window.addEventListener('pointerup', done);
      window.addEventListener('pointercancel', done);
    },
    [dragEnd, dragMove, visibleNow, applyVisible],
  );

  /** A sheet away from its rest height is mid-glide, and a press anywhere on
      it then catches it — notably on the BODY, whose handlers otherwise
      belong to the list's scroll and ignore an upward pull. Without this,
      reopening a closing sheet from the bottom of the screen lands on the
      body and does nothing while the close finishes under the finger. */
  const midFlight = useCallback(() => {
    const el = rootRef.current;
    if (!el || !dims.current.canDrag) return false;
    const rest = dims.current.expanded ? dims.current.max : dims.current.min;
    return Math.abs(visibleNow(el) - rest) > GLIDE_CATCH_PX;
  }, [visibleNow]);

  // If React re-renders mid-drag (background refresh…), re-assert the
  // gesture transforms it would otherwise overwrite.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el && g.current.active && g.current.pendingH) {
      el.style.transition = 'none';
      if (footerRef.current) footerRef.current.style.transition = 'none';
      applyVisible(el, g.current.pendingH);
    }
  });

  // ── Header zone: drag from anywhere on the collapsed part ──
  const handleRef = useRef<HTMLDivElement>(null);
  const cardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (insideNoDrag(e.target)) return;
    g.current.fromHandle = !!handleRef.current?.contains(e.target as Node);
    g.current.toggled = false;
    dragBegin(e.clientY, e.timeStamp, e.pointerType);
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
    if (midFlight()) {
      dragBegin(e.clientY, e.timeStamp, e.pointerType);
      return;
    }
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
      dragBegin(arm.y, arm.t, e.pointerType);
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
      if (midFlight()) {
        dragBegin(e.touches[0].clientY, e.timeStamp);
        return;
      }
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
  }, [listAttached, dragBegin, dragMove, dragEnd, midFlight]);

  // `instantContentResize`: a content-driven rest change lands without the
  // glide (see the prop's doc) — only the expand/collapse toggle animates.
  // Any LAYOUT-height change is instant for BOTH sheets: height never
  // transitions in the translate model, so when it jumps (stage resize, the
  // body appearing when data lands) the transform must jump with it — a
  // transform gliding to catch up with an already-snapped height shows the
  // sheet fully expanded and sliding down over the map. The designed glide
  // (a collapsed card resizing under a constant layout height) is untouched.
  const lastRef = useRef({ expanded, layoutH });
  useLayoutEffect(() => {
    const el = rootRef.current;
    const toggled = lastRef.current.expanded !== expanded;
    const heightJumped = lastRef.current.layoutH !== layoutH;
    lastRef.current = { expanded, layoutH };
    if (!el || toggled || g.current.active) return;
    if (!instantContentResize && !heightJumped) return;
    // Kill the transition, FLUSH the new base state, restore — synchronously.
    // A rAF restore is too early: rAF callbacks run BEFORE the frame's style
    // recalc, so the browser would still see this commit's transform change
    // under an active transition and glide it anyway (seen as the sheet
    // sliding down from fully expanded when the body appears at boot).
    el.style.transition = 'none';
    if (footerRef.current) footerRef.current.style.transition = 'none';
    void el.getBoundingClientRect();
    el.style.transition = TRANSITION;
    if (footerRef.current) footerRef.current.style.transition = TRANSITION;
  }, [restTy, expanded, layoutH, instantContentResize]);

  const bodyGestures: SheetGestures = {
    onPointerDown: listPointerDown,
    onPointerMove: listPointerMove,
    onPointerUp: listPointerUp,
    onPointerCancel: listPointerUp,
    onClickCapture: swallowClickAfterDrag,
  };

  // The header's own handlers, verbatim: a tap still lands on whatever button
  // the bar carries (only the handle toggles on pointerup), a real drag
  // captures the pointer and swallows the trailing click.
  const staticBarGestures: SheetGestures = {
    onPointerDown: cardPointerDown,
    onPointerMove: cardPointerMove,
    onPointerUp: cardPointerUp,
    onPointerCancel: cardPointerCancel,
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
          background: C.border18,
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
        boxShadow: `0 -10px 30px ${C.shadow45}`,
        height: layoutH,
        transform: `translateY(${restTy}px)`,
        willChange: 'transform',
        // The hint keyframes bounce off this, the transform they override
        ...(hinting ? { ['--sheet-ty' as string]: `${restTy}px` } : null),
        transition: TRANSITION,
      }}
    >
      {/* ── Collapsed part (measured — the map stops above it) ── */}
      <div
        ref={headerRef}
        style={{
          flexShrink: 0,
          touchAction: 'none',
          userSelect: 'none',
          cursor: hasBody ? 'grab' : undefined,
        }}
        onPointerDown={cardPointerDown}
        onPointerMove={cardPointerMove}
        onPointerUp={cardPointerUp}
        onPointerCancel={cardPointerCancel}
        onClickCapture={swallowClickAfterDrag}
      >
        {header(handle)}
      </div>

      {/* ── Body revealed by pulling the sheet up ── */}
      {listAttached && body?.(listRef, bodyGestures, staticBarGestures)}

      {/* ── Footer pinned to the bottom edge, always visible ── */}
      {/* It sits at the element's REAL bottom — below the stage when
          collapsed — so it counter-translates back onto the visible edge,
          and its background is opaque because the body is laid out under
          it in the translate model. */}
      {footer && (
        <div
          ref={footerRef}
          style={{
            flexShrink: 0,
            marginTop: 'auto',
            background: C.surface,
            transform: `translateY(${-restTy}px)`,
            willChange: 'transform',
            transition: TRANSITION,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
