// Theme wiring.
//
// The palette lives in src/styles.css as CSS variables keyed on the
// document's `data-theme` attribute; index.html resolves that attribute once
// before first paint. This module keeps it LIVE after boot: it applies an
// explicit choice made in Réglages (persisted in `plein.settings.v1` like
// `fuel` or `locale` — absent means « follow the browser »), follows the
// browser preference while no choice is made, and keeps the `theme-color`
// meta in step so the PWA chrome matches the shell.
//
// Resolution order mirrors the locale's: explicit choice → browser
// preference → dark (the app's native look).
import { loadPersisted, savePersisted } from '../state/persist';

export type Theme = 'dark' | 'light';

/** Both themes, dark first — the app's native look leads the picker */
export const THEMES: readonly Theme[] = ['dark', 'light'];

export function isTheme(raw: unknown): raw is Theme {
  return raw === 'dark' || raw === 'light';
}

const media: MediaQueryList | null =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;

const listeners = new Set<() => void>();

/** The explicit choice made in Réglages, or null while the browser decides */
export function explicitTheme(): Theme | null {
  const saved = loadPersisted().theme;
  return isTheme(saved) ? saved : null;
}

/** Theme the browser asks for, ignoring any explicit choice */
export function detectedTheme(): Theme {
  return media?.matches ? 'light' : 'dark';
}

/** Theme in force right now */
export function currentTheme(): Theme {
  return explicitTheme() ?? detectedTheme();
}

/**
 * Put the resolved theme on the document. The attribute flip is the whole
 * switch — every color is a CSS variable keyed on it — plus the
 * `theme-color` meta, which browsers read for the PWA title bar and the
 * mobile status bar. The meta reads the variable back from the flipped
 * document rather than knowing any hex of its own.
 */
function syncDocumentTheme(): void {
  if (typeof document === 'undefined') return;
  const theme = currentTheme();
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
}

function notify(): void {
  syncDocumentTheme();
  for (const cb of listeners) cb();
}

/** Persist an explicit choice and apply it */
export function applyTheme(theme: Theme): void {
  savePersisted({ theme });
  notify();
}

/** Drop the explicit choice and follow the browser again */
export function followBrowserTheme(): Theme {
  savePersisted({ theme: undefined });
  notify();
  return detectedTheme();
}

/**
 * Hear theme changes — the store re-renders React from this, and the basemap
 * (lib/tiles.ts) swaps its tile set. Returns the unsubscribe.
 */
export function onThemeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// While no explicit choice is made, the app follows the browser LIVE — a
// system flipping to dark at dusk flips the app with it.
media?.addEventListener('change', () => {
  if (explicitTheme() == null) notify();
});

// index.html already set the attribute pre-paint; re-sync here so the meta
// catches up once the stylesheet is loaded (and dev/test environments that
// skip the inline script still get the attribute).
syncDocumentTheme();
