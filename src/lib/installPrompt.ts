// PWA install plumbing — captures Android Chrome's beforeinstallprompt so the
// app can trigger the NATIVE install dialog from its own UI.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button instead of the mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function installReady(): boolean {
  return deferred != null && !isStandalone();
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Show the native install dialog. The captured event is single-use: once it
 * has been answered — or its prompt() refused — it is retired whatever the
 * outcome, and the browser fires a new beforeinstallprompt if it wants to
 * offer again.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const ev = deferred;
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    return outcome;
  } catch {
    return 'unavailable'; // a spent event, or a call outside a user gesture
  } finally {
    // A newer event captured while the dialog was open stays.
    if (deferred === ev) deferred = null;
    notify();
  }
}
