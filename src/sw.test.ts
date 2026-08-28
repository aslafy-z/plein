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

  const install = async () => {
    const waits: Promise<unknown>[] = []
    listeners.get('install')?.({ waitUntil: (v: Promise<unknown>) => waits.push(v) })
    await Promise.all(waits)
  }

  return { caches, fetchEvent, activate, install, limits }
}

const shellCache = (sw: ReturnType<typeof loadSw>) => sw.caches.stores.get('plein-shell-v1')
const assetCache = (sw: ReturnType<typeof loadSw>) => sw.caches.stores.get('plein-assets-v1')

// What a built index.html references: entry chunks, stylesheet, preloaded
// fonts, app icons. The first offline launch of a freshly-installed PWA has
// exactly this to boot from.
const SHELL_HTML = [
  '<html><head>',
  '<link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />',
  '<link rel="preload" href="/fonts/archivo-latin-v25.woff2" as="font" crossorigin />',
  '<link rel="stylesheet" crossorigin href="/assets/index-abc.css" />',
  '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
  '</head><body></body></html>',
].join('\n')

const SHELL_URLS = [
  '/icons/icon.svg',
  '/fonts/archivo-latin-v25.woff2',
  '/assets/index-abc.css',
  '/assets/index-abc.js',
]

const shellFetch =
  (overrides: Record<string, Response | 'offline'> = {}) =>
  async (req: SwRequest): Promise<Response> => {
    const url = keyOf(req)
    const override = overrides[new URL(url).pathname]
    if (override === 'offline') throw new TypeError('Failed to fetch')
    if (override) return override.clone()
    if (url === `${ORIGIN}/`) return new Response(SHELL_HTML, { status: 200 })
    if (SHELL_URLS.some((u) => url === ORIGIN + u) || url === `${ORIGIN}/brands-fr.json`)
      return new Response(url, { status: 200 })
    return new Response('nope', { status: 404 })
  }

