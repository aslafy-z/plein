import { test, expect, gotoMap, phoneOnly, GEOPF_ADDRESS, GEOPF_POI } from './fixtures'

// A geocoder that is down used to look exactly like a search that matched
// nothing there: the rows of the sources that did answer were shown alone, and
// read as the app's best guess. The list now says when a source is missing,
// and a search with no source at all says so instead of « no place matches ».

test.use({
  seed: { sourceId: 'fr', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

const ADDRESSES = {
  type: 'FeatureCollection',
  features: [
    {
      geometry: { coordinates: [-1.4756, 43.4929] },
      properties: { label: 'Bayonne', context: '64, Pyrénées-Atlantiques', type: 'municipality' },
    },
  ],
}

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
            geom: { lat: 43.606, lon: 1.446 },
            gazole_prix: '1.70',
          },
        ],
      },
    }),
  )
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
})

async function search(page: import('@playwright/test').Page, text: string) {
  await gotoMap(page)
  await page.getByLabel('Search for a place').click()
  await page.getByPlaceholder('Town, address…').fill(text)
}

test('a list one source is missing from says so', async ({ page }) => {
  await page.route(GEOPF_ADDRESS, (route) => route.fulfill({ json: ADDRESSES }))
  await page.route(GEOPF_POI, (route) => route.fulfill({ status: 504, json: {} }))
  await search(page, 'Bayonne')

  await expect(page.getByRole('button', { name: 'Directions to Bayonne' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByTestId('search-incomplete')).toHaveText(
    'Some sources did not answer: the list may be incomplete.',
  )
})

test('a complete list carries no notice', async ({ page }) => {
  await page.route(GEOPF_ADDRESS, (route) => route.fulfill({ json: ADDRESSES }))
  await search(page, 'Bayonne')

  await expect(page.getByRole('button', { name: 'Directions to Bayonne' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByRole('status', { name: 'Searching…' })).toHaveCount(0)
  await expect(page.getByTestId('search-incomplete')).toHaveCount(0)
})

test.describe('phone', () => {
  phoneOnly('the empty state is the full-screen search — a window shows no panel without rows')

  test('a search no source answered is not « no place matches »', async ({ page }) => {
    await page.route(GEOPF_ADDRESS, (route) => route.fulfill({ status: 504, json: {} }))
    await page.route(GEOPF_POI, (route) => route.fulfill({ status: 502, json: {} }))
    await search(page, 'Bayonne')

    await expect(page.getByText('The place search is not answering right now.')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('No place matches')).toHaveCount(0)
  })
})
