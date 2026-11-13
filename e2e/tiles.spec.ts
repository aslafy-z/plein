import { test, expect, gotoMap, WEBGL_LAUNCH } from './fixtures'

// The basemap is VersaTiles vector tiles drawn by a MapLibre GL layer under
// Leaflet's panes (src/lib/tiles.ts). When VersaTiles cannot be reached, the
// map swaps to OpenStreetMap raster tiles — and that layer prefetches one ring
// of tiles around the viewport so a slight pan never shows tiles loading. The
// ring must not compete with the visible tiles: off-screen tiles are
// requested with fetchpriority=low.
//
// The rest of the suite runs without WebGL, on the raster fallback
// (playwright.config.ts says why); this file is where the vector map runs.
// Software WebGL is slow, so these specs move the map with the keyboard
// rather than with long drags.
test.use({ launchOptions: WEBGL_LAUNCH })

/** VersaTiles requests the offline gate stands in front of: tiles and glyphs */
const GATED = /^https:\/\/tiles\.versatiles\.org\/(tiles|assets\/glyphs)\//

test('the basemap is VersaTiles vector tiles, drawn under the Leaflet panes', async ({ page }) => {
  const vector: number[] = []
  page.on('response', (res) => {
    if (/^https:\/\/tiles\.versatiles\.org\/tiles\/osm\/\d+\/\d+\/\d+$/.test(res.url())) {
      vector.push(res.status())
    }
  })
  await gotoMap(page)

  await expect(page.locator('.leaflet-tile-pane .leaflet-gl-layer canvas')).toBeVisible({
    timeout: 20_000,
  })
  await expect.poll(() => vector.filter((s) => s === 200).length, { timeout: 20_000 }).toBeGreaterThan(0)
  // No raster layer stands next to it: the fallback only mounts on a failure
  expect(await page.locator('img.leaflet-tile').count()).toBe(0)
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap')
  await expect(page.locator('.leaflet-control-attribution')).toContainText('VersaTiles')
})

type TileStats = { visible: number; visibleReady: number; outside: number; outsideLow: number }

function tileStats(page: import('@playwright/test').Page): Promise<TileStats> {
  return page.evaluate(() => {
    // Leaflet positions tiles at fractional pixels, so an outer ring tile can
    // graze the viewport edge by a subpixel — a 4px inset keeps the
    // classification honest ("visible" = the user can actually see it).
    const inset = 4
    const vw = window.innerWidth
    const vh = window.innerHeight
    let visible = 0
    let visibleReady = 0
    let outside = 0
    let outsideLow = 0
    for (const t of document.querySelectorAll<HTMLImageElement>('img.leaflet-tile')) {
      const b = t.getBoundingClientRect()
      if (b.right > inset && b.bottom > inset && b.left < vw - inset && b.top < vh - inset) {
        visible++
        if (t.complete && t.naturalWidth > 0) visibleReady++
      } else {
        outside++
        if (t.getAttribute('fetchpriority') === 'low') outsideLow++
      }
    }
    return { visible, visibleReady, outside, outsideLow }
  })
}

test('an unreachable VersaTiles swaps to OSM raster tiles, ring prefetched so a slight pan shows no tile loading', async ({ page }) => {
  await page.route('**://tiles.versatiles.org/**', (route) => route.abort())
  await gotoMap(page)
  await expect(page.locator('img.leaflet-tile').first()).toBeAttached({ timeout: 20_000 })
  await expect(page.locator('.leaflet-gl-layer')).toHaveCount(0)

  // Wait for the basemap to settle: every tile in the DOM finished downloading
  // (incl. the ring).
  await expect(async () => {
    const done = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile')].every(
        (t) => t.complete && t.naturalWidth > 0,
      ),
    )
    expect(done, 'all requested tiles must finish loading').toBe(true)
  }).toPass({ timeout: 20_000 })

  // Every tile is asked for in CORS mode: a no-cors <img> load is opaque to
  // the service worker, which could then not tell a tile from a CDN error and
  // would cache both (public/sw.js stores only readable successes).
  const noCors = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile')].filter(
        (t) => t.crossOrigin !== 'anonymous',
      ).length,
  )
  expect(noCors, 'every basemap tile must be requested with crossorigin=anonymous').toBe(0)

  // The prefetched ring exists and stays behind the visible tiles
  const before = await tileStats(page)
  expect(before.outside, 'tiles beyond the viewport must be prefetched').toBeGreaterThan(0)
  expect(before.outsideLow, 'off-screen tiles must be fetchpriority=low').toBe(before.outside)

  // Slight pan (well within the one-tile ring) — checked IMMEDIATELY after the
  // drag, before the network could fill any gap: every visible tile must
  // already be there. The ring refilling off-screen afterwards is expected.
  const box = await page.locator('.leaflet-container').first().boundingBox()
  if (!box) throw new Error('map container not found')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 120, cy - 80, { steps: 6 })
  await page.mouse.up()

  const after = await tileStats(page)
  expect(after.visible, 'the map must show tiles').toBeGreaterThan(0)
  expect(after.visibleReady, 'a slight pan must not show loading tiles').toBe(after.visible)
})

