/** Locate picto — the map-app crosshair: a ring with its four ticks, the
    center dot filled only when the view actually sits on the user.

    `spinning` turns the picto itself while a fix is being acquired, rather
    than swapping it for a spinner glyph: the crosshair is symmetric around
    the center of its own box, so it rotates in place instead of wobbling,
    and the control keeps the shape the tap was aimed at. */
export default function LocateIcon({
  color,
  dot,
  size = 20,
  spinning = false,
}: {
  color: string;
  dot: boolean;
  size?: number;
  spinning?: boolean;
}) {
  return (
    <svg
      className={spinning ? 'spin' : undefined}
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden
    >
      {/* Colors via style: a var() token resolves in CSS, not in an attribute.
          They fade rather than snap — the picto goes dim while it turns and
          takes the accent back the moment the fix lands. */}
      <g
        fill="none"
        style={{ stroke: color, transition: 'stroke .25s var(--ease-snap)' }}
        strokeWidth={1.7}
        strokeLinecap="round"
      >
        <circle cx="10" cy="10" r="5.1" />
        <path d="M10 1.6 V3.6" />
        <path d="M10 16.4 V18.4" />
        <path d="M1.6 10 H3.6" />
        <path d="M16.4 10 H18.4" />
      </g>
      {dot && (
        <circle cx="10" cy="10" r="2.1" style={{ fill: color, transition: 'fill .25s var(--ease-snap)' }} />
      )}
    </svg>
  );
}
