import { useApp } from '../state/store';
import { useIsDesktop } from '../lib/layout';
import { C } from '../theme';

export default function Toast() {
  const { toast } = useApp();
  const desktop = useIsDesktop();
  // The live region stays mounted, and empty, between toasts: a screen reader
  // announces text CHANGING inside a region it already knows, and several
  // stay silent on a region inserted together with its text. Empty it has no
  // height, and it lets every pointer through either way.
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        // Clear of the tab bar on a phone; there is none on desktop, so the
        // toast sits on the bottom edge where a desktop notice belongs
        bottom: desktop ? 28 : 96,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        // Above every overlay: the fiche (1200) and the filters sheet (1100)
        // are full-screen, and a toast fired from either was drawn behind them.
        zIndex: 2000,
      }}
    >
      {toast && <ToastPill text={toast} />}
    </div>
  );
}

function ToastPill({ text }: { text: string }) {
  return (
    <div
      className="anim-toast"
      style={{
        pointerEvents: 'auto',
        background: C.ink,
        color: C.bg,
        fontSize: 13,
        fontWeight: 700,
        padding: '11px 18px',
        borderRadius: 22,
        boxShadow: `0 10px 28px ${C.shadow50}, 0 2px 8px ${C.shadow35}`,
        whiteSpace: 'nowrap',
        maxWidth: '90%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {text}
    </div>
  );
}
