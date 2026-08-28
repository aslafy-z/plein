// The phone's scrimmed MODAL sheet — the frame FiltersSheet slides up over
// the map. It shares SheetShell's physics vocabulary (slop, fling window,
// release curve) but runs its own engine, because the model differs: this
// sheet has no collapsed state to snap to. It rests fully open and every
// gesture is a dismissal — the handle drags unconditionally, the body closes
// by pulling down from its scroll top (native scroll otherwise), and the
// release either slides the sheet off the bottom edge (fling down, or more
// than half its height travelled) and unmounts it, or springs it back.
//
// Same rendering discipline as SheetShell: during a drag the transform (and
// the scrim's matching fade) is written straight to the DOM inside a rAF —
// no React state per pointermove. React is only involved again at the very
// end, when `onClose` unmounts the whole overlay. Anything marked
// `data-sheet-no-drag` (a horizontal slider…) keeps its own gesture.
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { C } from '../theme';
import {
  DRAG_SLOP_PX,
  FLING_VPS,
  FLING_WINDOW_MS,
  FLING_HOLD_MS,
  GLIDE_CATCH_PX,
  SHEET_TRANSITION,
  insideNoDrag,
} from './SheetShell';

const SCRIM_TRANSITION = 'opacity .38s var(--ease-out)';
/** Unmount fallback if the dismissal slide's transitionend never fires */
const CLOSE_FALLBACK_MS = 450;

