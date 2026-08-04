/** Locate picto — the map-app crosshair: a ring with its four ticks, the
    center dot filled only when the view actually sits on the user */
export default function LocateIcon({
  color,
  dot,
  size = 20,
}: {
  color: string;
  dot: boolean;
  size?: number;
}) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden>
      {/* Colors via style: a var() token resolves in CSS, not in an attribute */}
      <g fill="none" style={{ stroke: color }} strokeWidth={1.7} strokeLinecap="round">
        <circle cx="10" cy="10" r="5.1" />
        <path d="M10 1.6 V3.6" />
        <path d="M10 16.4 V18.4" />
        <path d="M1.6 10 H3.6" />
        <path d="M16.4 10 H18.4" />
      </g>
      {dot && <circle cx="10" cy="10" r="2.1" style={{ fill: color }} />}
    </svg>
  );
}
