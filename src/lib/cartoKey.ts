// The CARTO basemap key: how it goes onto a tile URL, and how it comes back
// off for cache identity.
//
// CARTO's raster CDN now answers keyless requests with tiles stamped « API
// key required », so every basemap URL the app builds carries the key as a
// `key` query parameter (their documented form). The key is public by
// construction — it ships in the bundle and rides on every tile request, next
// to the CDN address itself; what bounds it is CARTO's own per-key quota, not
// secrecy, so it lives here rather than in a deployment secret.
//
// Dependency-free string math on purpose: it has to work on Leaflet templates
// (`{s}`/`{z}`/`{x}`/`{y}`, which no URL parser accepts) and on the relative
// dev-proxy path alike, and vite.config.ts imports it for the dev tile proxy —
// a file type-checked with no DOM lib.
export const CARTO_KEY = 'cb1_2g4g_1_d547ef83d7d9ed99aeb3dfb4';

/** The parameter CARTO reads the key from */
export const CARTO_KEY_PARAM = 'key';

/** `url` with the key on it — the address a basemap tile is fetched at */
export function withCartoKey(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${CARTO_KEY_PARAM}=${CARTO_KEY}`;
}

/**
 * The URL a tile is CACHED under: its address with the key taken back off.
 * The key authorizes the request, it is not part of the tile's identity —
 * public/sw.js normalizes the same way before touching its cache (the rule is
 * mirrored there, as nothing can import this module from a worker script).
 * Three things follow: rotating the key doesn't orphan the tiles the map has
 * already warmed, the tiles cached before CARTO required one still answer,
 * and the key never reaches the debug readouts — nor the bug reports they get
 * pasted into. Any OTHER parameter is preserved, so a `?probe=` URL stays
 * recognizably not a tile.
 */
export function tileCacheKey(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const kept = url
    .slice(q + 1)
    .split('&')
    .filter((param) => param !== CARTO_KEY_PARAM && !param.startsWith(`${CARTO_KEY_PARAM}=`));
  return kept.length === 0 ? url.slice(0, q) : `${url.slice(0, q)}?${kept.join('&')}`;
}
