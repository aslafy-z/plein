// A shared trip departing from « My position » carries no departure
// coordinates (route-share.spec.ts): whoever opens it supplies their own. The
// link's compute therefore needs a fix, and the request for one is still out
// when the screen mounts. It has to wait for the answer — and when the answer
// is « no », hand over to the setup form rather than leave the awaited-trip
// skeleton standing over a compute that will never run.
import { test, expect } from './fixtures'

/** Hands the pending fix to the test: nothing lands until `__grantFix` runs */
declare global {
  interface Window {
    __grantFix: (lat: number, lng: number) => void
  }
}

const TOULOUSE = { lat: 43.6047, lng: 1.4442 }

/** Destination only: the departure is « wherever the reader is » */
const LINK = '/route/results?d=44.8378,-0.5792&dl=Bordeaux%20centre&f=diesel'

/** The setup form's submit — on screen means the form is what the route shows */
const formCta = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Compare the stations along the route' })

const unknownToast = (page: import('@playwright/test').Page) =>
  page.getByText('Position unknown — turn location on or enter a departure')

/** Geolocation that answers only when the test says so */
async function stubLateFix(page: import('@playwright/test').Page) {
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

async function grantFix(page: import('@playwright/test').Page) {
  await page.evaluate((p) => window.__grantFix(p.lat, p.lng), TOULOUSE)
}

test.describe('opened by a returning user with no known position', () => {
  test.use({ seed: { sourceId: 'demo', onboarded: true } })

  test('the trip waits for a fix that arrives late, then computes', async ({ page }) => {
    await stubLateFix(page)
    await page.goto(LINK)

    // Still locating: the link's trip is awaited — no form, and nothing has
    // given up on the position yet. (A fixed pause: the defect this pins was
    // a give-up on the very first frame, and there is no event to wait on for
    // « still nothing happened ».)
    await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1_000)
    await expect(formCta(page)).toHaveCount(0)
    await expect(unknownToast(page)).toHaveCount(0)

    await grantFix(page)

    await expect(page.getByText('No fuel stop needed').first()).toBeVisible({ timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe('/route/results')
    await expect(unknownToast(page)).toHaveCount(0)
  })

  test('a refused fix hands over to the setup form', async ({ page }) => {
    await stubRefusedFix(page)
    await page.goto(LINK)

    await expect(formCta(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('No fuel stop needed')).toHaveCount(0)
  })
})

test.describe('opened before onboarding', () => {
  test.use({ seed: { sourceId: 'demo' } })

  test('« Get started » asks for the fix, and the trip computes once it lands', async ({
    page,
  }) => {
    await stubLateFix(page)
    await page.goto(LINK)
    await expect(page.getByText('Pay a fair price at the pump.')).toBeVisible()

    await page.getByText('Get started', { exact: true }).click()
    await expect(page.getByText('Pay a fair price at the pump.')).toHaveCount(0)
    await page.waitForTimeout(500)
    await expect(formCta(page)).toHaveCount(0)

    await grantFix(page)

    await expect(page.getByText('No fuel stop needed').first()).toBeVisible({ timeout: 30_000 })
  })

  test('« Continue without location » lands on the setup form', async ({ page }) => {
    await page.goto(LINK)
    await expect(page.getByText('Pay a fair price at the pump.')).toBeVisible()

    await page.getByText('Continue without location').click()

    await expect(formCta(page)).toBeVisible({ timeout: 15_000 })
  })
})
