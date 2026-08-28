// The CARTO basemap key: where it comes from, how it goes onto a tile URL,
// and how it comes back off.
//
// CARTO's raster CDN now answers keyless requests with tiles stamped « API
// key required », so every basemap URL the app builds carries a key as a
// `key` query parameter (their documented form).
//
// The key below is the one this app deploys with — dev and prod alike, so a
// fresh clone draws a clean map with nothing to set up. A build can swap it
// for its own account's key through `VITE_CARTO_KEY` (`.env.local`, or the
// environment CI builds in — see `.env.example`); an unset or blank override
// falls back here rather than shipping a keyless build, which would look
// fine locally and wear the watermark in production. Either way the key is
// public by construction — it ships in the bundle and rides on every tile
// request, next to the CDN address itself; what bounds it is CARTO's own
// per-key quota, not secrecy.
//
// Dependency-free string math on purpose: it has to work on Leaflet templates
// (`{s}`/`{z}`/`{x}`/`{y}`, which no URL parser accepts) and on the relative
// dev-proxy path alike, and vite.config.ts imports it for the dev tile proxy —
// a file type-checked with no DOM lib, and with no `import.meta.env` to read
// (the app reads that in lib/env.ts, the config from `loadEnv`).
export const DEFAULT_CARTO_KEY = 'cb1_2g4g_1_d547ef83d7d9ed99aeb3dfb4';

/** The parameter CARTO reads the key from */
export const CARTO_KEY_PARAM = 'key';

/** The key a build actually uses: its `VITE_CARTO_KEY`, the shipped one when
    that is unset or blank. */
export function resolveCartoKey(override: string | undefined | null): string {
  return override?.trim() || DEFAULT_CARTO_KEY;
}

/** `url` with `key` on it — the address a basemap tile is fetched at */
export function withCartoKey(url: string, key: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${CARTO_KEY_PARAM}=${key}`;
}

/**
 * The URL a tile is CACHED under: its address with the key taken back off.
 * The key authorizes the request, it is not part of the tile's identity —
 * public/sw.js normalizes the same way before touching its cache (the rule is
 * mirrored there, as nothing can import this module from a worker script).
 * Three things follow: a build that overrides the key, or an account that
 * rotates one, still hits every tile the map has already warmed; the tiles
 * cached before CARTO required a key answer too; and the key never reaches
 * the debug readouts — nor the bug reports they get pasted into. Any OTHER
 * parameter is preserved, so a `?probe=` URL stays recognizably not a tile.
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
