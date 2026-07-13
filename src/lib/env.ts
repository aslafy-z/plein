// Safe dev-mode detection: true under the Vite dev server, false in the
// production build AND when the providers are bundled for Node
// (scripts/live-providers.mjs), where import.meta.env doesn't exist.
export const IS_DEV: boolean =
  typeof import.meta !== 'undefined' &&
  Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
