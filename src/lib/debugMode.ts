// The debug overlay's switch, and the console-error recorder it reads.
//
// The flag lives in sessionStorage, NOT in the persisted settings blob: a
// tester turning it on must not carry it into their normal sessions, and the
// persisted schema must not grow a field only developer chrome reads. It can
// be raised three ways — the Settings « Offline data » toggle, `?debug=1` in the
// URL (adopted into sessionStorage so the flag survives in-app navigation,
// which rewrites the query), or an existing sessionStorage flag from earlier
// in the session.
//
// This module is tiny and eagerly imported (the Settings toggle and the App
// mount point read it); everything heavy — the overlay UI, the snapshot
// collector — stays behind a dynamic import that only loads once the flag is
// on, so the production bundle is untouched for everyone else.
import { useSyncExternalStore } from 'react';

const SESSION_KEY = 'plein.debug';

/** One console error / uncaught failure the recorder held on to */
export interface RecordedError {
  at: number;
  message: string;
}

/** The last few are enough to read on a phone; the count says the rest */
const MAX_RECORDED = 5;

let errorCount = 0;
const recent: RecordedError[] = [];
let hooked = false;

const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

function readSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSession(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(SESSION_KEY, '1');
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private window refusing storage — the in-memory flag still works */
  }
}

function detectInitial(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    writeSession(true);
    return true;
  }
  return readSession();
}

let enabled = detectInitial();

function record(message: string): void {
  errorCount++;
  recent.push({ at: Date.now(), message: message.slice(0, 500) });
  if (recent.length > MAX_RECORDED) recent.shift();
  notify();
}

/**
 * Start recording errors. Installed once, on the first enable — the e2e
 * fixture already fails any test whose page logs a console error, so nothing
 * here may log; it only counts. `console.error` keeps its original behavior.
 */
function installErrorHook(): void {
  if (hooked || typeof window === 'undefined') return;
  hooked = true;
  window.addEventListener('error', (e) => record(e.message || 'uncaught error'));
  window.addEventListener('unhandledrejection', (e) =>
    record(`unhandled rejection: ${String(e.reason)}`),
  );
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    record(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    original(...args);
  };
}

if (enabled) installErrorHook();

export function isDebugEnabled(): boolean {
  return enabled;
}

export function setDebugEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  writeSession(on);
  if (on) installErrorHook();
  notify();
}

/** Reactive flag — the App mount point and the Settings toggle read this */
export function useDebugMode(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => enabled,
    () => false,
  );
}

/** Reactive error count — the chip's badge follows errors as they land */
export function useConsoleErrorCount(): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => errorCount,
    () => 0,
  );
}

/** What the overlay's global strip shows about console errors */
export function consoleErrorsDebug(): { count: number; recent: RecordedError[] } {
  return { count: errorCount, recent: [...recent] };
}
