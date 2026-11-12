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
const assetCache = (sw: ReturnType<typeof loadSw>) => sw.caches.stores.get('plein-assets-v2')

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })

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

  it('rejects the install when an asset is answered with the shell', async () => {
    const sw = loadSw(shellFetch({ '/assets/index-abc.js': html(SHELL_HTML) }))

    await expect(sw.install()).rejects.toThrow()
    expect(assetCache(sw)?.entries.has(`${ORIGIN}/assets/index-abc.js`)).toBe(false)
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
    const sw = loadSw(async () => html('<html>app</html>'))

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

  it('does not let a non-HTML navigation become the shell', async () => {
    // /version.json opened in a tab is a successful same-origin navigation
    const sw = loadSw(
      async () =>
        new Response('{"version":"1.2.3"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const cache = await sw.caches.open('plein-shell-v1')
    await cache.put('/', html('<html>app</html>'))

    const { res, waitCount } = await sw.fetchEvent(request('/version.json', 'navigate'))

    // The tab gets its JSON…
    expect(await res?.text()).toBe('{"version":"1.2.3"}')
    // …and the shell is still the app
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

  it('neither caches nor serves the shell standing in for a removed asset', async () => {
    // The host's single-page-application fallback: index.html and a 200 for
    // a chunk the last deploy removed
    let calls = 0
    const sw = loadSw(async () => {
      calls += 1
      return html('<html>app</html>')
    })

    for (const path of [
      '/assets/app-old123.js',
      '/icons/gone.png',
      '/fonts/gone.woff2',
      '/brand-icons/gone.svg',
    ]) {
      const { res, waitCount } = await sw.fetchEvent(request(path))
      expect(res?.status).toBe(404)
      expect(await res?.text()).toBe('')
      expect(waitCount).toBe(0)
    }

    await sw.fetchEvent(request('/assets/app-old123.js'))
    expect(calls).toBe(5) // never cached → asked again
    expect(assetCache(sw)?.entries.size ?? 0).toBe(0)
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
  const VT = 'https://tiles.versatiles.org'

  it('still bounds the tile cache', async () => {
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    const max = sw.limits.TILE_MAX_ENTRIES

    for (let i = 0; i < max + 5; i += 1) {
      await sw.fetchEvent(request(`${VT}/tiles/osm/10/0/${i}`))
    }

    const tiles = sw.caches.stores.get('plein-tiles-v4')
    expect(tiles?.entries.size).toBe(max)
    expect(tiles?.entries.has(`${VT}/tiles/osm/10/0/0`)).toBe(false)
  })

  it('refreshes a hit tile so the cap evicts least-recently-used, not oldest-inserted', async () => {
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    const max = sw.limits.TILE_MAX_ENTRIES

    for (let i = 0; i < max; i += 1) {
      await sw.fetchEvent(request(`${VT}/tiles/osm/10/0/${i}`))
    }
    // Touch the oldest entry (a cache hit), then overflow the cap by one:
    // the hit moved tile 0 to the tail, so tile 1 is now the eviction victim.
    await sw.fetchEvent(request(`${VT}/tiles/osm/10/0/0`))
    await sw.fetchEvent(request(`${VT}/tiles/osm/10/0/${max}`))

    const tiles = sw.caches.stores.get('plein-tiles-v4')
    expect(tiles?.entries.size).toBe(max)
    expect(tiles?.entries.has(`${VT}/tiles/osm/10/0/0`)).toBe(true)
    expect(tiles?.entries.has(`${VT}/tiles/osm/10/0/1`)).toBe(false)
  })

  it('never caches a tile the server refused, and asks again next time', async () => {
    let status = 429
    let calls = 0
    const sw = loadSw(async () => {
      calls += 1
      return new Response(`tile ${status}`, { status })
    })
    const url = `${VT}/tiles/osm/10/2/3`

    const refused = await sw.fetchEvent(request(url))
    // The page still gets the real answer — the map's error handling depends on it
    expect(refused.res?.status).toBe(429)
    expect(sw.caches.stores.get('plein-tiles-v4')?.entries.size ?? 0).toBe(0)

    status = 200
    const { res } = await sw.fetchEvent(request(url))
    expect(await res?.text()).toBe('tile 200')
    expect(calls).toBe(2)
    expect(sw.caches.stores.get('plein-tiles-v4')?.entries.has(url)).toBe(true)
  })

  it('never caches an opaque tile response — its status cannot be read', async () => {
    // What a no-cors request gets back: type « opaque », status 0, ok false.
    // It may be a tile or a 403/429/5xx; cached, an error would answer
    // cache-first from then on, each hit refreshing its recency.
    const opaque = { type: 'opaque', status: 0, ok: false, clone: () => opaque }
    const sw = loadSw(async () => opaque as unknown as Response)
    const url = 'https://tile.openstreetmap.org/10/2/3.png'

    const { res, waitCount } = await sw.fetchEvent(request(url))

    expect(res).toBe(opaque)
    expect(waitCount).toBe(0)
    expect(sw.caches.stores.get('plein-tiles-v4')?.entries.size ?? 0).toBe(0)
  })

  it('caches the OSM fallback tiles with the vector ones', async () => {
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    await sw.fetchEvent(request('https://tile.openstreetmap.org/10/2/3.png'))
    await sw.fetchEvent(request(`${VT}/tiles/landcover-vectors/9/1/1`))
    expect([...(sw.caches.stores.get('plein-tiles-v4')?.entries.keys() ?? [])]).toEqual([
      'https://tile.openstreetmap.org/10/2/3.png',
      `${VT}/tiles/landcover-vectors/9/1/1`,
    ])
  })

  it('lets a queried tile URL — the reachability probe — pass by untouched', async () => {
    const sw = loadSw(async (req) => new Response(req.url, { status: 200 }))
    const tiles = await sw.caches.open('plein-tiles-v4')
    await tiles.put(`${VT}/tiles/osm/3/4/2`, new Response('cached tile'))

    const { res } = await sw.fetchEvent(request(`${VT}/tiles/osm/3/4/2?probe=123`))

    // Not intercepted at all: the probe must reach the network (or fail),
    // never be answered by a cached tile — and never pollute the cache.
    expect(res).toBeUndefined()
    expect(tiles.entries.size).toBe(1)
  })

  it('keeps the style, sprite and glyphs in their own uncapped cache, served cached first', async () => {
    // An offline map without its style draws nothing at all; and the tile
    // cap must never evict what every tile needs to be drawn with.
    let version = 1
    const sw = loadSw(async (req) => new Response(`${req.url} v${version}`, { status: 200 }))
    const style = `${VT}/assets/styles/gray-dark/style.json`
    const glyphs = `${VT}/assets/glyphs/noto_sans_regular/0-255.pbf`

    await sw.fetchEvent(request(style))
    await sw.fetchEvent(request(glyphs))
    const basemap = sw.caches.stores.get('plein-basemap-v1')
    expect([...(basemap?.entries.keys() ?? [])]).toEqual([style, glyphs])
    expect(sw.caches.stores.get('plein-tiles-v4')?.entries.size ?? 0).toBe(0)

    // Stale-while-revalidate: the cached copy answers, the refresh lands behind
    version = 2
    const { res } = await sw.fetchEvent(request(style))
    expect(await res?.text()).toBe(`${style} v1`)
    expect(await (await basemap?.match(style))?.text()).toBe(`${style} v2`)
  })

  it('drops caches that are no longer in the keep list', async () => {
    const sw = loadSw(async () => new Response('', { status: 200 }))
    await sw.caches.open('plein-assets-v2')
    await sw.caches.open('plein-shell-v1')
    await sw.caches.open('plein-tiles-v4')
    await sw.caches.open('plein-data-v2')
    await sw.caches.open('plein-basemap-v1')
    // v1 may hold index.html under a removed chunk's URL — the bump sweeps it
    await sw.caches.open('plein-assets-v1')
    // The previous tile generations: v1 was warmed by keyless requests, so it
    // may hold tiles CARTO stamped « API key required »; v2 by no-cors ones,
    // whose opaque responses let CDN errors in; v3 is the CARTO raster
    // basemap the app no longer draws — the bumps must sweep them all.
    await sw.caches.open('plein-tiles-v1')
    await sw.caches.open('plein-tiles-v2')
    await sw.caches.open('plein-tiles-v3')

    await sw.activate()

    expect(await sw.caches.keys()).toEqual([
      'plein-assets-v2',
      'plein-shell-v1',
      'plein-tiles-v4',
      'plein-data-v2',
      'plein-basemap-v1',
    ])
  })
})
