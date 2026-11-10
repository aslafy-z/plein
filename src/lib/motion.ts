// The one reader of the browser's reduced-motion preference.
//
// CSS covers most of it on its own: the `prefers-reduced-motion` block in
// styles.css drops the keyframes and zeroes the slide durations
// (`--dur-sheet`, `--dur-shift`) the inline transitions reference. This
// module is for what a stylesheet cannot reach — a `scrollBy` behavior, a
// view transition, a timer waiting on a `transitionend` that a zero-length
// transition never fires.
const reducedMotion: MediaQueryList | null =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

/** Whether the user asks for reduced motion — read live, the preference can
    flip while the app is open */
export function prefersReducedMotion(): boolean {
  return reducedMotion?.matches === true;
}
