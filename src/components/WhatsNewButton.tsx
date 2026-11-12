import { useApp } from '../state/store';
import { m } from '../paraglide/messages.js';
import { C, glassBlur } from '../theme';

/**
 * The map's quiet signal that the What's new log has something unread: a
 * small sparkle in the corner of the top controls that gives a short wiggle
 * every few seconds, and nothing more. It exists only while there is news.
 *
 * Deliberately NOT a bar or a dialog: the app is opened at the pump or behind
 * the wheel, and nothing may sit between the user and the price they came
 * for. Reading the news is opt-in — a tap here (or Settings › What's new)
 * opens the sheet, which marks the log seen and makes this go away.
 */
export default function WhatsNewButton({ size }: { size: number }) {
  const app = useApp();
  if (app.whatsNew.length === 0) return null;

  return (
    <button
      className="press"
      onClick={() => app.setWhatsNewOpen('unread')}
      aria-label={m.whatsnew_button_aria()}
      title={m.whatsnew_button_aria()}
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        background: C.glassBgSoft,
        ...glassBlur(12),
        border: `1px solid ${C.accentBorder}`,
        boxShadow: `inset 0 1px 0 ${C.glassEdge}, 0 6px 18px ${C.shadow45}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
      }}
    >
      {/* The wiggle rides the glyph, not the button: .press owns the
          button's transform for its compress-on-press */}
      <span className="whatsnew-wiggle" style={{ display: 'flex' }}>
        <svg viewBox="0 0 16 16" width={size * 0.46} height={size * 0.46} aria-hidden>
          {/* Color via style: a var() token resolves in CSS, not in an attribute */}
          <path
            d="M8 1 C8.5 5 11 7.5 15 8 C11 8.5 8.5 11 8 15 C7.5 11 5 8.5 1 8 C5 7.5 7.5 5 8 1 Z"
            style={{ fill: C.accent }}
          />
        </svg>
      </span>
      {/* The unread dot — the one part that survives reduced motion */}
      <span
        style={{
          position: 'absolute',
          top: size * 0.12,
          right: size * 0.12,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: C.accent,
          border: `1.5px solid ${C.surface}`,
        }}
      />
    </button>
  );
}
