import { test, expect, mapZoom } from './fixtures'

/**
 * The search zone is a circle in METRES, so its radius in pixels doubles with
 * every zoom level: 25 km is ~14 000 px at zoom 16 and ~115 000 px at zoom 19.
 * The browser used to repaint that whole arc on every frame of every pan, and
 * past ~40 000 px a drag collapsed from 16 ms frames to 130 ms ones — the map,
 * the sheet and the rest of the app with it.
 *
 * What replaced it (lib/zoneCircle): the circle draws only the part of itself
 * the view can show. Both halves of that matter — the path stays small AND the
 * zone still covers the screen, since zoomed in that far the fill tint is the
 * only thing left of the circle on screen.
 */
test('the zone circle stays cheap to draw however far the map is zoomed in', async ({ page }) => {
  await page.goto('/?ll=43.6047,1.4442&z=19&r=25')
  expect(await mapZoom(page)).toBe(19)
  await expect(page.locator('.zone-circle')).toBeAttached()

  const drawn = await page.evaluate(() => {
    const path = document.querySelector('.zone-circle') as SVGPathElement | null
    const svg = path?.ownerSVGElement
    if (!path || !svg) return null
    const box = path.getBBox()
    const [x, y, w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number)
    return { box: { x: box.x, y: box.y, w: box.width, h: box.height }, view: { x, y, w, h } }
  })
  expect(drawn).not.toBeNull()
  const { box, view } = drawn!

  // Drawn geometry in the same order of magnitude as the view — the circle it
  // replaces spanned a hundred times it
  expect(box.w).toBeLessThan(view.w * 6)
  expect(box.h).toBeLessThan(view.h * 6)

  // …and the zone still reaches every edge of what the renderer paints
  expect(box.x).toBeLessThanOrEqual(view.x)
  expect(box.y).toBeLessThanOrEqual(view.y)
  expect(box.x + box.w).toBeGreaterThanOrEqual(view.x + view.w)
  expect(box.y + box.h).toBeGreaterThanOrEqual(view.y + view.h)
})

/**
 * The debug overlay draws every cached area as its own circle, and a fetch
 * radius is metres too — so zoomed in, each of those outlines was a six-figure
 * pixel arc as well, several of them, all repainted on every pan frame. The
 * whole overlay pane has to stay bounded, not just the search zone.
 */
test('the cached-area outlines stay cheap to draw too', async ({ page }) => {
  await page.goto('/?ll=43.6047,1.4442&z=19&r=25&debug=1')
  expect(await mapZoom(page)).toBe(19)

  await expect(async () => {
    const paths = await page.evaluate(() =>
      [...document.querySelectorAll('.leaflet-overlay-pane path')].map((el) => {
        const box = (el as SVGPathElement).getBBox()
        return { w: box.width, h: box.height }
      }),
    )
    // The zone circle AND at least one cached area — the assertion below is
    // worth nothing while the cache layer hasn't drawn yet
    expect(paths.length).toBeGreaterThanOrEqual(2)
    for (const box of paths) {
      expect(box.w).toBeLessThan(20_000)
      expect(box.h).toBeLessThan(20_000)
    }
  }).toPass({ timeout: 20_000 })
})

/**
 * The levels the app actually opens on are below the clipping threshold, where
 * Leaflet's own arc is exact and costs nothing: the circle stays a circle.
 */
test('the zone circle is drawn as an arc at ordinary zoom levels', async ({ page }) => {
  await page.goto('/?ll=43.6047,1.4442&z=13&r=25')
  expect(await mapZoom(page)).toBe(13)
  await expect(page.locator('.zone-circle')).toBeAttached()

  expect(await page.getAttribute('.zone-circle', 'd')).toMatch(/a[\d.-]+,[\d.-]+ /)
})
