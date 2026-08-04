import { test, expect, gotoMap } from './fixtures'

// The route stage is the same map as the zone tab's, so it marks where the
// user stands the same way (the dot lib/userDot builds for both) and offers
// the same way back to it. What is route-specific is the MEANING: this map has
// no search area, so its recenter control moves the view and nothing else —
// the trip stays whatever the endpoint fields say.

/** The locate picto fills its center dot only when the view sits on the user */
const centeredDot = (page: import('@playwright/test').Page) =>
  page.getByTestId('route-recenter').locator('svg circle[r="2.1"]')

// The runner's Chromium never answers a fix, and the control would then sit on
// its « locating » spinner for the whole test (geolocation-loading.spec.ts is
// where that wait is pinned). Hand it an instant one, on the position the app
// defaults to anyway, so nothing moves under the assertions below.
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

test('the route map shows where the user is, and takes the view back to them', async ({
  page,
}) => {
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()

  const recenter = page.getByTestId('route-recenter')
  await expect(recenter).toBeVisible()

  // The « you are here » dot — its halo is the one thing on either map wearing
  // the soft accent (the endpoint markers are the flat accent / warn)
  await expect(page.locator('.leaflet-marker-icon div[style*="--c-accent-soft-15"]')).toBeVisible()

  // The setup framing is the search area's, which is the user's position until
  // they search elsewhere: the view sits on them and the control says so
  await expect(centeredDot(page)).toHaveCount(1)

  // Pan the user out of the center — the control stops claiming otherwise
  const stage = await page.locator('.leaflet-container').boundingBox()
  expect(stage).not.toBeNull()
  const cx = stage!.x + stage!.width / 2
  const cy = stage!.y + stage!.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 260, cy - 180, { steps: 12 })
  await page.mouse.up()
  await expect(centeredDot(page)).toHaveCount(0)

  // …and takes the view back
  await recenter.click()
  await expect(centeredDot(page)).toHaveCount(1)
})
