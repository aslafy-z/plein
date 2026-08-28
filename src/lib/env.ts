// Safe dev-mode detection: true under the Vite dev server, false in the
// production build AND when the providers are bundled for Node
// (scripts/live-providers.mjs), where import.meta.env doesn't exist.
export const IS_DEV: boolean =
  typeof import.meta !== 'undefined' &&
  Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

// The build's own CARTO basemap key, substituted by Vite wherever a
// `VITE_CARTO_KEY` is set (`.env.local`, or the environment of the machine
// running the build). Undefined everywhere else — including under vitest and
// in the Node bundle — and lib/cartoKey.ts falls back to the shipped key.
export const CARTO_KEY_OVERRIDE: string | undefined =
  typeof import.meta !== 'undefined'
    ? (import.meta as { env?: { VITE_CARTO_KEY?: string } }).env?.VITE_CARTO_KEY
    : undefined;

// Platform detection for the « Go there » handoff (guarded: this module is
// also bundled for Node, where `navigator` doesn't exist).
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
/** Android — geo: URI opens the native maps-app chooser */
export const IS_ANDROID: boolean = /android/i.test(UA);
/** iOS/iPadOS — Apple Maps (modern iPads report as Macintosh, hence the touch check) */
export const IS_IOS: boolean =
  /iphone|ipad|ipod/i.test(UA) ||
  (/macintosh/i.test(UA) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
/** Platforms where « Go there » hands off to a native GPS app instead of a website */
export const HAS_NATIVE_MAPS: boolean = IS_ANDROID || IS_IOS;
