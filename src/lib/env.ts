// Safe dev-mode detection: true under the Vite dev server, false in the
// production build AND when the providers are bundled for Node
// (scripts/live-providers.mjs), where import.meta.env doesn't exist.
export const IS_DEV: boolean =
  typeof import.meta !== 'undefined' &&
  Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

/**
 * Base path of the same-origin proxy that fronts the German price API, or
 * null when this deployment has none.
 *
 * Tankerkönig needs a personal API key that must never reach the browser, so
 * the app only ever talks to a proxy holding it — which not every deployment
 * runs. `vite.config.ts` resolves the path (`PLEIN_DE_PROXY`, or the dev
 * middleware when TANKERKOENIG_API_KEY is exported) and stamps it here, so
 * the bundle KNOWS whether the source can answer instead of discovering it
 * through a 503: unconfigured, Germany is greyed out in Settings, « Automatic »
 * never queries it and German place search stays off.
 *
 * Guarded like IS_DEV: this module is also bundled for Node
 * (scripts/live-providers.mjs), where the define doesn't exist and the key
 * comes from the environment instead.
 */
export const DE_PROXY_BASE: string | null =
  typeof __DE_PROXY__ === 'undefined' ? null : __DE_PROXY__;

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
