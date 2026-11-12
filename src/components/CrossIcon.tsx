/** Close / deselect picto — a cross on the same 16-unit grid and stroke as
    ShareIcon and EditIcon, so the ActionPill icons read as one family
    (a « ✕ » glyph is drawn by whatever font the platform falls back to) */
export default function CrossIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      {/* Color via style: a var() token resolves in CSS, not in an attribute */}
      <g fill="none" style={{ stroke: color }} strokeWidth={1.8} strokeLinecap="round">
        <path d="M3.5 3.5 L12.5 12.5" />
        <path d="M12.5 3.5 L3.5 12.5" />
      </g>
    </svg>
  );
}