test('« Force offline mode » stops the vector map\'s tile and glyph requests', async ({ page }) => {
  // MapLibre fetches from its own workers, past every provider: the gate is
  // its transformRequest hook (lib/tileGate.ts), which hands a declined tile
  // an empty protobuf instead of an address.
  let requests = 0
  page.on('request', (req) => {
    if (GATED.test(req.url())) requests++
  })
  await gotoMap(page)
  await expect.poll(() => requests, { timeout: 20_000 }).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Settings' }).first().click()
  const toggle = page.getByTestId('force-offline-toggle')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Map' }).first().click()
  await expect(page.locator('.leaflet-gl-layer canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1500) // anything already in flight lands

  // Zoom out twice — with the keyboard, which both arrangements have (the
  // phone has no zoom buttons): two levels of never-fetched tiles, every one
  // declined
  const gated = requests
  await page.locator('.leaflet-container').first().focus()
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('-')
    await page.waitForTimeout(1500)
  }
  expect(requests).toBe(gated)

  // Released: the map asks for real tiles again
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'Map' }).first().click()
  await expect.poll(() => requests, { timeout: 20_000 }).toBeGreaterThan(gated)
})

test.describe('a map born without an area', () => {
  // A shared trip from « My position » mounts the route map behind the
  // awaited-trip skeleton, in a container with no size yet, while the fix is
  // still out. MapLibre cannot be created there (its transform has no
  // inverse at zero size): creating it anyway threw, left the layer half
  // added, and every zoom after that threw again (lib/tiles.ts,
  // guardedLayer). The fixture fails the test on any of those page errors.
  test.use({ seed: { sourceId: 'demo', onboarded: true } })

  test('waits for one, then draws the vector map', async ({ page }) => {
    await page.addInitScript(() => {
      let pending: PositionCallback | null = null
      ;(window as unknown as { __grantFix: () => void }).__grantFix = () => {
        const ok = pending
        pending = null
        ok?.({
          coords: { latitude: 43.6047, longitude: 1.4442, accuracy: 20 },
          timestamp: Date.now(),
        } as GeolocationPosition)
      }
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (ok: PositionCallback) => {
            pending = ok
          },
          watchPosition: () => 0,
          clearWatch: () => {},
        },
      })
    })
    await page.goto('/route/results?d=44.8378,-0.5792&dl=Bordeaux%20centre&f=diesel')
    await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1_000)

    await page.evaluate(() => (window as unknown as { __grantFix: () => void }).__grantFix())

    await expect(page.getByText('No fuel stop needed').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.leaflet-gl-layer canvas').first()).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('the onboarding screen', () => {
  test.use({ seed: { sourceId: 'demo', onboarded: false } })

  test('starts loading the vector map before there is a map', async ({ page }) => {
    // A first visit used to start the renderer chunk, the style and the
    // fonts only once the map mounted — after the pitch, in front of a blank
    // stage. The screen preloads them (lib/tiles.ts, preloadBasemap).
    const seen = new Set<string>()
    page.on('request', (req) => {
      const url = req.url()
      if (/maplibre-gl/.test(url)) seen.add('renderer')
      if (/tiles\.versatiles\.org\/assets\/styles\/[^/]+\/style\.json$/.test(url)) seen.add('style')
      if (/tiles\.versatiles\.org\/assets\/glyphs\//.test(url)) seen.add('glyphs')
    })
    await page.goto('/')
    await expect(page.getByText('Get started', { exact: true })).toBeVisible()
    await expect.poll(() => [...seen].sort(), { timeout: 15_000 }).toEqual(['glyphs', 'renderer', 'style'])
    await expect(page.locator('.leaflet-container')).toHaveCount(0)

    // And the map those downloads were for draws once the pitch is dismissed
    await page.getByText('Continue without location', { exact: true }).click()
    await expect(page.locator('.leaflet-gl-layer canvas').first()).toBeVisible({ timeout: 20_000 })
  })
})

test('a missing sprite or font range keeps the vector map', async ({ page }) => {
  // Only the style failing means nothing will ever draw. A sprite or a glyph
  // range that errors before the first tile used to read as « VersaTiles is
  // unreachable » and pinned the session on the raster fallback.
  await page.route(/tiles\.versatiles\.org\/assets\/(sprites|glyphs)\//, (route) =>
    route.fulfill({ status: 404, body: '' }),
  )
  await gotoMap(page)
  await expect(page.locator('.leaflet-gl-layer canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(3000) // past the errors, and the first tiles
  await expect(page.locator('.leaflet-gl-layer canvas')).not.toHaveCount(0)
  expect(await page.locator('img.leaflet-tile').count()).toBe(0)
})
