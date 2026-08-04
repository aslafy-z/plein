import { test, expect, openZoneList } from './fixtures'
import type { Page } from '@playwright/test'

// The zone-delta chip of the collapsed card compares the shown station to
// the search circle: the circle's cheapest advertises the zone spread, the
// others how much dearer they are than it. A selected pin keeps its card even
// when the circle holds no station (pins are deliberately not radius-limited),
// and the chip then had no floor to compare against: it fell back on 0 and
// printed the station's whole price as a delta (« +1.90 €/L »). No zone → no
// chip, and the same goes for a station selected OUTSIDE the circle.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

/** Deterministic fra flux: one station per (price, distance north) pair */
async function mockStations(page: Page, pins: { price: number; km: number }[]) {
  await page.route('**/proxy/fra/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = pins.map((p, i) => ({
      id: `e2e-delta-${i}`,
      ville: 'Testville',
      adresse: `${i} rue du Test`,
      geom: { lat: lat + p.km / 111, lon: lng },
      gazole_prix: p.price.toFixed(3),
    }))
    await route.fulfill({ json: { total_count: results.length, results } })
  })
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.goto('/')
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
}

/** Select a zone station by its price. The phone taps its row in the
    pulled-up sheet; a desktop row opens the fiche instead of merely
    selecting, so there the tap goes to the station's map pin. */
async function selectFromList(page: Page, price: string) {
  const handle = page.getByRole('button', { name: /list of stations/ })
  if ((await handle.count()) > 0) {
    await openZoneList(page)
    await page.getByTestId('zone-list').getByText(price).click()
  } else {
    await page.locator('.pin-bubble', { hasText: price.replace(' €', '') }).click()
  }
  await expect(page.getByText('Selected station')).toBeVisible()
}

/** Shrink the search circle to 1 km — the selection survives it */
async function shrinkRadius(page: Page) {
  await page.getByText(/^Filters · \d+$/).click()
  const slider = page.locator('input[type=range]')
  await slider.fill('1')
  await expect(slider).toHaveValue('1')
  await page.getByText(/^Show \d+ stations?$/).click()
  await expect(page.getByText('Selected station')).toBeVisible()
}

test('an empty circle leaves the selected card without a delta chip', async ({ page }) => {
  // Both stations sit beyond the 1 km circle the test shrinks to
  await mockStations(page, [
    { price: 1.9, km: 2 },
    { price: 1.67, km: 3 },
  ])
  // The card crowns the cheapest of the zone: 23 ct saved on the priciest
  await expect(page.getByTestId('zone-delta')).toHaveText('−0.23 €/L')

  await selectFromList(page, '1.90 €')
  await expect(page.getByTestId('zone-delta')).toHaveText('+0.23 €/L')

  await shrinkRadius(page)
  // The card still shows the selected station, WITHOUT claiming a delta
  await expect(page.getByText('1.90 €', { exact: true })).toBeVisible()
  await expect(page.getByTestId('zone-delta')).toHaveCount(0)
})

test('a station selected outside the circle claims no delta either', async ({ page }) => {
  await mockStations(page, [
    { price: 1.95, km: 0.5 }, // stays in the 1 km circle
    { price: 1.67, km: 3 }, // selected, then left outside it
  ])
  await selectFromList(page, '1.67 €')
  await expect(page.getByTestId('zone-delta')).toHaveText('−0.28 €/L')

  await shrinkRadius(page)
  // The circle is not empty anymore (the 1.95 station is in it) but the
  // selected station is no longer part of that zone
  await expect(page.getByText('1.67 €', { exact: true })).toBeVisible()
  await expect(page.getByTestId('zone-delta')).toHaveCount(0)
})
