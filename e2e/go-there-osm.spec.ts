import { test, expect, gotoMap, desktopOnly } from './fixtures'

// « Go there » with OpenStreetMap as the maps site (desktop only: a phone
// hands off to its native maps app). openstreetmap.org cannot start a route
// from « where I am » on its own, so the link carries a fix from this visit
// as its start. The rule itself is unit-tested in src/lib/mapsHandoff.test.ts.

desktopOnly()

// Located at Toulouse Capitole, the demo dataset's own centre, so the
// stations stay where the demo puts them
test.use({
  seed: { sourceId: 'demo', onboarded: true, geoGranted: true, mapsSite: 'osm' },
  geolocation: { latitude: 43.6047, longitude: 1.4442 },
  permissions: ['geolocation'],
})

test('starts the OpenStreetMap route from the fix of this visit', async ({ page }) => {
  await gotoMap(page)
  await page.getByText(/Upd\. /).first().click()
  await expect(page.getByText('12 route de la Croix-Blanche · 31000 Toulouse')).toBeVisible()

  await page.evaluate(() => {
    const w = window as unknown as { __opened: string[] }
    w.__opened = []
    window.open = (url?: string | URL) => {
      w.__opened.push(String(url))
      return null
    }
  })
  await page.getByRole('button', { name: /^Go there/ }).click()
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
  expect(opened).toEqual([
    'https://www.openstreetmap.org/directions?from=43.6047%2C1.4442&to=43.6101%2C1.4519',
  ])
})
