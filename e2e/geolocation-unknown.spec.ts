// A first visit has no position: the fix may be refused, unavailable, or
// simply still out. The map has to open on something, so it opens on the
// default area — but an area is not a person. Nothing may present that
// fallback as the user: no dot on it, and the recentre control stays plain
// ink, an invitation to locate rather than a state already reached.
import { test, expect } from './fixtures'

/** The user dot is a Leaflet layer — its class is the only handle on it */
const USER_DOT = '.leaflet-marker-icon.user-dot'

/** Geolocation that never answers — the whole first load stays position-less */
async function stubPendingFix(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: () => {}, watchPosition: () => 0, clearWatch: () => {} },
    })
  })
}

/** Geolocation the user refuses */
async function stubRefusedFix(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: PositionCallback, ko?: PositionErrorCallback) =>
          ko?.({ code: 1, message: 'denied' } as GeolocationPositionError),
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    })
  })
}

test('a refused fix leaves the default area unclaimed', async ({ page }) => {
  await stubRefusedFix(page)
  await page.goto('/')

  await expect(page.getByText('Default position: Toulouse — turn location on')).toBeVisible()
  await expect(page.locator(USER_DOT)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Recentre on my position' })).toHaveAttribute(
    'data-locate-active',
    'false',
  )
})

test('a fix still under way claims nothing either', async ({ page }) => {
  await stubPendingFix(page)
  await page.goto('/')

  const recentre = page.getByRole('button', { name: /Recentre on my position|Finding your position/ })
  await expect(recentre).toBeVisible()
  await expect(recentre).toHaveAttribute('data-locate-active', 'false')
  await expect(page.locator(USER_DOT)).toHaveCount(0)
})

test.describe('a device located before', () => {
  // Geolocation answered in a past session, and the map has since been moved
  // elsewhere: the dot belongs on the FIX, never on the area being looked at.
  test.use({
    seed: {
      sourceId: 'demo',
      onboarded: true,
      geoGranted: true,
      lastFix: { lat: 43.6047, lng: 1.4442 },
      lastPos: { lat: 43.6047, lng: 1.4442 },
    },
  })

  test('keeps its last known position on screen', async ({ page }) => {
    await stubRefusedFix(page)
    await page.goto('/')

    await expect(page.getByText('Last known position — turn location back on')).toBeVisible()
    await expect(page.locator(USER_DOT)).toHaveCount(1)
  })
})
