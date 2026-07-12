import { useApp } from '../state/store';
import { C } from '../theme';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div
      role="status"
      className="anim-fade"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 96,
        transform: 'translateX(-50%)',
        zIndex: 50,
        background: C.ink,
        color: C.bg,
        fontSize: 13,
        fontWeight: 700,
        padding: '11px 18px',
        borderRadius: 22,
        boxShadow: '0 10px 28px rgba(0,0,0,.5)',
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