describe('service worker — install precache', () => {
  it('precaches the shell and every asset it references', async () => {
    const sw = loadSw(shellFetch())

    await sw.install()

    expect(await shellCache(sw)?.entries.get(`${ORIGIN}/`)?.text()).toBe(SHELL_HTML)
    for (const url of SHELL_URLS) {
      expect(assetCache(sw)?.entries.has(ORIGIN + url), `${url} must be precached`).toBe(true)
    }
    expect(sw.caches.stores.get('plein-data-v2')?.entries.has(`${ORIGIN}/brands-fr.json`)).toBe(
      true,
    )
  })

  it('boots offline after a single online visit', async () => {
    let online = true
    const fetchImpl = shellFetch()
    const sw = loadSw(async (req) => {
      if (!online) throw new TypeError('Failed to fetch')
      return fetchImpl(req)
    })

    // Visit once (the page itself is NOT service-worker-controlled yet: only
    // the install precache runs), then launch the installed PWA offline.
    await sw.install()
    online = false

    const { res: nav } = await sw.fetchEvent(request('/', 'navigate'))
    expect(await nav?.text()).toBe(SHELL_HTML)
    const { res: js } = await sw.fetchEvent(request('/assets/index-abc.js'))
    expect(js?.status).toBe(200)
  })

  it('rejects the install when the shell or one of its assets fails', async () => {
    const noShell = loadSw(shellFetch({ '/': 'offline' }))
    await expect(noShell.install()).rejects.toThrow()

    const noChunk = loadSw(
      shellFetch({ '/assets/index-abc.js': new Response('nope', { status: 404 }) }),
    )
    await expect(noChunk.install()).rejects.toThrow()
    // A half-cached shell must not look bootable
    expect(assetCache(noChunk)?.entries.has(`${ORIGIN}/assets/index-abc.js`)).toBe(false)
  })

  it('does not let the brand index block the install', async () => {
    const sw = loadSw(shellFetch({ '/brands-fr.json': 'offline' }))

    await sw.install()

    expect(await shellCache(sw)?.entries.get(`${ORIGIN}/`)?.text()).toBe(SHELL_HTML)
    expect(sw.caches.stores.get('plein-data-v2')?.entries.size ?? 0).toBe(0)
  })
})

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

  it('caches the self-hosted fonts, so the offline shell keeps its type', async () => {
    let calls = 0
    const sw = loadSw(async (req) => {
      calls += 1
      return new Response(req.url, { status: 200 })
    })

    await sw.fetchEvent(request('/fonts/archivo-latin-v25.woff2'))
    const { res } = await sw.fetchEvent(request('/fonts/archivo-latin-v25.woff2'))

    expect(await res?.text()).toBe(`${ORIGIN}/fonts/archivo-latin-v25.woff2`)
    expect(calls).toBe(1)
    expect(assetCache(sw)?.entries.has(`${ORIGIN}/fonts/archivo-latin-v25.woff2`)).toBe(true)
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

describe('service worker — the offline brand identity', () => {
  it('serves the cached brand index at once and replaces it behind the page', async () => {
    let calls = 0
    const sw = loadSw(async () => {
      calls += 1
      return new Response(`index ${calls}`, { status: 200 })
    })

    // Cold: nothing cached, so the network copy is what the page gets
    const { res: cold } = await sw.fetchEvent(request('/brands-fr.json'))
    expect(await cold?.text()).toBe('index 1')

    // Warm: the cached copy answers, and the refresh lands behind it
    const { res: warm, waitCount } = await sw.fetchEvent(request('/brands-fr.json'))
    expect(await warm?.text()).toBe('index 1')
    expect(waitCount).toBe(1)
    expect(calls).toBe(2)

    const { res: next } = await sw.fetchEvent(request('/brands-fr.json'))
    expect(await next?.text()).toBe('index 2')
  })

  it('keeps serving the brand index when the network is gone', async () => {
    let online = true
    const sw = loadSw(async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return new Response('index', { status: 200 })
    })

    await sw.fetchEvent(request('/brands-fr.json'))
    online = false
    const { res } = await sw.fetchEvent(request('/brands-fr.json'))

    // Without this an offline reload loses every enseigne name
    expect(await res?.text()).toBe('index')
  })

  it('does not cache a failed brand index over a good one', async () => {
    let status = 200
    const sw = loadSw(async () => new Response(`index ${status}`, { status }))

    await sw.fetchEvent(request('/brands-fr.json'))
    status = 500
    await sw.fetchEvent(request('/brands-fr.json'))
    await sw.fetchEvent(request('/brands-fr.json'))

    const cached = sw.caches.stores.get('plein-data-v2')
    expect(await cached?.entries.get(`${ORIGIN}/brands-fr.json`)?.text()).toBe('index 200')
  })

  it('caches the brand logos cache-first, next to the app assets', async () => {
    let calls = 0
    const sw = loadSw(async (req) => {
      calls += 1
      return new Response(req.url, { status: 200 })
    })

    await sw.fetchEvent(request('/brand-icons/total.png'))
    const { res } = await sw.fetchEvent(request('/brand-icons/total.png'))

    expect(await res?.text()).toBe(`${ORIGIN}/brand-icons/total.png`)
    expect(calls).toBe(1)
    expect(assetCache(sw)?.entries.has(`${ORIGIN}/brand-icons/total.png`)).toBe(true)
  })
})

describe('service worker — tiles and activation', () => {
  it('still bounds the tile cache', async () => {
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    const max = sw.limits.TILE_MAX_ENTRIES

    for (let i = 0; i < max + 5; i += 1) {
      await sw.fetchEvent(request(`https://basemaps.cartocdn.com/dark_all/10/0/${i}.png`))
    }

    const tiles = sw.caches.stores.get('plein-tiles-v2')
    expect(tiles?.entries.size).toBe(max)
    expect(tiles?.entries.has('https://basemaps.cartocdn.com/dark_all/10/0/0.png')).toBe(false)
  })

  it('refreshes a hit tile so the cap evicts least-recently-used, not oldest-inserted', async () => {
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    const max = sw.limits.TILE_MAX_ENTRIES

    for (let i = 0; i < max; i += 1) {
      await sw.fetchEvent(request(`https://basemaps.cartocdn.com/dark_all/10/0/${i}.png`))
    }
    // Touch the oldest entry (a cache hit), then overflow the cap by one:
    // the hit moved tile 0 to the tail, so tile 1 is now the eviction victim.
    await sw.fetchEvent(request('https://basemaps.cartocdn.com/dark_all/10/0/0.png'))
    await sw.fetchEvent(request(`https://basemaps.cartocdn.com/dark_all/10/0/${max}.png`))

    const tiles = sw.caches.stores.get('plein-tiles-v2')
    expect(tiles?.entries.size).toBe(max)
    expect(tiles?.entries.has('https://basemaps.cartocdn.com/dark_all/10/0/0.png')).toBe(true)
    expect(tiles?.entries.has('https://basemaps.cartocdn.com/dark_all/10/0/1.png')).toBe(false)
  })

  it('caches a keyed tile under its keyless URL, and answers either form', async () => {
    // The CARTO key authorizes the request; it is not part of the tile's
    // identity. Cached with it, a rotated key (or the tiles warmed before
    // CARTO required one) would miss on every single tile.
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    const url = 'https://a.basemaps.cartocdn.com/dark_all/10/2/3.png'

    const first = await sw.fetchEvent(request(`${url}?key=cb1_key`))
    expect(await first.res?.text()).toBe(`${url}?key=cb1_key`)

    const tiles = sw.caches.stores.get('plein-tiles-v2')
    expect([...(tiles?.entries.keys() ?? [])]).toEqual([url])

    // Both the rotated key and no key at all hit that one entry
    for (const asked of [`${url}?key=rotated`, url]) {
      const { res } = await sw.fetchEvent(request(asked))
      expect(await res?.text()).toBe(`${url}?key=cb1_key`)
    }
    expect(tiles?.entries.size).toBe(1)
  })

  it('lets a queried tile URL — the reachability probe — pass by untouched', async () => {
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    const tiles = await sw.caches.open('plein-tiles-v2')
    await tiles.put(
      'https://a.basemaps.cartocdn.com/dark_all/3/4/2.png',
      new Response('cached tile'),
    )

    // The probe carries the CARTO key like any other tile request — what
    // must keep it out of the cache is the `probe` parameter next to it.
    const { res } = await sw.fetchEvent(
      request('https://a.basemaps.cartocdn.com/dark_all/3/4/2.png?probe=123&key=cb1_key'),
    )

    // Not intercepted at all: the probe must reach the network (or fail),
    // never be answered by a cached tile — and never pollute the cache.
    expect(res).toBeUndefined()
    expect(tiles.entries.size).toBe(1)
  })

  it('drops caches that are no longer in the keep list', async () => {
    const sw = loadSw(async () => new Response('', { status: 200 }))
    await sw.caches.open('plein-assets-v1')
    await sw.caches.open('plein-shell-v1')
    await sw.caches.open('plein-tiles-v2')
    await sw.caches.open('plein-data-v2')
    await sw.caches.open('plein-assets-v0')
    // The previous tile generation: warmed by keyless requests, so it may
    // hold tiles CARTO stamped « API key required » — the bump must sweep it.
    await sw.caches.open('plein-tiles-v1')

    await sw.activate()

    expect(await sw.caches.keys()).toEqual([
      'plein-assets-v1',
      'plein-shell-v1',
      'plein-tiles-v2',
      'plein-data-v2',
    ])
  })
})
