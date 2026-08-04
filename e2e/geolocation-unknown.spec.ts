// A first visit has no position: the fix may be refused, unavailable, or
// simply still out. The map has to open on something, so it opens on the
// default area — but an area is not a person. Nothing may present that
// fallback as the user: no dot on it, and the recentre control stays plain
// ink, an invitation to locate rather than a state already reached.
import { test, expect, gotoMap } from './fixtures'

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

// The address bar mirrors the zone the map shows (lib/mapUrl) — the one place
// a test can read « which area is on screen » without the Leaflet instance
const TOULOUSE = { lat: 43.6047, lng: 1.4442 }

function zoneCenter(page: import('@playwright/test').Page) {
  const ll = new URL(page.url()).searchParams.get('ll')?.split(',') ?? []
  return ll.length === 2 ? { lat: Number(ll[0]), lng: Number(ll[1]) } : null
}

/** Rough km between two points — « did it jump back » needs no better */
function kmApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180))
}

/**
 * The zone once it has stopped moving. A drag ends on Leaflet's pan inertia
 * and the circle's own glide, so the first readings after mouse.up are still
 * mid-flight — and the URL is written at most every MAP_URL_MIN_MS (500 ms),
 * so « unchanged once » proves nothing. Three quiet reads, 400 ms apart.
 */
async function settledZone(page: import('@playwright/test').Page) {
  let last = zoneCenter(page)
  let quiet = 0
  for (let i = 0; i < 40 && quiet < 3; i++) {
    await page.waitForTimeout(400)
    const now = zoneCenter(page)
    quiet = now != null && last != null && kmApart(now, last) < 0.02 ? quiet + 1 : 0
    last = now
  }
  expect(quiet, 'the map must come to rest').toBeGreaterThanOrEqual(3)
  return last!
}

test('asking for a fix does not yank the map onto the default area', async ({ page }) => {
  await stubPendingFix(page)
  await gotoMap(page)

  // Pan the zone off the default area, well above the phone's sheet
  const stage = (await page.locator('.leaflet-container').boundingBox())!
  const from = { x: stage.x + stage.width / 2, y: stage.y + stage.height * 0.35 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(from.x - (240 * i) / 16, from.y - (160 * i) / 16)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  const panned = await settledZone(page)
  expect(kmApart(panned, TOULOUSE)).toBeGreaterThan(1)

  // « Take me to me » with no position yet is only the ask: the fix is still
  // out, so there is nowhere to go — and the area panned to must stand.
  await page.getByRole('button', { name: /Recentre on my position|Finding your position/ }).click()
  expect(kmApart(await settledZone(page), panned)).toBeLessThan(0.5)
})

test('the route stage marks no user either', async ({ page }) => {
  await stubRefusedFix(page)
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()

  const recentre = page.getByTestId('route-recenter')
  await expect(recentre).toBeVisible()
  await expect(page.locator(USER_DOT)).toHaveCount(0)
  // The picto's center dot is what says « the view sits on you »
  await expect(recentre.locator('svg circle[r="2.1"]')).toHaveCount(0)
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
