import { beforeEach, describe, expect, it, vi } from 'vitest';

type Outcome = 'accepted' | 'dismissed';

/** A stand-in for Chrome's BeforeInstallPromptEvent: prompt() works once. */
function fakeInstallEvent(outcome: Outcome | 'reject') {
  let used = false;
  let resolveChoice!: (choice: { outcome: Outcome }) => void;
  const userChoice = new Promise<{ outcome: Outcome }>((resolve) => {
    resolveChoice = resolve;
  });
  return {
    preventDefault: vi.fn(),
    userChoice,
    prompt: vi.fn(async () => {
      if (used || outcome === 'reject') throw new DOMException('spent', 'InvalidStateError');
      used = true;
      resolveChoice({ outcome });
    }),
  };
}

async function loadModule() {
  const handlers = new Map<string, (e: unknown) => void>();
  vi.resetModules();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal('navigator', {});
  const mod = await import('./installPrompt');
  const fire = (type: string, e: unknown = {}) => handlers.get(type)?.(e);
  return { ...mod, fire };
}

describe('promptInstall', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('is unavailable until the browser offers an install', async () => {
    const { installReady, promptInstall } = await loadModule();
    expect(installReady()).toBe(false);
    expect(await promptInstall()).toBe('unavailable');
  });

  it('retires the event after a dismissal and is ready again on a new one', async () => {
    const { installReady, promptInstall, subscribeInstall, fire } = await loadModule();
    const onChange = vi.fn();
    subscribeInstall(onChange);

    const first = fakeInstallEvent('dismissed');
    fire('beforeinstallprompt', first);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(installReady()).toBe(true);

    onChange.mockClear();
    expect(await promptInstall()).toBe('dismissed');
    expect(installReady()).toBe(false);
    expect(onChange).toHaveBeenCalled();

    // The spent event is never prompted a second time.
    expect(await promptInstall()).toBe('unavailable');
    expect(first.prompt).toHaveBeenCalledTimes(1);

    fire('beforeinstallprompt', fakeInstallEvent('accepted'));
    expect(installReady()).toBe(true);
  });

  it('retires the event after an acceptance', async () => {
    const { installReady, promptInstall, fire } = await loadModule();
    fire('beforeinstallprompt', fakeInstallEvent('accepted'));
    expect(await promptInstall()).toBe('accepted');
    expect(installReady()).toBe(false);
  });

  it('answers unavailable, without throwing, when the prompt is refused', async () => {
    const { installReady, promptInstall, subscribeInstall, fire } = await loadModule();
    const onChange = vi.fn();
    fire('beforeinstallprompt', fakeInstallEvent('reject'));
    subscribeInstall(onChange);
    expect(await promptInstall()).toBe('unavailable');
    expect(installReady()).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });
});
