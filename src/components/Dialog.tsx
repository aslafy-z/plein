import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Centered modal — the desktop shape of what is a bottom sheet (filters) or a
 * full-screen page (a station fiche) on a phone.
 *
 * A sheet is dismissed by dragging it away and a page by the system back
 * button; a window has neither, so a dialog owes the user the two gestures a
 * desktop browser does have: a click outside, and Escape. It also takes focus
 * on open, so the keyboard lands inside the thing that just appeared instead
 * of staying on the button that opened it.
 */
export default function Dialog({
  onClose,
  label,
  scrimLabel,
  maxWidth = 560,
  zIndex = 1200,
  children,
}: {
  onClose: () => void;
  /** Accessible name of the dialog itself */
  label: string;
  /** Accessible name of the click-outside-to-close backdrop */
  scrimLabel: string;
  maxWidth?: number;
  zIndex?: number;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Escape closes. Captured on the window: the click that opened the dialog
  // may have left focus behind on the map, which runs its own key loop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // preventScroll: a long fiche must open at its top, not scrolled to
  // wherever the browser decided the focus target was
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <button
        onClick={onClose}
        aria-label={scrimLabel}
        className="anim-fade"
        style={{ position: 'absolute', inset: 0, background: 'rgba(6,9,11,.62)', cursor: 'default' }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal
        aria-label={label}
        tabIndex={-1}
        className="anim-dialog"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth,
          maxHeight: '100%',
          background: '#101214',
          border: '1px solid rgba(255,255,255,.09)',
          borderRadius: 22,
          boxShadow: '0 30px 80px rgba(0,0,0,.6)',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
