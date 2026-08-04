import { afterEach, describe, expect, it } from 'vitest';
import { isForcedOffline, onConnectivityChange, setForcedOffline } from './connectivity';

// The flag is module state shared by the whole session — every test leaves it
// off so no ordering can leak a forced session into another test.

afterEach(() => setForcedOffline(false));

describe('forced offline flag', () => {
  it('is off by default', () => {
    expect(isForcedOffline()).toBe(false);
  });

  it('flips, notifies subscribers, and treats a same-value set as a no-op', () => {
    let calls = 0;
    const unsubscribe = onConnectivityChange(() => calls++);

    setForcedOffline(true);
    expect(isForcedOffline()).toBe(true);
    expect(calls).toBe(1);

    setForcedOffline(true);
    expect(calls).toBe(1);

    setForcedOffline(false);
    expect(isForcedOffline()).toBe(false);
    expect(calls).toBe(2);

    unsubscribe();
    setForcedOffline(true);
    expect(calls).toBe(2);
  });
});
