// Notices that a newer build has been deployed while this one is running.
//
// The app is installable and lives most of its life backgrounded on a phone, so
// it can keep running a bundle from days ago: nothing re-requests index.html
// until the tab is actually reloaded, and no cache header changes that. At
// startup, on every return to the foreground and when connectivity returns we
// compare the deployed version against our own and offer a reload when they
// differ.
import { IS_DEV } from './env';
import { isOffline, onConnectivityChange } from './connectivity';

export const APP_VERSION: string = __APP_VERSION__;

/** Repository home (package.json `repository`) — the Settings contact links */
export const REPO_URL: string = __REPO_URL__;

/** Visibility flaps in bursts on mobile; at most one check per interval. */
const MIN_INTERVAL_MS = 60_000;

async function deployedVersion(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    // Offline, or the deploy is mid-flight — try again next time.
    return null;
  }
}

/**
 * Calls `onUpdate` once a different version is live. Returns a teardown; the
 * watch also stops on its own after firing.
 */
export function watchForUpdate(onUpdate: () => void): () => void {
  if (IS_DEV) return () => {};

  let lastCheck = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let unwatchConnectivity: () => void = () => {};

  const stop = () => {
    stopped = true;
    clearTimeout(pending);
    document.removeEventListener('visibilitychange', schedule);
    unwatchConnectivity();
  };

  const check = async () => {
    pending = undefined;
    if (stopped || document.visibilityState !== 'visible') return;
    // The poll is a `no-store` request the app makes on its own, so it waits
    // while « Force offline mode » holds — and while the browser is sure
    // there is no network, where it could only fail. `lastCheck` deliberately
    // stays put: the watch is still armed, and it re-checks the moment
    // connectivity returns.
    if (isOffline()) return;
    // Stamped before the fetch so a visibility flap during the request defers
    // instead of starting a second one — but rolled back when the request
    // fails (the radio is often not up yet at the very instant a phone
    // foregrounds the app), or one lost race would mute the next return for
    // a whole interval.
    const before = lastCheck;
    lastCheck = Date.now();

    const live = await deployedVersion();
    if (stopped) return;
    if (live === null) {
      lastCheck = before;
      return;
    }
    if (live === APP_VERSION) return;
    stop();
    onUpdate();
  };

  // Rate-limiting must defer, never drop: a foreground landing inside the
  // interval is precisely when a deploy has just happened, and dropping it would
  // leave the app stale until the next background/foreground cycle.
  function schedule(): void {
    if (stopped || pending !== undefined || document.visibilityState !== 'visible') return;
    pending = setTimeout(check, Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCheck)));
  }

  document.addEventListener('visibilitychange', schedule);
  unwatchConnectivity = onConnectivityChange(schedule);
  // A cold start is an « open » too. The shell usually comes fresh off the
  // network, but a stale one (offline fallback, a restored session) would
  // otherwise run unnoticed until the first background/foreground cycle —
  // the « I had to open it twice to be told » failure.
  schedule();
  return stop;
}
