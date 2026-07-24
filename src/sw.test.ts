// Runs the real public/sw.js in a mock ServiceWorkerGlobalScope: it ships as a
// standalone script (Vite copies public/ verbatim, no bundling), so the only way
// to test it is to evaluate the file itself against fake caches/fetch.
import { describe, expect, it } from 'vitest'
import SW_SOURCE from '../public/sw.js?raw'

const ORIGIN = 'https://plein.test'

type SwRequest = { url: string; method: string; mode?: string }

const request = (url: string, mode?: string): SwRequest => ({
  url: new URL(url, ORIGIN).href,
  method: 'GET',
  mode,
})

const keyOf = (req: SwRequest | string): string =>
  new URL(typeof req === 'string' ? req : req.url, ORIGIN).href

/** Insertion-ordered, like the real Cache — trimCache relies on that order. */
class FakeCache {
  readonly entries = new Map<string, Response>()
  match = async (req: SwRequest | string): Promise<Response | undefined> =>
    this.entries.get(keyOf(req))?.clone()
  put = async (req: SwRequest | string, res: Response): Promise<void> => {
    this.entries.set(keyOf(req), res)
  }
  keys = async (): Promise<SwRequest[]> =>
    [...this.entries.keys()].map((url) => ({ url, method: 'GET' }))
  delete = async (req: SwRequest | string): Promise<boolean> => this.entries.delete(keyOf(req))
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>()
  open = async (name: string): Promise<FakeCache> => {
    const existing = this.stores.get(name)
    if (existing) return existing
    const created = new FakeCache()
    this.stores.set(name, created)
    return created
  }
  keys = async (): Promise<string[]> => [...this.stores.keys()]
  delete = async (name: string): Promise<boolean> => this.stores.delete(name)
  match = async (req: SwRequest | string): Promise<Response | undefined> => {
    for (const store of this.stores.values()) {
      const hit = await store.match(req)
      if (hit) return hit
    }
    return undefined
  }
}

type SwListener = (event: unknown) => void
type SwLimits = { ASSET_MAX_ENTRIES: number; TILE_MAX_ENTRIES: number }

// The worker's globals become parameters, so the script sees our fakes; the
// trailing return hands back the caps it declares (tests assert against the
// real numbers rather than a copy that could drift).
const swFactory = new Function(
  'self',
  'caches',
  'fetch',
  'Response',
  'URL',
  `${SW_SOURCE}\n;return { ASSET_MAX_ENTRIES, TILE_MAX_ENTRIES }`,
) as (
  self: unknown,
  caches: FakeCacheStorage,
  fetch: (req: SwRequest) => Promise<Response>,
  response: typeof Response,
  url: typeof URL,
) => SwLimits

function loadSw(fetchImpl: (req: SwRequest) => Promise<Response>) {
  const listeners = new Map<string, SwListener>()
  const caches = new FakeCacheStorage()
  const limits = swFactory(
    {
      addEventListener: (type: string, fn: SwListener) => listeners.set(type, fn),
      skipWaiting: () => {},
      clients: { claim: async () => {} },
      location: { origin: ORIGIN },
    },
    caches,
    fetchImpl,
    Response,
    URL,
  )

  /** Dispatches a fetch event and settles both the response and its waitUntil work. */
  const fetchEvent = async (req: SwRequest) => {
    const waits: Promise<unknown>[] = []
    let responded: Promise<Response> | undefined
    listeners.get('fetch')?.({
      request: req,
      respondWith: (value: Response | Promise<Response>) => {
        responded = Promise.resolve(value)
      },
      waitUntil: (value: Promise<unknown>) => {
        waits.push(Promise.resolve(value))
      },
    })
    // Every handler registers its cache write before resolving the response, so
    // `waits` is complete by the time we get here.
    const res = responded ? await responded : undefined
    await Promise.all(waits)
    return { res, waitCount: waits.length }
  }

  const activate = async () => {
    const waits: Promise<unknown>[] = []
    listeners.get('activate')?.({ waitUntil: (v: Promise<unknown>) => waits.push(v) })
    await Promise.all(waits)
  }

  return { caches, fetchEvent, activate, limits }
}

const shellCache = (sw: ReturnType<typeof loadSw>) => sw.caches.stores.get('plein-shell-v1')
const assetCache = (sw: ReturnType<typeof loadSw>) => sw.caches.stores.get('plein-assets-v1')

