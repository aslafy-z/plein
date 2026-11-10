import { test, expect, gotoMap, pickRoutePlace } from './fixtures'

// Before a route exists the route map frames the endpoints as they are picked.
// A pan hands the view to the user — a plain re-render must not take it back —
// but a newly picked endpoint is a new subject and gets its own framing, the
// way a newly computed route does. Runs on both arrangements: the framing is
// the map's, whatever covers its edges.

/** The locate picto fills its center dot only when the view sits on the user */
const centeredDot = (page: import('@playwright/test').Page) =>
  page.getByTestId('route-recenter').locator('svg circle[r="2.1"]')

/** The departure marker: the accent circle with its deep ring — the user's dot
    wears the same ring, and is told apart by its own class */
const departurePin = (page: import('@playwright/test').Page) =>
  page.locator('.leaflet-marker-icon:not(.user-dot) div[style*="--c-accent-deep"]')

// An instant fix on the default area (see route-locate.spec.ts): the recenter
// control is this spec's proof that the pan below really moved the view.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: { latitude: 43.6047, longitude: 1.4442, accuracy: 20 },
            timestamp: Date.now(),
          } as GeolocationPosition),
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    })
  })
})

test('a departure picked after the route map was panned is framed', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()
  await expect(centeredDot(page)).toHaveCount(1)

  // Leaflet swallows a drag begun while the entry fit is still flying
  await expect(page.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-zoom-anim/)

  // Take the view over
  const stage = await page.locator('.leaflet-container').boundingBox()
  expect(stage).not.toBeNull()
  const cx = stage!.x + stage!.width / 2
  const cy = stage!.y + stage!.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 260, cy - 180, { steps: 12 })
  await page.mouse.up()
  await expect(centeredDot(page)).toHaveCount(0)

  // A departure a couple of hundred kilometres away: left where the pan put
  // it, the view would not hold its marker
  await pickRoutePlace(page, 'from', 'Bordeaux', 'Bordeaux centre')
  await expect(departurePin(page)).toHaveCount(1)
  await expect(departurePin(page)).toBeInViewport()
})
