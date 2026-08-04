import { afterEach, describe, expect, it, vi } from 'vitest';

// The German flux is the one source that can be absent from a build: it needs
// a proxy holding a personal Tankerkönig key, and `__DE_PROXY__` (stamped by
// vite.config from the build environment) is how the bundle knows. These tests
// drive both halves of that gate — the module reads the define once, at import,
// so each case re-imports with its own value.

async function loadWith(proxy: string | null) {
  vi.resetModules();
  vi.stubGlobal('__DE_PROXY__', proxy);
  // Node counts a key in the environment as a proxy of its own (the live-check
  // script plays that role) — cleared so the result doesn't depend on whoever
  // is running the suite having one exported.
  vi.stubEnv('TANKERKOENIG_API_KEY', '');
  return await import('./DeStationsProvider');
}

const BERLIN = { lat: 52.52, lng: 13.405 };
const BERLIN_POTSDAM = [BERLIN, { lat: 52.3906, lng: 13.0645 }];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('German source availability', () => {
  it('reports itself unavailable without a proxy', async () => {
    const de = await loadWith(null);
    expect(de.deAvailable()).toBe(false);
  });

  it('covers nothing at all when unavailable — « Automatic » never queries it', async () => {
    const de = await loadWith(null);
    // Berlin is as German as a zone gets: geography alone would say yes
    expect(de.deCoversNear(BERLIN, 5)).toBe(false);
    expect(de.deCoversAlong(BERLIN_POTSDAM, 5)).toBe(false);
  });

  it('answers an unconfigured direct query with an error, never an empty zone', async () => {
    const de = await loadWith(null);
    const provider = new de.DeStationsProvider();
    await expect(provider.getStationsNear(BERLIN, 5)).rejects.toThrow(/proxy/i);
    await expect(provider.getStationsAlong(BERLIN_POTSDAM, 5)).rejects.toThrow(/proxy/i);
  });

  it('covers Germany — and only Germany — once a proxy is configured', async () => {
    const de = await loadWith('/api/de');
    expect(de.deAvailable()).toBe(true);
    expect(de.deCoversNear(BERLIN, 5)).toBe(true);
    expect(de.deCoversAlong(BERLIN_POTSDAM, 5)).toBe(true);
    // Lisboa and Toulouse stay outside the covering circle
    expect(de.deCoversNear({ lat: 38.7223, lng: -9.1393 }, 5)).toBe(false);
    expect(de.deCoversNear({ lat: 43.6047, lng: 1.4442 }, 5)).toBe(false);
  });
});

describe('German source URLs', () => {
  it('calls its own origin, never echoing the upstream endpoint', async () => {
    const de = await loadWith('/api/de');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new de.DeStationsProvider().getStationsNear(BERLIN, 5);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith('/api/de/stations?')).toBe(true);
    expect(url).not.toContain('.php');
    // …and the key never rides along on the browser's request
    expect(url).not.toContain('apikey');
  });
});
