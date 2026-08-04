// One switch for the eye-candy that is cheap on Blink/WebKit but measurably
// janky on Gecko, decided ONCE here — never a per-component browser check.
//
// Firefox composites two of our effects far slower than Chromium, and both
// sit exactly where the panels open over an animating map:
// - `backdrop-filter: blur` re-renders the backdrop into an intermediate
//   surface on every frame that dirties it (bugzilla 1718471), and a glass
//   panel over a Leaflet fit animation dirties it for the whole glide;
// - a CSS `filter` chain on the map tiles is re-rasterized while the tile
//   pane pans/zooms — the pathology reported against every large tiled
//   image viewer on Gecko (e.g. openseadragon#1368), where Chromium keeps
//   the filtered surface on the GPU.
// Both are decoration with a designed fallback: the glass backgrounds are
// near-opaque on purpose (theme.ts), and the basemap already swaps
// dark/light per theme (lib/tiles.ts) — the tile filter only fine-tunes the
// blend. So on Gecko the app runs in a « lite effects » mode: `glassBlur`
// (theme.ts) returns no blur, and styles.css drops the decorative tile
// filters under `:root[data-fx='lite']`.
//
// Feature-detected (`-moz-appearance` parses on Gecko only) rather than
// UA-sniffed; the `typeof` guard keeps the module importable under vitest's
// node environment, where LITE_FX is false and nothing changes.
export const LITE_FX =
  typeof CSS !== 'undefined' && CSS.supports('-moz-appearance', 'none');

/** Stamp the mode on <html> before first paint so the CSS side agrees */
export function applyFxMode(): void {
  if (LITE_FX) document.documentElement.dataset.fx = 'lite';
}