describe('service worker — navigations', () => {
  it('caches a successful navigation as the offline shell, inside waitUntil', async () => {
    const sw = loadSw(async () => new Response('<html>app</html>', { status: 200 }))

    const { res, waitCount } = await sw.fetchEvent(request('/', 'navigate'))

    expect(await res?.text()).toBe('<html>app</html>')
    // The write must be tracked, or the worker can be killed before it lands
    expect(waitCount).toBe(1)
    expect(await shellCache(sw)?.entries.get(`${ORIGIN}/`)?.text()).toBe('<html>app</html>')
  })

  it('does not let an error page become the shell', async () => {
    const sw = loadSw(async () => new Response('<html>500</html>', { status: 500 }))
    const cache = await sw.caches.open('plein-shell-v1')
    await cache.put('/', new Response('<html>app</html>'))

    const { res, waitCount } = await sw.fetchEvent(request('/', 'navigate'))

    // The error page is served to the page that asked for it…
    expect(res?.status).toBe(500)
    // …but the good shell survives it
    expect(waitCount).toBe(0)
    expect(await cache.entries.get(`${ORIGIN}/`)?.text()).toBe('<html>app</html>')
  })

  it('serves the cached shell when the network is down, error otherwise', async () => {
    const offline = loadSw(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { res: empty } = await offline.fetchEvent(request('/route', 'navigate'))
    expect(empty?.type).toBe('error')

    const cache = await offline.caches.open('plein-shell-v1')
    await cache.put('/', new Response('<html>app</html>'))
    const { res } = await offline.fetchEvent(request('/route', 'navigate'))
    expect(await res?.text()).toBe('<html>app</html>')
  })
})

describe('service worker — assets', () => {
  it('serves hashed assets cache-first and skips failed responses', async () => {
    let calls = 0
    const sw = loadSw(async (req) => {
      calls += 1
      return req.url.endsWith('missing.js')
        ? new Response('nope', { status: 404 })
        : new Response(`body ${calls}`, { status: 200 })
    })

    await sw.fetchEvent(request('/assets/app-abc123.js'))
    const { res } = await sw.fetchEvent(request('/assets/app-abc123.js'))
    expect(await res?.text()).toBe('body 1')
    expect(calls).toBe(1)

    await sw.fetchEvent(request('/assets/missing.js'))
    await sw.fetchEvent(request('/assets/missing.js'))
    expect(calls).toBe(3) // never cached → refetched every time
    expect(assetCache(sw)?.entries.size).toBe(1)
  })

  it('bounds the asset cache, evicting the oldest entries first', async () => {
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    const max = sw.limits.ASSET_MAX_ENTRIES

    // Each deploy adds a fresh set of content-hashed URLs; simulate a few
    for (let i = 0; i < max + 10; i += 1) {
      await sw.fetchEvent(request(`/assets/chunk-${i}.js`))
    }

    const cache = assetCache(sw)
    expect(cache?.entries.size).toBe(max)
    expect(cache?.entries.has(`${ORIGIN}/assets/chunk-0.js`)).toBe(false)
    expect(cache?.entries.has(`${ORIGIN}/assets/chunk-9.js`)).toBe(false)
    expect(cache?.entries.has(`${ORIGIN}/assets/chunk-10.js`)).toBe(true)
    expect(cache?.entries.has(`${ORIGIN}/assets/chunk-${max + 9}.js`)).toBe(true)
  })
})

describe('service worker — tiles and activation', () => {
  it('still bounds the tile cache', async () => {
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    const max = sw.limits.TILE_MAX_ENTRIES

    for (let i = 0; i < max + 5; i += 1) {
      await sw.fetchEvent(request(`https://basemaps.cartocdn.com/dark_all/10/0/${i}.png`))
    }

    const tiles = sw.caches.stores.get('plein-tiles-v1')
    expect(tiles?.entries.size).toBe(max)
    expect(tiles?.entries.has('https://basemaps.cartocdn.com/dark_all/10/0/0.png')).toBe(false)
  })

  it('drops caches that are no longer in the keep list', async () => {
    const sw = loadSw(async () => new Response('', { status: 200 }))
    await sw.caches.open('plein-assets-v1')
    await sw.caches.open('plein-shell-v1')
    await sw.caches.open('plein-tiles-v1')
    await sw.caches.open('plein-assets-v0')

    await sw.activate()

    expect(await sw.caches.keys()).toEqual([
      'plein-assets-v1',
      'plein-shell-v1',
      'plein-tiles-v1',
    ])
  })
})