export default function ModalSheet({
  onClose,
  label,
  handleAria,
  scrimAria,
  children,
}: {
  /** Unmounts the overlay — being open is the caller's state */
  onClose: () => void;
  /** What the sheet announces as a dialog */
  label: string;
  /** The handle: a tap closes, and the bar names that */
  handleAria: string;
  scrimAria: string;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const g = useRef({
    active: false,
    moved: false,
    closing: false,
    startY: 0,
    startTy: 0,
    h: 0,
    samples: [] as { y: number; t: number }[],
    raf: 0,
    pendingTy: 0,
  });

  /** Current downward travel, transform included — a grab mid-spring-back
      starts from where the sheet is, not from its rest. The untranslated
      bottom edge is the overlay's. */
  const currentTy = useCallback(() => {
    const el = sheetRef.current;
    const overlay = el?.parentElement;
    if (!el || !overlay) return 0;
    return Math.max(
      0,
      el.getBoundingClientRect().bottom - overlay.getBoundingClientRect().bottom,
    );
  }, []);

  /** The one writer of the transform + scrim-fade pair a travel means */
  const applyTy = useCallback((ty: number) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transform = `translateY(${ty}px)`;
    const h = g.current.h || el.offsetHeight;
    if (scrimRef.current) scrimRef.current.style.opacity = String(1 - ty / h);
  }, []);

  const dragEnd = useCallback(
    (cancelled = false, t = performance.now()) => {
      const el = sheetRef.current;
      const s = g.current;
      if (!el || !s.active) return;
      s.active = false;
      if (s.raf) {
        cancelAnimationFrame(s.raf);
        s.raf = 0;
      }
      el.style.transition = SHEET_TRANSITION;
      if (scrimRef.current) scrimRef.current.style.transition = SCRIM_TRANSITION;
      // A motionless press is a tap — closing belongs to the handle's click.
      // But a press that CAUGHT a springing sheet did freeze it (dragBegin),
      // so an off-rest sheet resumes its way home instead of hanging mid-air.
      if (!s.moved) {
        if (currentTy() > 1) applyTy(0);
        return;
      }
      // Fling velocity: displacement over the trailing samples — the same
      // widened-window measure as SheetShell (see the comment there).
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
      const stay =
        !cancelled && Math.abs(v) > FLING_VPS ? v > 0 : s.pendingTy < s.h / 2;
      if (stay) {
        applyTy(0);
      } else {
        // Dismiss: slide the rest of the way off, THEN unmount — closing at
        // release would jump-cut a sheet still half on screen.
        s.closing = true;
        applyTy(s.h);
        let tid = 0;
        const finish = () => {
          clearTimeout(tid);
          el.removeEventListener('transitionend', onTransEnd);
          closeCleanup.current = null;
          onCloseRef.current();
        };
        const onTransEnd = (e: TransitionEvent) => {
          if (e.target === el && e.propertyName === 'transform') finish();
        };
        el.addEventListener('transitionend', onTransEnd);
        tid = window.setTimeout(finish, CLOSE_FALLBACK_MS);
        closeCleanup.current = () => {
          clearTimeout(tid);
          el.removeEventListener('transitionend', onTransEnd);
        };
      }
      // keep `moved` up until the trailing click has been swallowed
      setTimeout(() => {
        g.current.moved = false;
      }, 0);
    },
    [applyTy, currentTy],
  );

  // Something else may unmount the sheet mid-slide (Escape, the scrim): the
  // pending unmount callback must not fire onClose at a component that is gone
  const closeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => closeCleanup.current?.(), []);

  const dragMove = useCallback(
    (y: number, t: number) => {
      const el = sheetRef.current;
      const s = g.current;
      if (!el || !s.active) return;
      if (!s.moved && Math.abs(y - s.startY) < DRAG_SLOP_PX) return;
      s.moved = true;
      // The same native event may be delivered twice (window + element)
      const prev = s.samples[s.samples.length - 1];
      if (prev && prev.t === t && prev.y === y) return;
      s.samples.push({ y, t });
      while (s.samples.length > 1 && t - s.samples[0].t > FLING_WINDOW_MS + FLING_HOLD_MS) {
        s.samples.shift();
      }
      s.pendingTy = Math.min(s.h, Math.max(0, s.startTy + (y - s.startY)));
      if (!s.raf) {
        s.raf = requestAnimationFrame(() => {
          s.raf = 0;
          if (s.active) applyTy(s.pendingTy);
        });
      }
    },
    [applyTy],
  );

  const dragBegin = useCallback(
    (y: number, t: number, pointerType = 'touch') => {
      const el = sheetRef.current;
      if (!el || g.current.closing || g.current.active) return;
      // The entry keyframes (.anim-sheet) would override the dragged
      // transform — a drag starting during them takes over
      el.style.animation = 'none';
      const startTy = currentTy();
      g.current = {
        ...g.current,
        active: true,
        moved: false,
        startY: y,
        startTy,
        h: el.offsetHeight,
        samples: [{ y, t }],
        raf: 0,
        pendingTy: startTy,
      };
      el.style.transition = 'none';
      if (scrimRef.current) scrimRef.current.style.transition = 'none';
      // A grab CATCHES the sheet mid-spring-back, not its rest transform
      applyTy(startTy);
      // Same tracking split as SheetShell: a mouse is fed from the window
      // (the pressed node may never see a move), a touch from the raw
      // touchmove stream (Firefox Android starves pointermove mid-drag).
      const track =
        pointerType !== 'touch'
          ? (e: PointerEvent) => dragMove(e.clientY, e.timeStamp)
          : null;
      if (track) window.addEventListener('pointermove', track);
      const touchTrack =
        pointerType === 'touch'
          ? (e: TouchEvent) => {
              if (!g.current.active) return;
              e.preventDefault();
              dragMove(e.touches[0].clientY, e.timeStamp);
            }
          : null;
      if (touchTrack) window.addEventListener('touchmove', touchTrack, { passive: false });
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
    [applyTy, currentTy, dragMove, dragEnd],
  );

  /** Off its rest → mid-spring-back, and a press anywhere recatches it */
  const midFlight = useCallback(
    () => !g.current.closing && currentTy() > GLIDE_CATCH_PX,
    [currentTy],
  );

  // ── Handle zone: unconditional drag, a tap closes ──
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (insideNoDrag(e.target)) return;
    dragBegin(e.clientY, e.timeStamp, e.pointerType);
  };
  // A drag must not leak a click into the handle (or a body button) on release
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
    listArm.current = { y: e.clientY, t: e.timeStamp, top: scrollerRef.current?.scrollTop ?? 0 };
  };
  const listPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (g.current.active) return; // the window feeds the gesture
    const arm = listArm.current;
    if (!arm) return;
    const dy = e.clientY - arm.y;
    if (dy > DRAG_SLOP_PX && arm.top <= 0) {
      dragBegin(arm.y, arm.t, e.pointerType);
      dragMove(e.clientY, e.timeStamp);
      // capture: the drag must not start selecting the body's text
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (Math.abs(dy) > DRAG_SLOP_PX) {
      listArm.current = null; // upward or scrolled: a plain body scroll
    }
  };
  const listPointerUp = () => {
    listArm.current = null;
  };

  // ── Body zone (touch): native scroll physics, but a downward pull while
  // already at the top takes the sheet with it. touchmove must be
  // non-passive to preventDefault, hence the listeners.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
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
      if (g.current.active) return; // the window feeds the gesture
      if (!armed) return;
      const dy = e.touches[0].clientY - armY;
      if (dy > DRAG_SLOP_PX && armTop <= 0 && el.scrollTop <= 0) {
        dragBegin(armY, armT);
        dragMove(e.touches[0].clientY, e.timeStamp);
        e.preventDefault();
      } else if (Math.abs(dy) > DRAG_SLOP_PX) {
        armed = false;
      }
    };
    const end = () => {
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
  }, [dragBegin, dragMove, midFlight]);

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 1100 }}>
      <button
        ref={scrimRef}
        onClick={onClose}
        aria-label={scrimAria}
        style={{
          position: 'absolute',
          inset: 0,
          background: C.scrim,
          width: '100%',
          transition: SCRIM_TRANSITION,
        }}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={label}
        className="anim-sheet"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          background: C.navBg,
          borderRadius: '26px 26px 0 0',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '88%',
          overflow: 'hidden',
          willChange: 'transform',
          transition: SHEET_TRANSITION,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            touchAction: 'none',
            userSelect: 'none',
            cursor: 'grab',
          }}
          onPointerDown={handlePointerDown}
          onClickCapture={swallowClickAfterDrag}
        >
          <button
            onClick={onClose}
            aria-label={handleAria}
            style={{ display: 'block', width: '100%', padding: '12px 0 10px' }}
          >
            <span
              style={{
                display: 'block',
                width: 36,
                height: 4,
                borderRadius: 2,
                background: C.border20,
                margin: '0 auto',
              }}
            />
          </button>
        </div>
        <div
          ref={scrollerRef}
          style={{
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            padding: '2px 20px 18px',
          }}
          onPointerDown={listPointerDown}
          onPointerMove={listPointerMove}
          onPointerUp={listPointerUp}
          onPointerCancel={listPointerUp}
          onClickCapture={swallowClickAfterDrag}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
