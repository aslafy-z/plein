import { test, expect, gotoMap } from './fixtures'

// The ordering math is unit-tested (sortFavoriteRows) — this checks the
// screen WIRING: live prices resolved from the loaded area, the sort chips
// actually reordering, and unpinning persisting across a reload. Seeded:
// E.Leclerc · Labège (1.65 € but ~7 km out) vs Station U (1.67 €, <1 km).
//
// lastFix: a favorite's distance starts from the USER — a position
// geolocation actually returned, not merely the area the map opens on. The
// last describe drops it to check the other side.

const FAVORITES = [
  { id: 'le', name: 'E.Leclerc · Labège', init: 'EL', city: 'Labège', lat: 43.5611, lng: 1.5136 },
  { id: 'su', name: 'Station U · Croix-Blanche', init: 'SU', city: 'Toulouse', lat: 43.6101, lng: 1.4519 },
]

test.use({
  seed: {
    sourceId: 'demo',
    onboarded: true,
    lastFix: { lat: 43.6047, lng: 1.4442 },
    favorites: FAVORITES,
  },
})

const rows = (page: import('@playwright/test').Page) =>
  page.locator('button[aria-label^="Show "][aria-label$="on the map"]')

test('live prices, sort chips, and a persistent unpin', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Favorites', { exact: true }).click()
  await expect(page.getByText('2 stations')).toBeVisible()

  // Both live prices resolved from the loaded area
  await expect(page.getByText('1.65 €')).toBeVisible()
  await expect(page.getByText('1.67 €')).toBeVisible()

  // Default « Recommended »: the near station beats the sticker-cheapest;
  // « Price » flips back to the raw order
  await expect(rows(page).first()).toContainText('Station U · Croix-Blanche')
  await expect(rows(page).first()).toContainText(/\d k?m\b/)
  await page.getByText('Price', { exact: true }).click()
  await expect(rows(page).first()).toContainText('E.Leclerc · Labège')

  // Unpinning removes the row, and the removal survives a reload
  await page.getByRole('button', { name: 'Remove E.Leclerc · Labège from favorites' }).click()
  await expect(page.getByText('1 station', { exact: true })).toBeVisible()
  await expect(page.getByText('E.Leclerc · Labège')).toHaveCount(0)

  await page.reload()
  await expect(rows(page).first()).toContainText('Station U · Croix-Blanche')
  await expect(page.getByText('E.Leclerc · Labège')).toHaveCount(0)
})

test.describe('with no known position', () => {
  // Geolocation refused on a first visit: the map opened on the default area,
  // and a favorite's distance from THAT is not a distance from the user.
  test.use({ seed: { sourceId: 'demo', onboarded: true, favorites: FAVORITES } })

  test('rows claim no distance and « Distance » is not an order', async ({ page }) => {
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
    await gotoMap(page)
    await page.getByText('Favorites', { exact: true }).click()
    await expect(page.getByText('2 stations')).toBeVisible()
    await expect(page.getByText('1.65 €')).toBeVisible()

    // « Recommended » has only the price to go on: the sticker-cheapest leads
    await expect(rows(page).first()).toContainText('E.Leclerc · Labège')
    await expect(rows(page).first()).not.toContainText(/\d k?m\b/)
    await expect(rows(page).nth(1)).not.toContainText(/\d k?m\b/)

    await expect(
      page.getByRole('button', { name: 'Distance sort unavailable: your position is unknown' }),
    ).toBeDisabled()
  })
})
