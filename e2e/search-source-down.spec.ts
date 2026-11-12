import { test, expect, gotoMap, phoneOnly, GEOPF_ADDRESS, GEOPF_POI } from './fixtures'

// A geocoder that is down used to look exactly like a search that matched
// nothing there: the rows of the sources that did answer were shown alone, and
// read as the app's best guess. The list now says when a source is missing —
// naming the country when a whole one is — and a search with no source at all
// says so instead of « no place matches ». France has a backup of its own:
// Photon answers its addresses when the Géoplateforme does not.

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

const DOWN = { status: 504, json: {} }

/** Photon serves Portugal and the other countries' backups off one path, told
    apart by bbox — these are France's and Spain's */
const BACKUP_BBOXES = ['bbox=-5.3', 'bbox=-9.4']
const PHOTON_NICE = {
  json: {
    type: 'FeatureCollection',
    features: [
      {
        geometry: { coordinates: [7.26, 43.7] },
        properties: {
          countrycode: 'FR',
          type: 'house',
          housenumber: '4',
          street: 'Rue Pasteur',
          postcode: '06000',
          city: 'Nice',
          county: 'Alpes-Maritimes',
        },
      },
    ],
  },
}

async function search(page: import('@playwright/test').Page, text: string) {
  await gotoMap(page)
  await page.getByLabel('Search for a place').click()
  await page.getByPlaceholder('Town, address…').fill(text)
}

test('a list one source is missing from says so', async ({ page }) => {
  await page.route(GEOPF_ADDRESS, (route) => route.fulfill({ json: ADDRESSES }))
  await page.route(GEOPF_POI, (route) => route.fulfill(DOWN))
  await search(page, 'Bayonne')

  await expect(page.getByRole('button', { name: 'Directions to Bayonne' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByTestId('search-incomplete')).toHaveText(
    'Some sources did not answer: the list may be incomplete.',
  )

  // Above the rows: read without scrolling past a dozen suggestions, and on a
  // phone never behind the keyboard's accessory bar.
  const notice = await page.getByTestId('search-incomplete').boundingBox()
  const row = await page.getByRole('button', { name: 'Directions to Bayonne' }).boundingBox()
  expect(notice!.y + notice!.height).toBeLessThanOrEqual(row!.y)
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

test('the backup answers French addresses when the Géoplateforme is down', async ({ page }) => {
  await page.route(GEOPF_ADDRESS, (route) => route.fulfill(DOWN))
  await page.route(GEOPF_POI, (route) => route.fulfill(DOWN))
  await page.route('**/proxy/photon/**', (route) => route.fulfill(PHOTON_NICE))
  await search(page, '4 rue pasteur nice')

  await expect(page.getByRole('button', { name: 'Directions to 4 Rue Pasteur' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText('06000 Nice, Alpes-Maritimes')).toBeVisible()
  // An answer from the backup is an answer: nothing is reported missing
  await expect(page.getByRole('status', { name: 'Searching…' })).toHaveCount(0)
  await expect(page.getByTestId('search-incomplete')).toHaveCount(0)
})

test.describe('several countries', () => {
  test.use({
    seed: { sourceId: 'auto', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
  })

  test('the notice names the countries that did not answer', async ({ page }) => {
    // France and Spain down, their backups included; Andorra and Portugal answer
    await page.route(GEOPF_ADDRESS, (route) => route.fulfill(DOWN))
    await page.route(GEOPF_POI, (route) => route.fulfill(DOWN))
    await page.route('**/proxy/cartociudad/**', (route) => route.fulfill(DOWN))
    await page.route('**/proxy/ad/**', (route) => route.fulfill({ json: { suggestions: [] } }))
    await page.route('**/proxy/photon/**', (route) =>
      BACKUP_BBOXES.some((bbox) => route.request().url().includes(bbox))
        ? route.fulfill(DOWN)
        : route.fulfill({
            json: {
              type: 'FeatureCollection',
              features: [
                {
                  geometry: { coordinates: [-8.43, 40.21] },
                  properties: { countrycode: 'PT', type: 'city', name: 'Coimbra', county: 'Coimbra' },
                },
              ],
            },
          }),
    )
    await search(page, 'Coimbra')

    await expect(page.getByRole('button', { name: 'Directions to Coimbra' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId('search-incomplete')).toHaveText(
      'No answer for: France, Spain. The list may be incomplete.',
    )
  })
  test('a running search names the countries it is still waiting for', async ({ page }) => {
    // France, Spain and Portugal answer at once; Andorra is held back until
    // the notice has been read
    await page.route(GEOPF_ADDRESS, (route) => route.fulfill({ json: ADDRESSES }))
    await page.route('**/proxy/cartociudad/**', (route) => route.fulfill({ json: [] }))
    await page.route('**/proxy/photon/**', (route) =>
      route.fulfill({ json: { type: 'FeatureCollection', features: [] } }),
    )
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/proxy/ad/**/GeocodeServer/suggest*', async (route) => {
      await held
      await route.fulfill({ json: { suggestions: [] } }).catch(() => {})
    })
    await search(page, 'Bayonne')

    // Same slot as the failure notice: above the rows already landed
    await expect(page.getByTestId('search-waiting')).toHaveText('Waiting for: Andorra.', {
      timeout: 10_000,
    })
    const notice = await page.getByTestId('search-waiting').boundingBox()
    const row = await page.getByRole('button', { name: 'Directions to Bayonne' }).boundingBox()
    expect(notice!.y + notice!.height).toBeLessThanOrEqual(row!.y)

    release()
    await expect(page.getByRole('status', { name: 'Searching…' })).toHaveCount(0)
    await expect(page.getByTestId('search-waiting')).toHaveCount(0)
    await expect(page.getByTestId('search-incomplete')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Directions to Bayonne' })).toBeVisible()
  })
})

test.describe('phone', () => {
  phoneOnly('the empty state is the full-screen search — a window shows no panel without rows')

  test('a search no source answered is not « no place matches »', async ({ page }) => {
    await page.route(GEOPF_ADDRESS, (route) => route.fulfill(DOWN))
    await page.route(GEOPF_POI, (route) => route.fulfill(DOWN))
    await page.route('**/proxy/photon/**', (route) => route.fulfill(DOWN))
    await search(page, 'Bayonne')

    await expect(page.getByText('The place search is not answering right now.')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('No place matches')).toHaveCount(0)
  })
})
