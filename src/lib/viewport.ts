// Keeps --app-height equal to the real visible viewport. Android PWAs can be
// foregrounded with a stale (dvh) viewport — the shell then overflows and the
// tab bar falls below a scroll. Re-measuring on resume fixes it.
function sync(): void {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}

if (typeof window !== 'undefined') {
  sync();
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  window.addEventListener('pageshow', sync);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
}

export {};
