// Live `navigator.onLine`, as state. Only the `false` reading is trustworthy
// (no network interface at all) — `true` proves nothing behind a captive
// portal or a dead upstream, so the app derives its offline state from fetch
// FAILURES and uses this bit to label them and to revalidate the moment
// connectivity returns.
//
// The « Force offline mode » switch (Settings › Offline data) rides the same
// module: while it is on, every fetch the app would start on its own is
// skipped as if the device were offline, so the cached areas can be exercised
// on a healthy connection. The flag lives in sessionStorage, NOT in the
// persisted settings blob — like the debug overlay's flag, a mode someone
// flips to try the app out must not follow them into tomorrow's session.
import { useSyncExternalStore } from 'react';

const SESSION_KEY = 'plein.forceOffline';

const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
  }
  return () => {
    listeners.delete(onChange);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    }
  };
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

let forced = readSession();

/** The « Force offline mode » switch is on for this session */
export function isForcedOffline(): boolean {
  return forced;
}

/**
 * The one synchronous offline reading fetch paths gate on: the browser is
 * POSITIVE it has no network, or the forced switch holds. Everything else
 * (a captive portal, a dead upstream) still has to be discovered by failing.
 */
export function isOffline(): boolean {
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || forced;
}

export function setForcedOffline(on: boolean): void {
  if (on === forced) return;
  forced = on;
  writeSession(on);
  notify();
}

/** Reactive forced flag — the Settings switch and the offline banner read it */
export function useForcedOffline(): boolean {
  return useSyncExternalStore(subscribe, isForcedOffline, () => false);
}

/**
 * Imperative mirror of the hooks, for non-React code: fires on the browser's
 * online/offline events AND on the forced switch — the store's auto-refresh
 * re-arms on any of them, so releasing the switch revalidates like
 * connectivity returning does.
 */
export function onConnectivityChange(cb: () => void): () => void {
  return subscribe(cb);
}

const snapshot = () => !isOffline();

/** Reactive `navigator.onLine` — false only when the browser is sure, or
 *  when the « Force offline mode » switch says so */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
