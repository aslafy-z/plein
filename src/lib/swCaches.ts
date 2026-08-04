// The service worker's cache names and caps, mirrored from public/sw.js.
//
// Nothing can import that file (it is a plain script served out of public/,
// with its own global scope), so this module is the app's ONE copy of those
// names: the basemap's offline gate reads the tile cache to know what may
// still be requested, and the debug readouts count entries against the caps
// (« 597/600 » is one pan away from eviction). A name that drifts from sw.js
// silently reads an empty cache, so they are declared once here rather than
// spelled out at each reader.
export const SW_ASSET_CACHE = 'plein-assets-v1';
export const SW_SHELL_CACHE = 'plein-shell-v1';
export const SW_TILE_CACHE = 'plein-tiles-v1';
export const SW_DATA_CACHE = 'plein-data-v2';

/** Entry cap sw.js trims each cache to — null where it keeps everything */
export const SW_CACHE_CAPS: Record<string, number | null> = {
  [SW_ASSET_CACHE]: 160,
  [SW_SHELL_CACHE]: null,
  [SW_TILE_CACHE]: 600,
  [SW_DATA_CACHE]: null,
};
