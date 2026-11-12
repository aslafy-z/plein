import { test, expect, gotoMap, GEOPF_ADDRESS } from './fixtures'

// A searched place used to leave no mark of its own: the zone moved onto it,
// the pill took its name, and the first pan took both away — nothing on the
// map said where the place had been. It now wears a pin that outlives the
// pan, and tapping the pin brings the zone and the name back.

test.use({
  seed: { sourceId: 'fr', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

const PIN = '.leaflet-marker-icon.place-pin'

test.beforeEach(async ({ page }) => {
  await page.route('**/proxy/fr/**', (route) =>
    route.fulfill({
      json: {
        total_count: 1,
        results: [
          {
            id: 'e2e-1',
            ville: 'Toulouse',
            adresse: '1 rue du Test',
            // Well away from the searched place: its bubble must not sit on
            // the pin this spec taps
            geom: { lat: 43.63, lon: 1.475 },
            gazole_prix: '1.70',
          },
        ],
      },
    }),
  )
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.route(GEOPF_ADDRESS, (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            geometry: { coordinates: [1.4442, 43.6047] },
            properties: {
              label: 'Capitole',
              context: '31, Haute-Garonne, Occitanie',
              type: 'municipality',
            },
          },
        ],
      },
    }),
  )
})

test('a searched place keeps its pin through a pan, and the pin leads back to it', async ({
  page,
}) => {
  await gotoMap(page)
  await expect(page.locator(PIN)).toHaveCount(0)

  await page.getByLabel('Search for a place').click()
  await page.getByPlaceholder('Town, address…').fill('capitole')
  await page.getByText('Capitole').first().click()

  const pill = page.locator('.search-box')
  await expect(pill).toContainText('Capitole')
  await expect(page.locator(PIN)).toHaveCount(1)
  await expect(page.locator(PIN)).toHaveAttribute('aria-label', 'Back to Capitole')

  // Pan away: the zone follows the map and the pill loses the name…
  const stage = (await page.locator('.leaflet-container').boundingBox())!
  const x = stage.x + stage.width / 2 + 60
  const y = stage.y + stage.height / 2 - 90
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 110, y + 40, { steps: 10 })
  await page.mouse.up()
  await expect(pill).toContainText('Search a place or a route')
  // …but the place is still marked
  await expect(page.locator(PIN)).toHaveCount(1)

  await page.locator(PIN).click()
  await expect(pill).toContainText('Capitole')

  // Clearing the search clears its pin
  await pill.getByRole('button', { name: 'Back to my position' }).click()
  await expect(page.locator(PIN)).toHaveCount(0)
})
