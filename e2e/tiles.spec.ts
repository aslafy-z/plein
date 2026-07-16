import { test, expect, gotoMap } from './fixtures'

// The basemap prefetches one ring of tiles around the viewport (src/lib/tiles.ts)
// so a slight pan never shows tiles loading. The ring must not compete with the
// visible tiles: off-screen tiles are requested with fetchpriority=low.

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

test('an off-screen tile ring is prefetched so a slight pan shows no tile loading', async ({ page }) => {
  await gotoMap(page)

  // Wait for the basemap to settle: every tile in the DOM finished downloading
  // (incl. the ring, and incl. a source→fallback swap when a tile CDN is blocked).
  await expect(async () => {
    const done = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile')].every(
        (t) => t.complete && t.naturalWidth > 0,
      ),
    )
    expect(done, 'all requested tiles must finish loading').toBe(true)
  }).toPass({ timeout: 20_000 })

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
