// The watch drives UpdatePrompt: it must notice a newer deploy on the very
// first trigger available — startup included — because a phone user's « open
// the app » is a cold start as often as a foreground return, and an update
// only offered on the second open reads as the app not noticing its own
// deploys.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ IS_DEV: false }));

type Listener = () => void;

class FakeEventTarget {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener = (type: string, cb: Listener): void => {
    const set = this.listeners.get(type) ?? new Set();
    set.add(cb);
    this.listeners.set(type, set);
  };
  removeEventListener = (type: string, cb: Listener): void => {
    this.listeners.get(type)?.delete(cb);
  };
  dispatch(type: string): void {
    for (const cb of [...(this.listeners.get(type) ?? [])]) cb();
  }
}

class FakeDocument extends FakeEventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

const versionResponse = (version: string) =>
  new Response(JSON.stringify({ version }), { status: 200 });

let doc: FakeDocument;
let win: FakeEventTarget;
let nav: { onLine: boolean };
let fetchMock: ReturnType<typeof vi.fn>;
let watchForUpdate: typeof import('./appUpdate').watchForUpdate;

beforeEach(async () => {
  vi.useFakeTimers();
  doc = new FakeDocument();
  win = new FakeEventTarget();
  nav = { onLine: true };
  fetchMock = vi.fn(async () => versionResponse('next'));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('fetch', fetchMock);
  // Fresh module state: connectivity keeps a module-level listener set, and a
  // watch left armed by one test must not fire into the next.
  vi.resetModules();
  ({ watchForUpdate } = await import('./appUpdate'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const foregroundReturn = () => {
  doc.visibilityState = 'hidden';
  doc.dispatch('visibilitychange');
  doc.visibilityState = 'visible';
  doc.dispatch('visibilitychange');
};

describe('watchForUpdate', () => {
  it('offers the update at startup, without waiting for a foreground cycle', async () => {
    const onUpdate = vi.fn();
    watchForUpdate(onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('stays quiet on the running version, then offers on the next foreground return', async () => {
    const onUpdate = vi.fn();
    // __APP_VERSION__ is 'test' under vitest (vitest.config.ts)
    fetchMock.mockImplementation(async () => versionResponse('test'));
    watchForUpdate(onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async () => versionResponse('next'));
    await vi.advanceTimersByTimeAsync(61_000);
    foregroundReturn();
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not let a failed check burn the rate limit for the next return', async () => {
    const onUpdate = vi.fn();
    fetchMock.mockImplementation(async () => {
      throw new Error('radio not up yet');
    });
    watchForUpdate(onUpdate);
    foregroundReturn();
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async () => versionResponse('next'));
    await vi.advanceTimersByTimeAsync(1_000);
    foregroundReturn();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('re-checks the moment connectivity returns, not at the next foreground', async () => {
    const onUpdate = vi.fn();
    nav.onLine = false;
    watchForUpdate(onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();

    nav.onLine = true;
    win.dispatch('online');
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('defers a check landing inside the rate-limit window instead of dropping it', async () => {
    const onUpdate = vi.fn();
    fetchMock.mockImplementation(async () => versionResponse('test'));
    watchForUpdate(onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async () => versionResponse('next'));
    await vi.advanceTimersByTimeAsync(10_000);
    foregroundReturn();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('stops for good after firing once', async () => {
    const onUpdate = vi.fn();
    watchForUpdate(onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    foregroundReturn();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('the teardown stops the watch', async () => {
    const onUpdate = vi.fn();
    const stop = watchForUpdate(onUpdate);
    stop();
    foregroundReturn();
    win.dispatch('online');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
