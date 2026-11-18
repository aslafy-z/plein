import { test, expect, gotoMap, GEOPF_ADDRESS } from './fixtures'

// A search pick shows the stations AT the place — « fuel up there ». The other
// reading of the same search, « fuel up on the way there », is offered by the
// zone card once the place's prices are on screen, rather than asked of the
// user before they have seen anything.

test.use({
  seed: { sourceId: 'fr', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

const OFFER = '[data-testid="zone-route-offer"]'

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

test('the zone card on a searched place offers a route to it', async ({ page }) => {
  await gotoMap(page)
  // Following the user: nothing was looked up, nothing to route to
  await expect(page.getByText('1.70 €').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.locator(OFFER)).toHaveCount(0)

  await page.getByLabel('Search for a place').click()
  await page.getByPlaceholder('Town, address…').fill('capitole')
  await page.getByText('Capitole').first().click()

  const offer = page.locator(OFFER)
  await expect(offer).toContainText('Fuel up on the way to Capitole?')
  await offer.getByRole('button', { name: 'Directions to Capitole' }).click()

  // The destination is filled in: an input on a window, a trigger on a phone
  const destination = page.getByTestId('route-endpoint-to')
  await expect(destination).toBeVisible()
  const input = destination.locator('input')
  if ((await input.count()) > 0) await expect(input).toHaveValue('Capitole')
  else await expect(destination).toContainText('Capitole')

  // Back returns to the map, still on the place and still offering it
  await page.goBack()
  await expect(page.locator(OFFER)).toBeVisible()
})

test('the offer leaves with the place when the zone is panned off it', async ({ page }) => {
  await gotoMap(page)
  await page.getByLabel('Search for a place').click()
  await page.getByPlaceholder('Town, address…').fill('capitole')
  await page.getByText('Capitole').first().click()
  await expect(page.locator(OFFER)).toBeVisible()

  const stage = (await page.locator('.leaflet-container').boundingBox())!
  const x = stage.x + stage.width / 2 + 60
  const y = stage.y + stage.height / 2 - 90
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 110, y + 40, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('.search-box')).toContainText('Search a place or a route')
  await expect(page.locator(OFFER)).toHaveCount(0)
})
