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
//
// The accent is a second, independent axis on the same document: a preset
// picked in Settings (`accent` in the blob — absent means green, the brand
// color), applied as `data-accent` next to `data-theme`. styles.css holds
// each preset's tones per theme, so the two attributes compose freely.
import { loadPersisted, savePersisted } from '../state/persist';
import { prefersReducedMotion } from './motion';

export type Theme = 'dark' | 'light';

/** Both themes, dark first — the app's native look leads the picker */
export const THEMES: readonly Theme[] = ['dark', 'light'];

export function isTheme(raw: unknown): raw is Theme {
  return raw === 'dark' || raw === 'light';
}

export type Accent = 'green' | 'turquoise' | 'blue' | 'violet';

/** Every accent preset, the brand green first — the picker's order */
export const ACCENTS: readonly Accent[] = ['green', 'turquoise', 'blue', 'violet'];

/** The brand color, and what an absent or unknown choice resolves to */
export const DEFAULT_ACCENT: Accent = 'green';

export function isAccent(raw: unknown): raw is Accent {
  return typeof raw === 'string' && (ACCENTS as readonly string[]).includes(raw);
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

/** Accent in force right now — the saved preset, or the brand green */
export function currentAccent(): Accent {
  const saved = loadPersisted().accent;
  return isAccent(saved) ? saved : DEFAULT_ACCENT;
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
  document.documentElement.dataset.accent = currentAccent();
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
}

function notify(): void {
  syncDocumentTheme();
  for (const cb of listeners) cb();
}

/**
 * notify(), cross-faded. A theme or accent flip re-colors every surface at once — CSS
 * variables, tile filters, gradients, inline styles — so animating the
 * properties one by one would leave the non-interpolable ones (gradients, the
 * basemap swap) snapping mid-fade. The View Transitions API animates the flip
 * as ONE whole-page cross-fade instead: the attribute change inside the
 * callback stays the entire switch. Browsers without the API, a user asking
 * for reduced motion, and a notify() that would not re-color anything (the
 * resolved theme and accent are already on the document) all take the plain instant path.
 */
function animatedNotify(): void {
  if (
    typeof document === 'undefined' ||
    typeof document.startViewTransition !== 'function' ||
    prefersReducedMotion() ||
    (document.documentElement.dataset.theme === currentTheme() &&
      document.documentElement.dataset.accent === currentAccent())
  ) {
    notify();
    return;
  }
  document.startViewTransition(notify);
}

/** Persist an explicit choice and apply it */
export function applyTheme(theme: Theme): void {
  savePersisted({ theme });
  animatedNotify();
}

/** Drop the explicit choice and follow the browser again */
export function followBrowserTheme(): Theme {
  savePersisted({ theme: undefined });
  animatedNotify();
  return detectedTheme();
}

/** Persist an accent preset and apply it — the brand green is stored as
    absent, so the blob only carries a choice that differs from the default */
export function applyAccent(accent: Accent): void {
  savePersisted({ accent: accent === DEFAULT_ACCENT ? undefined : accent });
  animatedNotify();
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
  if (explicitTheme() == null) animatedNotify();
});

// index.html already set the attribute pre-paint; re-sync here so the meta
// catches up once the stylesheet is loaded (and dev/test environments that
// skip the inline script still get the attribute).
syncDocumentTheme();
