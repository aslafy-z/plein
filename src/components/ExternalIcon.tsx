/** « Opens elsewhere » picto — an arrow leaving its box, on the same 16-unit
    grid and stroke as ShareIcon, EditIcon and CrossIcon */
export default function ExternalIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      {/* Color via style: a var() token resolves in CSS, not in an attribute */}
      <g
        fill="none"
        style={{ stroke: color }}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9.5 3 H13 V6.5" />
        <path d="M13 3 L7.5 8.5" />
        <path d="M11.5 9.5 V12.5 Q11.5 13 11 13 H3.5 Q3 13 3 12.5 V5 Q3 4.5 3.5 4.5 H6.5" />
      </g>
    </svg>
  );
}
