// Locale wiring.
//
// Paraglide resolves the locale through the strategy list configured in
// vite.config.ts: `custom-appSettings` first (an explicit choice in Réglages),
// then `preferredLanguage` (what the browser asks for), then `baseLocale`
// (French). The custom strategy reads and writes the app's own settings blob,
// so the language is a persisted setting like `fuel` or `mapsSite` — no second
// storage key, and nothing to keep in sync.
//
// Importing this module registers the strategy; do it before anything can call
// a message function.
import { loadPersisted, savePersisted } from '../state/persist';
import {
  baseLocale,
  defineCustomClientStrategy,
  getLocale,
  isLocale,
  locales,
  setLocale as paraglideSetLocale,
  type Locale,
} from '../paraglide/runtime.js';

export type { Locale };

/**
 * Paraglide echoes the locale it just resolved back through every strategy's
 * `setLocale` (opral/inlang-paraglide-js#455). Persisting that echo would turn
 * a language merely DETECTED from the browser into an explicit choice, and the
 * app would stop following the browser forever after its first render. So the
 * blob is only written while the app is deliberately switching language.
 */
let persisting = false;

defineCustomClientStrategy('custom-appSettings', {
  getLocale: () => loadPersisted().locale,
  setLocale: (locale) => {
    if (persisting) savePersisted({ locale });
  },
});

/** Every locale the app ships, base locale first */
export const LOCALES: readonly Locale[] = locales;

/** The explicit choice made in Réglages, or null while the browser decides */
export function explicitLocale(): Locale | null {
  const saved = loadPersisted().locale;
  return isLocale(saved) ? saved : null;
}

/** Locale the browser asks for, ignoring any explicit choice */
export function detectedLocale(): Locale {
  const preferred = typeof navigator === 'undefined' ? [] : (navigator.languages ?? []);
  for (const tag of preferred) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return baseLocale;
}

/** Locale in force right now */
export function currentLocale(): Locale {
  return getLocale();
}

/**
 * Switch language without reloading. A reload is Paraglide's default because a
 * server-rendered page has to be re-fetched; here every screen is React state,
 * so the store re-renders the tree instead — and an in-progress route or
 * search survives the switch.
 */
export function applyLocale(locale: Locale): void {
  persisting = true;
  try {
    paraglideSetLocale(locale, { reload: false });
  } finally {
    persisting = false;
  }
  syncDocumentLocale();
}

/** Drop the explicit choice and follow the browser again */
export function followBrowserLocale(): Locale {
  savePersisted({ locale: undefined });
  const next = detectedLocale();
  paraglideSetLocale(next, { reload: false });
  syncDocumentLocale();
  return next;
}

/**
 * Keep the document in the active language: `lang` drives hyphenation, the
 * spoken output of screen readers and the browser's translate prompt, and the
 * title is what a bookmark or a shared tab shows.
 */
export function syncDocumentLocale(title?: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLocale();
  if (title) document.title = title;
}
