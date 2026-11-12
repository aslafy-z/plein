// The app's secondary action: the small control that sits at the top-right of
// a card or sheet header (Share, Edit, Reset, close, favorite…), or at the end
// of a summary card. One drawing everywhere, so a button looks like a button
// wherever it lives — never a bare word or a bare glyph floating in a header.
//
// A tonal pill, drawn PILL_PX tall inside a TARGET_PX button: the transparent
// band around the pill is still the button, so a finger landing just off it
// still hits. Negative margins keep that slack out of the layout (the row is
// as tall as the pill), and the button is lifted above later siblings — a
// title under the header row would otherwise paint over the slack and take
// its taps.
//
// Two tones: `accent` acts on the content (share it, edit it, reset it, go
// set it), `neutral` handles the container or a toggle on it (close,
// deselect, favorite). Without a label the pill is round and icon-only, and
// `aria-label` is required.
import type { CSSProperties, ReactNode } from 'react';
import { C } from '../theme';

/** Drawn height of the pill (and diameter of the round one) */
export const PILL_PX = 34;
/** Height of the hit box around it — a finger-sized target */
export const TARGET_PX = 44;
const SLACK = (TARGET_PX - PILL_PX) / 2;

export type ActionPillTone = 'accent' | 'neutral';

/** Foreground of a tone — what an icon passed in should be drawn with */
export function actionPillInk(tone: ActionPillTone): string {
  return tone === 'accent' ? C.accent : C.ink;
}

type Props = {
  onClick: () => void;
  tone?: ActionPillTone;
  icon?: ReactNode;
  title?: string;
} & (
  | { label: string; 'aria-label'?: string }
  | { label?: undefined; 'aria-label': string }
);

export default function ActionPill({
  onClick,
  tone = 'accent',
  icon,
  label,
  title,
  'aria-label': ariaLabel,
}: Props) {
  const round = label == null;
  const ink = actionPillInk(tone);
  const pill: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: PILL_PX,
    ...(round ? { width: PILL_PX } : { padding: icon ? '0 13px 0 11px' : '0 13px' }),
    borderRadius: PILL_PX / 2,
    background: tone === 'accent' ? C.accentSoft : C.surface2,
    border: `1px solid ${tone === 'accent' ? C.accentBorder : C.border12}`,
    color: ink,
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  };
  return (
    <button
      className="press"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: TARGET_PX,
        // The round pill's slack reaches sideways too: its box is square
        ...(round ? { width: TARGET_PX } : null),
        margin: round ? -SLACK : `-${SLACK}px 0`,
        flexShrink: 0,
        position: 'relative',
        zIndex: 1,
        cursor: 'pointer',
      }}
    >
      <span style={pill}>
        {icon}
        {label}
      </span>
    </button>
  );
}

/** A run of ActionPills: one gap between the drawn pills, whatever their
    slack (the negative margins already hide it from the layout) */
export function ActionPills({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      {children}
    </div>
  );
}
