/** Favorite star picto — filled when the station is pinned */
export default function Star({
  filled,
  color,
  size = 18,
}: {
  filled: boolean;
  color: string;
  size?: number;
}) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <path
        d="M8 1.7 L9.9 5.6 L14.2 6.2 L11.1 9.2 L11.8 13.5 L8 11.4 L4.2 13.5 L4.9 9.2 L1.8 6.2 L6.1 5.6 Z"
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={filled ? 0 : 1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}
