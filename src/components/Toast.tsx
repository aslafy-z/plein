import { useApp } from '../state/store';
import { useIsDesktop } from '../lib/layout';
import { C } from '../theme';

export default function Toast() {
  const { toast } = useApp();
  const desktop = useIsDesktop();
  if (!toast) return null;
  return (
    <div
      role="status"
      className="anim-fade"
      style={{
        position: 'absolute',
        left: '50%',
        // Clear of the tab bar on a phone; there is none on desktop, so the
        // toast sits on the bottom edge where a desktop notice belongs
        bottom: desktop ? 28 : 96,
        transform: 'translateX(-50%)',
        // Above every overlay: the fiche (1200) and the filters sheet (1100)
        // are full-screen, and a toast fired from either was drawn behind them.
        zIndex: 2000,
        background: C.ink,
        color: C.bg,
        fontSize: 13,
        fontWeight: 700,
        padding: '11px 18px',
        borderRadius: 22,
        boxShadow: `0 10px 28px ${C.shadow50}`,
        whiteSpace: 'nowrap',
        maxWidth: '90%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {toast}
    </div>
  );
}
