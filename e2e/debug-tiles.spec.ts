// The tile-cache debug layer (MapCanvas) drawn from the real service-worker
// cache. This one has to be an e2e: what regressed once was not the tile math
// (that is unit-tested in tilePyramid/tileCache) but whether Leaflet actually
// PAINTS the thing — a refactor to one multi-ring polygon per bucket left the
// grid technically drawn and practically invisible, hairlines on a dark map.
//
// So the assertion is on COVERAGE, not on layers or on a raw pixel count: how
// much of the map wears the layer's cyan. The two states are far apart — the
// outlines alone cover ~2% of the canvas, the tinted cells ~100% — so the
// threshold sits an order of magnitude above the broken rendering and well
// under the working one.
import { expect } from '@playwright/test'
import { test } from './fixtures'

/** Toulouse — where the demo dataset lives, so the map opens on it */
const CENTER = { lat: 43.6045, lng: 1.4442 }

/**
 * Share of the biggest canvas covered by cyan-dominant opaque pixels — the
 * tile layer's color, telling it apart from the violet cached-areas layer and
 * the app's own paths.
 */
const CYAN_COVERAGE = `(() => {
  let cyan = 0
  let area = 0
  for (const c of document.querySelectorAll('canvas')) {
    area = Math.max(area, c.width * c.height)
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 0 && d[i + 2] > 100 && d[i + 1] > 100 && d[i] < d[i + 1]) cyan += 1
    }
  }
  return area === 0 ? 0 : cyan / area
})()`

/** Writes a pyramid around a point into the SW tile cache, the way a warmed
    tile lands there — every zoom the layer could show. */
async function seedTilePyramid(
  page: import('@playwright/test').Page,
  center: { lat: number; lng: number },
): Promise<number> {
  return page.evaluate(async ({ lat, lng }) => {
    const cache = await caches.open('plein-tiles-v1')
    let n = 0
    for (let z = 4; z <= 19; z += 1) {
      const c = 2 ** z
      const x = Math.floor(((lng + 180) / 360) * c)
      const rad = (lat * Math.PI) / 180
      const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * c)
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dy = -2; dy <= 2; dy += 1) {
          await cache.put(
            `https://a.basemaps.cartocdn.com/dark_all/${z}/${x + dx}/${y + dy}.png`,
            new Response('x', { status: 200 }),
          )
          n += 1
        }
      }
    }
    return n
  }, center)
}

test('debug mode draws the cached tiles over the map', async ({ page }) => {
  await page.goto('/?debug=1')
  await page.waitForSelector('.leaflet-container')

  expect(await seedTilePyramid(page, CENTER)).toBeGreaterThan(0)

  // The layer reads the cache a few seconds after the view settles, so poll
  // rather than sleep on a number.
  await expect
    .poll(() => page.evaluate(CYAN_COVERAGE), { timeout: 20_000 })
    .toBeGreaterThan(0.2)
})

test('debug mode off leaves the map free of the tile layer', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.leaflet-container')
  await seedTilePyramid(page, CENTER)
  await page.waitForTimeout(5000) // past the layer's read delay, had it run
  expect(await page.evaluate(CYAN_COVERAGE)).toBe(0)
})
