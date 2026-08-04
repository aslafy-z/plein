// A GPS fix is the one wait the app cannot shorten: the device may take
// seconds, or sit on a permission prompt, while nothing else on screen moves.
// These specs pin the visible state that says so — the recentre control turns
// busy, and the zone names the step it is waiting on rather than claiming to
// be looking for stations it cannot even locate yet.
import { test, expect } from './fixtures'

/** Hands the pending fix to the test: nothing lands until `__grantFix` runs */
declare global {
  interface Window {
    __grantFix: (lat: number, lng: number) => void
  }
}

const TOULOUSE = { lat: 43.6047, lng: 1.4442 }

/** Let the fix the app is waiting on land — the demo dataset's own city */
async function grantFix(page: import('@playwright/test').Page) {
  await page.evaluate((p) => window.__grantFix(p.lat, p.lng), TOULOUSE)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let pending: PositionCallback | null = null
    window.__grantFix = (latitude, longitude) => {
      const ok = pending
      pending = null
      ok?.({
        coords: { latitude, longitude, accuracy: 20 },
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
})

test('the recentre control is busy while the fix is being acquired', async ({ page }) => {
  await page.goto('/')

  // The boot request is still out: the control says what it is waiting on
  const locating = page.getByRole('button', { name: 'Finding your position…' })
  await expect(locating).toBeVisible()
  await expect(locating).toHaveAttribute('aria-busy', 'true')

  await grantFix(page)

  // Fix landed → the crosshair is back, and nothing claims to be locating
  await expect(page.getByRole('button', { name: 'Recentre on my position' })).toBeVisible()
  await expect(locating).toHaveCount(0)
})

test('tapping recentre says it is locating again', async ({ page }) => {
  await page.goto('/')
  await grantFix(page)

  const recentre = page.getByRole('button', { name: 'Recentre on my position' })
  await expect(recentre).toBeVisible()
  await recentre.click()

  await expect(page.getByRole('button', { name: 'Finding your position…' })).toBeVisible()
})

test.describe('holding the first load for the fix', () => {
  // Geolocation worked last session → the store holds the stations fetch until
  // the fresh fix lands, so the app opens on the right area. That hold is
  // exactly the wait the zone has to name.
  test.use({ seed: { sourceId: 'demo', onboarded: true, geoGranted: true } })

  test('the zone names the fix it is waiting on, then the stations', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('Finding your position…').first()).toBeVisible()

    await grantFix(page)

    await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  })
})

test('Settings reports a fix under way over the status it will replace', async ({ page }) => {
  await page.goto('/')
  await grantFix(page)

  await page.getByText('Settings', { exact: true }).click()
  const row = page.getByRole('button', { name: /Device position/ })
  await expect(row).toBeVisible()

  await row.click()
  await expect(row).toContainText('locating…')
  await expect(row).toHaveAttribute('aria-busy', 'true')

  await grantFix(page)
  await expect(row).toContainText('on — the map follows your position')
})
