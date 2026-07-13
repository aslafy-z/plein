// Notices that a newer build has been deployed while this one is running.
//
// The app is installable and lives most of its life backgrounded on a phone, so
// it can keep running a bundle from days ago: nothing re-requests index.html
// until the tab is actually reloaded, and no cache header changes that. On every
// return to the foreground we compare the deployed version against our own and
// offer a reload when they differ.
import { IS_DEV } from './env';

export const APP_VERSION: string = __APP_VERSION__;

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

  const stop = () => {
    stopped = true;
    clearTimeout(pending);
    document.removeEventListener('visibilitychange', schedule);
  };

  const check = async () => {
    pending = undefined;
    if (stopped || document.visibilityState !== 'visible') return;
    lastCheck = Date.now();

    const live = await deployedVersion();
    if (stopped || live === null || live === APP_VERSION) return;
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
  return stop;
}
