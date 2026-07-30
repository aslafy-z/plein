// Live `navigator.onLine`, as state. Only the `false` reading is trustworthy
// (no network interface at all) — `true` proves nothing behind a captive
// portal or a dead upstream, so the app derives its offline state from fetch
// FAILURES and uses this bit to label them and to revalidate the moment
// connectivity returns.
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const snapshot = () => navigator.onLine !== false;

/** Reactive `navigator.onLine` — false only when the browser is sure */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
