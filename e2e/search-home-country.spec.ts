import { test, expect, GEOPF_ADDRESS } from './fixtures'

// « Automatic » merges four countries' geocoders. Among results that answer
// the query equally well, the country the map is looking at comes first:
// browsing Portugal, « Valen » means Valença before Valence.

const LISBON = { lat: 38.7223, lng: -9.1393 }

test.use({ seed: { sourceId: 'auto', onboarded: true, lastPos: LISBON } })

test('the country the map looks at leads the suggestions', async ({ page }) => {
  // No station matters here, and none may be fetched from the live flux
  await page.route('**/proxy/pt/**', (route) => route.fulfill({ status: 503, json: {} }))
  await page.route('**/proxy/es/**', (route) => route.fulfill({ status: 503, json: {} }))
  await page.route(GEOPF_ADDRESS, (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            geometry: { coordinates: [4.89, 44.93] },
            properties: { label: 'Valence', context: '26, Drôme', type: 'municipality' },
          },
        ],
      },
    }),
  )
  await page.route('**/proxy/ad/**', (route) => route.fulfill({ json: { suggestions: [] } }))
  await page.route('**/proxy/cartociudad/**', (route) => route.fulfill({ json: [] }))
  await page.route('**/proxy/photon/**', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            geometry: { coordinates: [-8.64, 42.03] },
            properties: { countrycode: 'PT', type: 'city', name: 'Valença', county: 'Viana do Castelo' },
          },
        ],
      },
    }),
  )

  await page.goto('/')
  await page.getByLabel('Search for a place').click()
  await page.getByPlaceholder('Town, address…').fill('Valen')

  const rows = page.getByTestId('search-suggestions').getByRole('button', { name: /Directions to/ })
  await expect(rows).toHaveCount(2, { timeout: 10_000 })
  const labels = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')?.replace('Directions to ', '') ?? ''),
  )
  // France is listed first when no country is home; here Portugal is
  expect(labels).toEqual(['Valença', 'Valence'])
})
