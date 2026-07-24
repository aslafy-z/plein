/** Share picto — a node sending a link out (arrow rising from a box) */
export default function ShareIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <g fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 1.8 V10" />
        <path d="M5.2 4.6 L8 1.8 L10.8 4.6" />
        <path d="M3.4 8.4 H2.6 V14.2 H13.4 V8.4 H12.6" />
      </g>
    </svg>
  );
}
