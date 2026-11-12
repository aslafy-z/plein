/** Edit picto — a pencil, drawn on the same 16-unit grid and stroke as
    ShareIcon so the two sit side by side as one family */
export default function EditIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      {/* Color via style: a var() token resolves in CSS, not in an attribute */}
      <g
        fill="none"
        style={{ stroke: color }}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.9 2.3 L13.7 5.1 L5.4 13.4 L2.2 13.8 L2.6 10.6 Z" />
        <path d="M9.2 4 L12 6.8" />
      </g>
    </svg>
  );
}
