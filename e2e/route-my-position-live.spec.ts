import { test, expect, gotoMap, openRouteSheet, closeRouteSheet, pickRoutePlace } from './fixtures'

// A « My position » departure is a flag — « wherever I am » — not the point
// the first trip happened to start from. The user computes a trip in Toulouse,
// moves to Lyon, and asks for another one: it must depart from Lyon. The demo
// router draws a straight line × 1.25, so the distance on screen says which
// origin it was computed from: Nantes is 581 km from Toulouse, 644 from Lyon.

const TOULOUSE = { lat: 43.6047, lng: 1.4442 }
const LYON = { lat: 45.764, lng: 4.8357 }

test.use({ seed: { sourceId: 'demo', onboarded: true, lastFix: TOULOUSE } })

/** The position the mocked device reports on the next fix */
declare global {
  interface Window {
    __pos: { lat: number; lng: number }
  }
}

test.beforeEach(async ({ page }) => {
  // Own geolocation mock: the runner's Chromium never answers a fix, and this
  // test needs the user to move between two of them inside the same document.
  await page.addInitScript((start) => {
    window.__pos = start
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: { latitude: window.__pos.lat, longitude: window.__pos.lng, accuracy: 12 },
            timestamp: Date.now(),
          } as GeolocationPosition),
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    })
  }, TOULOUSE)
})

test('a second trip from « My position » departs from the new fix', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()

  // First trip, from the Toulouse fix
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
  await openRouteSheet(page)
  await expect(page.getByText('My position → Bordeaux centre').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(/265 km ·/).first()).toBeVisible()

  // The user moves: the route map's locate control asks for a fresh fix, and
  // the persisted last fix says when it has landed
  await page.getByText('Edit', { exact: true }).click()
  await closeRouteSheet(page)
  await page.evaluate((pos) => {
    window.__pos = pos
  }, LYON)
  await page.getByTestId('route-recenter').click()
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('plein.settings.v1') ?? '{}').lastFix?.lat,
      ),
    )
    .toBe(LYON.lat)

  // Second trip: still « My position », now measured from Lyon — never the
  // 581 km the first trip's origin would give
  await pickRoutePlace(page, 'to', 'Nantes', 'Nantes')
  await openRouteSheet(page)
  await expect(page.getByText('My position → Nantes').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/644 km ·/).first()).toBeVisible()
  await expect(page.getByText(/581 km ·/)).toHaveCount(0)
})
